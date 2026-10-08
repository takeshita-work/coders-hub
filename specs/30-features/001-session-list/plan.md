# 001 セッション一覧 実装計画

- ステータス: Draft
- 対応 spec: ./spec.md
- 関連 ADR: 0003, 0004, 0006
- 参考: `../../20-design/architecture.md`、`../../../docs/research/claude-code-mechanisms.md`、`../../../docs/research/reference-code.md`

## 方針
フックで状態の変化を Hub 本体へ送り、チャネルサーバーのロングポーリングで生存を確認する。Hub 本体はメモリ上でセッションの一覧を持ち、変化を WebSocket でブラウザへ即時に配信する。履歴は保存しない（NFR-009）。

```
claude ──(フック)────────► POST /event ──┐
claude ◄─stdio─► channel.mjs ─ POST /poll ─┤► Hub 本体（メモリ） ══ WebSocket ══► React 画面
                  （:8765、内部のみ）          （:8766 で画面と WebSocket を配信）
```

## 部品と責務

| 部品 | 責務 |
|---|---|
| `hook.mjs` | フックの入力（stdin の JSON）を `POST /event` で本体へ送る。本体が落ちていても `claude` の動作を妨げない（失敗は黙って終了、短いタイムアウト） |
| `channel.mjs` | 起動時に本体へ自己登録し、ロングポーリングで生存を知らせる。必要なら本体を自動起動する（ADR 0004）。MVP は指示・許可を扱わない（ADR 0006） |
| Hub 本体 `hub.mjs` | セッション一覧の保持、状態遷移、生存確認、WebSocket 配信、静的ファイル配信 |
| 画面（React ＋ esbuild） | WebSocket で一覧を受け取り、グループ化・並べ替え・強調・絞り込み・折りたたみを行う |

## セッションの持つ情報（本体のメモリ上）

| 項目 | 内容 | 取得元 |
|---|---|---|
| `sessionId` | セッションの識別子（主キー） | フックの `session_id`／チャネルの `CLAUDE_CODE_SESSION_ID` |
| `account` | `CLAUDE_CONFIG_DIR`。画面ではフォルダ名を表示名にする案 | 環境変数 |
| `cwd` | 作業ディレクトリ | フックの `cwd`／チャネルの `process.cwd()` |
| `state` | `working` / `waiting` / `permission` | フックのイベント |
| `stateSince` | 現在の状態になった時刻 | 本体が受信した時刻 |
| `lastPrompt` | 最後のプロンプト | `UserPromptSubmit` の入力 |
| `channelAlive` | チャネルサーバーの接続状態 | `/poll` |

`sessionId` は、フックとチャネルサーバーの双方で同じ値になる（実機で確認済み）。

## 状態遷移とフック

| フックのイベント | 遷移 |
|---|---|
| `SessionStart` | セッションを登録（状態は `waiting`）。チャネルサーバーの登録の方が先に来る場合もある |
| `UserPromptSubmit` | `working`。`lastPrompt` を更新 |
| `PermissionRequest` | `permission`。`PreToolUse` の 1〜56ms 後に発火する（実測）。`Notification` の `permission_prompt` は約 6 秒遅れるため使わない |
| `Notification`（`idle_prompt`） | 状態は変えない（`Stop` の約 60 秒後に来るだけ） |
| `PostToolUse` | `permission` から `working` へ戻す（許可後にツールが終わった合図）。`PreToolUse` は許可プロンプトより前に発火するため使わない |
| （許可を**拒否**したとき、または **Esc で中断**したとき） | **フックの合図がない**（公式ドキュメントと実機で確認済み）。`Stop`・`PostToolUse`・`PostToolUseFailure`・`PermissionDenied` のいずれも来ない。会話ログの定期確認で補い、`waiting` に戻す（ADR 0007、下記「中断・拒否の検知」） |
| `Stop` | `waiting` |
| `SessionEnd` | 一覧から外す。`/exit` で発火する（`reason=prompt_input_exit`）。Ctrl+C での終了では来なかった（1 回のみ）。強制終了の検知は `/poll` の切断で行う |

詳細は `../../20-design/state-model.md`。

## 内部 API（MVP の範囲）

| エンドポイント | 呼び出し元 | 内容 |
|---|---|---|
| `GET /health` | チャネルサーバー | 起動確認 |
| `POST /event` | `hook.mjs` | フックのイベントを通知 |
| `POST /poll` | `channel.mjs` | 登録・生存確認。指示がないので約 30 秒で 204 を返す |

`/permission`、`/wait` は「次」の段階。API の定義は `../../20-design/api/` に書く。

## 状態のちらつきの防止
許可待ちが連続すると（複数のツール呼び出しが並ぶとき）、`PostToolUse` と次の `PermissionRequest` の間が 12〜26ms しかない。`permission` → `working` → `permission` と切り替わると、画面がちらつく。
- 案: 画面側で、`permission` から `working` への遷移の反映を数百 ms 遅らせる（その間に `permission` に戻れば反映しない）
- 本体の状態自体は、イベントの順序どおりに保つ（遅延は表示だけ）

## 中断・拒否の検知（ADR 0007）
フックの合図がない「許可の拒否」と「Esc による中断」を、会話ログ（JSONL）で補う。

- 対象: 状態が `permission` または `working` のセッションだけ。`waiting` は確認しない
- 場所: 各フックの入力にある `transcript_path`（本体がセッションごとに最新のパスを保持する）
- 方法: 約 1 秒ごとに、ログの末尾（数 KB）だけを読む。前回の読み取り位置からの追記分だけを見る案
- 検知する記録:
  - 拒否: `[Request interrupted by user for tool use]`（実機で確認済み）
  - 許可ダイアログでの Esc: `[Request interrupted by user]`（実機で確認済み）
  - 両方に当てはまる前方一致 `[Request interrupted by user` で判定する
  - 通常の作業中（ダイアログなし）の Esc は同じ文言と推測。T6-2 の実機確認で確かめる
- 検知したら: 状態を `waiting` に戻し、`stateSince` をログの時刻（または検知時刻）にする
- 他のイベントとの競合: 検知の前に `Stop`／`PostToolUse`／`UserPromptSubmit` が来たらそちらを優先し、確認を止める
- 失敗時: ファイルが読めない、文言が見つからない場合は何もしない（現状どおり、次の `UserPromptSubmit` まで残る）。補助であり、状態の主はフック
- テスト: ログの読み取りと文言の判定を単体テストする（実機のログから切り出したサンプルを使う）

## 生存確認と削除（NFR-006）
- 正常終了: `SessionEnd` で即時に外す
- 強制終了: チャネルサーバーとの `/poll` の接続が切れたら、即座に切断を検知して外す（実機確認: `claude` の Ctrl+C 終了で stdin が閉じ、本体は約 22ms で検知した。`taskkill` は未確認）。接続が切れたことを検知できない場合に備え、最後の `/poll` から 50 秒で外す（長いポーリングの 30 秒を超え、1 分以内に収まる値）
- 本体が再起動したら、チャネルサーバーが次の `/poll` で自己情報を送り直すので、一覧が復元される（NFR-004）。状態は再起動前の値が失われるため `waiting` として復元し、次のフックで更新される。これは仕様にない挙動なので、未決事項として spec に追記するか決める

## WebSocket（本体 → 画面）
- 接続時に、全セッションのスナップショットを送る
- 以降は変化したセッションを差分で送る（追加・更新・削除）
- 経過時間は `stateSince` から**画面側で計算**して表示する（AC-001-8）。本体から毎秒送らない
- 切断時は自動で再接続し、スナップショットを取り直す

## 画面
- 状態の保持: 受け取った一覧を React の状態として持つ
- 表示: アカウントごとにグループ化し、グループ内を「許可待ち → 返答待ち → 作業中、同じ状態の中は `stateSince` の新しい順」に並べる
- 件数サマリーとタブのタイトル（`document.title`）は、一覧から導出する
- 絞り込み（すべて／要対応のみ）と折りたたみは画面側の状態。保存の要否は未決（spec の未決事項）

## 影響範囲
新規実装のみ。リポジトリ内の配置:

```
src/
├── hub/      hub.mjs とその部品（状態管理、HTTP、WebSocket）
├── channel/  channel.mjs
├── hook/     hook.mjs
└── web/      React の画面（esbuild でバンドル）
tests/
```

配置先は、`docs/setup.md` の元の案（`C:\tools\coders-hub\`）と異なる。リポジトリ内に置き、起動用の設定から参照する形にする（未決）。

## 設定
ポート・期限は `src/shared/config.mjs` が一か所で定義し、環境変数（`CODERS_HUB_INTERNAL_PORT`、`CODERS_HUB_UI_PORT`、`CODERS_HUB_POLL_TIMEOUT_MS`、`CODERS_HUB_EXPIRE_MS`）で上書きできる。hook / channel / hub が共通で読む。設定ファイルは使わない。

## リスク・検証事項
実装の前に、次を検証する。

| # | 検証事項 | 影響 |
|---|---|---|
| 1 | （確認済み: `PermissionRequest` を使う）`Notification` フックだけで「許可待ち」と「アイドル」を区別できるか | AC-010-2。区別できなければ、許可待ちの検知方法を変える（ADR を追加） |
| 2 | 許可後に `permission` から `working` に戻す合図（`PreToolUse`／`PostToolUse`）の挙動と、呼び出し頻度による負荷 | 状態の正確さ。フックは `async` で、1 回の起動が短くて済む構成にする |
| 3 | （確認済み: 一致）`CLAUDE_CODE_SESSION_ID` とフックの `session_id` の一致 | 両者が違うと、セッションを同一視できない（設計全体に影響） |
| 4 | （確認済み: フラグ・承認画面なしで起動）チャネル機能を宣言しない MCP サーバーとして起動できるか。開発用フラグ・警告画面が不要か | MVP の起動手順（ADR 0006） |
| 5 | （Ctrl+C で確認済み）Windows で、`claude` の強制終了時にチャネルサーバーの `/poll` の接続切断を検知できるか | NFR-006 の実現方法 |
| 6 | （確認済み: 20〜46ms）Windows で、フックの `node` 起動の遅延が、3 秒以内（NFR-003）に収まるか | NFR-003 |
| 7 | （確認済み: 影響なし）`SessionStart` フックの既知の不具合（`asyncRewake` との組み合わせ）の影響を受けないか | 登録の経路（本計画は `asyncRewake` を使わない） |

結果は `../../10-requirements/open-questions.md` に反映し、判断が必要なものは ADR にする。

## テスト方針

| 観点 | 方法 |
|---|---|
| 状態遷移・並び順・生存確認の期限（AC-001-5, 9） | Hub 本体の状態管理を、HTTP・WebSocket から切り離した純粋なロジックとして単体テストする |
| 内部 API とイベントの流れ（AC-001-1, 3, 6） | 本体を実際に起動し、`/event`・`/poll` を叩いて WebSocket の配信を確認する結合テスト |
| 画面の表示（AC-001-2, 7, 8, AC-008-*, AC-010-*） | 一覧の状態を入力として、並び・強調・件数・タイトルを確認するコンポーネントテスト |
| 30 セッション（AC-001-4） | 擬似セッションを 30 件作る負荷確認 |
| 実機（AC-001-5 の強制終了、状態の取得） | 実際の `claude` で手動確認し、結果を記録する |

テストの名前やコメントに AC の ID（例: `AC-001-5`）を入れ、仕様と対応づける。テストランナーは Node 標準の `node:test`（ADR 0008）。`npm test` で `tests/` 以下を実行する。画面の部品は `react-dom/server` の描画結果で確認する。

## AC との対応

| AC | 確認方法 |
|---|---|
| AC-001-1, 2 | 結合テスト、コンポーネントテスト |
| AC-001-3 | 結合テスト（反映時間の計測）、実機 |
| AC-001-4 | 負荷確認 |
| AC-001-5 | 単体テスト（期限の判定）、実機（強制終了） |
| AC-001-6 | 結合テスト（本体の再起動） |
| AC-001-7, 8, 9 | コンポーネントテスト、単体テスト |
| AC-008-1〜4 | コンポーネントテスト |
| AC-010-1〜5 | コンポーネントテスト |
| AC-010-6 | 結果として通知の実装がないことをレビューで確認 |
