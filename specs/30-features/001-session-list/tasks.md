# 001 セッション一覧 タスク

- 対応 plan: ./plan.md
- 凡例: `[ ]` 未着手 / `[x]` 完了。★は検証タスク（結果によって以降の計画が変わる）
- 検証の結果は `../../10-requirements/open-questions.md` に反映し、判断が必要なものは ADR にする。

## フェーズ 0: 検証スパイク（使い捨てのコードで実機確認）

最初に行う。ここの結果で、フェーズ 1 以降の内容が変わる可能性がある。

- [x] T0-1 ★ フック入力の記録: 全対象フックで、stdin の JSON をファイルに追記するだけのスクリプトを仕込む。`SessionStart` / `UserPromptSubmit` / `Notification` / `PreToolUse` / `PostToolUse` / `Stop` / `SessionEnd` の入力を実機で記録する
- [x] T0-2 ★ 許可待ちの識別: 許可プロンプトが出たとき、`Notification` の入力で「許可待ち」と「アイドル」を区別できるか確認する（plan 検証 #1）
  - 結果: 区別できる。`notification_type` が `permission_prompt`（許可待ち）／`idle_prompt`（アイドル）。
  - 注意: `permission_prompt` の `Notification` は、許可プロンプトの約 6 秒後に来る（NFR-003 を満たせない）。許可待ちの検知には `PermissionRequest` を使う（T0-10 で確認済み）。
  - 注意: `idle_prompt` は `Stop` の約 60 秒後に来る。返答待ちの検知は `Stop` で足りるため、状態の遷移には使わない。
- [x] T0-3 ★ 許可後の復帰: 許可に応答した後に最初に来るイベントを確認し、`working` へ戻す合図に `PreToolUse` と `PostToolUse` のどちらが適切か決める（検証 #2）
  - 結果: `PostToolUse` を使う。`PreToolUse` は許可プロンプトより**前**に発火するため、復帰の合図にならない。
  - 未確認: 許可を**拒否**したときに来るイベント（`PostToolUse` が来ない可能性）。T0-10 で確認する。
- [x] T0-4 ★ セッション ID の一致: フックの `session_id` と、MCP サーバーの `CLAUDE_CODE_SESSION_ID` が同じ値か確認する（検証 #3）
  - 結果: フックの入力の `session_id`、フックのプロセスの環境変数、MCP サーバーの環境変数 `CLAUDE_CODE_SESSION_ID` の三者が一致した。`CLAUDE_CONFIG_DIR`・`CLAUDE_PROJECT_DIR` も MCP サーバーに渡る。別アカウントでの確認は後回し
- [x] T0-5 ★ 通常の MCP サーバーとして起動: チャネル機能を宣言しない最小の MCP サーバーを `--mcp-config` で起動し、開発用フラグ・警告画面なしで動くか確認する（検証 #4、ADR 0006）
  - 結果: `.mcp.json` ＋ `settings.local.json` の `enabledMcpjsonServers` で、フラグも承認画面もなしに起動し、`/mcp` で connected になった。`--mcp-config` 経由は未試行。MCP サーバーはフックの `SessionStart` の約 3 秒後に起動する
- [x] T0-6 ★ 強制終了の検知（Ctrl+C のみ確認。`taskkill`／ウィンドウを閉じる場合は未確認）: `claude` をタスクキル／ウィンドウを閉じて終了したとき、MCP サーバー（チャネルサーバー）の stdin クローズ・終了と、本体側の `/poll` 接続の切断が検知できるか確認する（検証 #5）
  - 結果: Ctrl+C で終了すると、MCP サーバーの stdin が閉じ（`end`）、プローブは自分で終了した（孤児は残らない）。Hub 側は約 22ms 後に `/poll` の切断（`answered:false`）を検知した。`SessionEnd` のフックは来なかった。shutdown 時の `parentAlive` は true（`ppid` は `claude` 本体と別のプロセスの可能性）
- [x] T0-7 ★ フックの起動遅延: Windows で `node` によるフックの起動〜送信の所要時間を計測し、3 秒以内に収まるか確認する（検証 #6）。`PreToolUse`／`PostToolUse` の頻度による体感への影響も見る
  - 結果: `node` の起動から記録まで 20〜27ms（約 40 件）。`async` で登録した `PreToolUse`／`PostToolUse` による体感の遅延は確認されなかった。ただし、本体への送信（HTTP）を含む遅延は T4-1 で再計測する。
- [x] T0-8 ★ `SessionStart` の挙動: `async` のフックとして登録しても起動をふさがないか確認する（検証 #7）
  - 結果: `async` で登録した `SessionStart`（`source=startup`）は正常に発火し、起動をふさがなかった。
- [x] T0-10 ★ 追加検証（T0-2, T0-3 の結果から）:
  - [x] `PermissionRequest` の発火タイミング: **`PreToolUse` の 1〜56ms 後**に発火する（4 回）。一方 `Notification`（`permission_prompt`）は `PermissionRequest` の**約 6.0 秒後**（6.03 秒、6.01 秒）で一定、かつ 6 秒以内に応答すると来ない。許可待ちの検知には `PermissionRequest` を使う（NFR-003 を満たせる）
  - [x] 許可したとき: `PermissionRequest` → `PostToolUse`（応答の約 2.5 秒後）
  - [x] 拒否したとき: `PermissionRequest` の後、`PostToolUse` も `Stop` も**来ない**（拒否で処理が中断されるため）。次に来るのは、ユーザーの次の `UserPromptSubmit`。状態を `permission` から戻す合図がない（要対策）
  - [x] `SessionEnd`: `/exit` で発火する（`reason=prompt_input_exit`）。強制終了では未確認（T0-6 と合わせて確認する）
  - [x] 拒否したときの合図の候補を公式ドキュメント（hooks）で確認した。結果: **ユーザーが手動で拒否したときに発火するフックはない。**
    - `Stop`: 「ユーザーによる中断で停止した場合は実行されない」。拒否も Esc による中断も、これに当たる
    - `PostToolUseFailure`: 権限の拒否では発火しない。また「実行中のツールをキャンセルしても発火しない」
    - `PermissionDenied`: auto モードの拒否でのみ発火する。「ユーザーが権限ダイアログを手動で拒否した場合は実行されない」
    - 影響: 拒否だけでなく、**Esc による中断**でも `Stop` が来ないため、`working`／`permission` のまま残る
  - [x] `Notification` の 6 秒の遅延は仕様どおり: 「`permission_prompt` は、ユーザーが約 6 秒間入力していない時点で発生」（キー入力のたびに延期）。即時に検知するには `PermissionRequest` を使う、と公式に案内されている
  - 補足: `PermissionRequest` はサンドボックス化されたコマンドのネットワークリクエストでは実行されない。その場合は `permission_prompt` を使う（v2.1.246 以降）。`SessionEnd` の入力フィールド名は、実機のログでは `reason`
  - [ ] 別のアカウント（`CLAUDE_CONFIG_DIR`）で同じディレクトリを起動し、複数アカウントが区別できることを確認する（今回のログは `.claude-takeshita.work` のみ）。**後回し**。フェーズ 4 の結合時に実機で確認する（T6 で再確認）
- [x] T0-11 ★ Esc 中断の記録: 作業中（長めの処理）に Esc で中断し、会話ログ（JSONL）にどの記録が残るか、何秒後に書かれるかを確認する。結果で ADR 0007 を Accepted にする
  - 結果: 許可ダイアログで Esc を押したとき、保留中の全ツール呼び出しに `User rejected tool use`（`is_error`）が並び、同じ時刻に `[Request interrupted by user]` が記録された。フックは `SessionEnd` まで何も来なかった。ADR 0007 を Accepted にした
  - 未確認: 許可ダイアログのない通常の作業中の Esc（今回のテストは `permissions.ask` の設定により、すべてダイアログ付きだった）。T6-2 の実機確認で確かめる
  - 発見: 許可待ちが連続するとき、`PostToolUse` と次の `PermissionRequest` の間は 12〜26ms。状態が一瞬 `working` に戻って再び `permission` になる。画面側で短い遅延（数百 ms）を入れてちらつきを防ぐ（plan 参照）
- [x] T0-9 検証結果のまとめ: `open-questions.md` を更新する。方針が変わる場合は ADR を追加し、`plan.md` と `spec.md` を直す（状態遷移表、使うフックの選定など）
  - まとめ: 計画の根幹は変わらない（フックで状態、`/poll` で生存、ADR 0003/0004/0006/0007 のまま）。実機で確定したこと: `PermissionRequest` で許可待ち、`PostToolUse` で復帰、拒否・Esc はログの確認で補う、ID は三者一致、通常の MCP サーバーは追加操作なしで起動、強制終了は stdin 終了＋`/poll` 切断で約 22ms で検知。
  - 未確認のまま実装に進む項目（リスクと対処）: 別アカウントの区別 → T6 で実機確認／`taskkill`・ウィンドウを閉じた場合の検知 → 50 秒の期限が保険／`SessionEnd` が強制終了で来ない → `/poll` の切断で補う／通常作業中の Esc → T6-2

## フェーズ 1: 基盤

- [x] T1-1 `src/` と `tests/` の構成、`package.json`、テストランナーの選定。結果: `node:test`（ADR 0008。Vitest はパスの `#` で動かない）。plan に反映済み
- [x] T1-2 内部ポートなどの設定の置き場所。結果: `src/shared/config.mjs` ＋ 環境変数での上書き。ポート 8765（内部）／8766（画面）
- [x] T1-3 `.gitignore`、改行コードの扱い。結果: `.gitattributes` で LF に固定

## フェーズ 2: Hub 本体のロジック（HTTP なしで単体テスト）

- [x] T2-1 セッション状態の管理（登録・更新・削除）。`sessionId` を主キーに、plan の「セッションの持つ情報」を保持する
- [x] T2-2 状態遷移: フックのイベント → `working` / `waiting` / `permission`、`stateSince` の更新（plan の遷移表）
- [x] T2-3 生存確認: `/poll` の最終受信時刻と、50 秒の期限による削除（時刻は差し替え可能にしてテストする）
- [x] T2-4 一覧の変化の通知（追加・更新・削除の差分を購読者へ渡す）
- [x] T2-6 中断・拒否の検知（ADR 0007）: 会話ログの追記分から中断・拒否の記録を判定する関数と、状態を `waiting` に戻す遷移。他のイベントが先に来た場合は確認を止める
- [x] T2-5 テスト: 状態遷移、期限による削除、未登録の `sessionId` のイベントを受けたときの扱い、登録前後のイベントの順序の入れ替わり
  - 実装: `src/hub/sessions.mjs`（状態管理）、`src/hub/transcript.mjs`（中断の判定）。テスト: `tests/sessions.test.mjs`、`tests/transcript.test.mjs`（`npm test`、全 42 件）

- [x] T2-7 状態ファイルの反映（ADR 0009）: `applyStatus`（フックより新しい変化だけ採用、再起動後の仮置きは置き換え）。テスト: `tests/status-monitor.test.mjs`

## フェーズ 3: Hub 本体の入出力

- [x] T3-1 内部 API（127.0.0.1:8765）: `GET /health`、`POST /event`、`POST /poll`（約 30 秒のロングポーリング、204）
- [x] T3-2 画面側 API（:8766）: 静的ファイルの配信と WebSocket。接続時のスナップショット、以降は差分
- [x] T3-3 `/poll` の接続切断の即時検知（T0-6 の結果による）
- [x] T3-6 会話ログの定期確認（ADR 0007）: `permission`／`working` のセッションの `transcript_path` を約 1 秒ごとに読み、T2-6 の判定へ渡す。読み取りに失敗しても本体は動き続ける
- [x] T3-4 内部 API の定義を `../../20-design/api/` に書く
- [x] T3-5 結合テスト: 本体を起動して `/event`・`/poll` を叩き、WebSocket の配信を確認する（AC-001-1, 3, 6）
  - 実装: `src/hub/hub.mjs`（入出力）、`src/hub/monitor.mjs`（会話ログの確認）、`src/hub/main.mjs`（`npm start`）。テスト: `tests/hub.test.mjs`、`tests/monitor.test.mjs`（`npm test` で全 66 件）
  - 追加した依存: `ws`（WebSocket）。`/bye`（チャネルサーバーの終了通知）と、WebSocket の Origin 検査も入れた

- [x] T3-7 状態ファイルの定期確認（ADR 0009）: `src/hub/status-monitor.mjs`。約 0.5 秒ごとに、把握しているセッションのアカウントの `sessions/*.json` を読む。読めなければ何もしない

## フェーズ 4: 接続部品

- [x] T4-1 `hook.mjs`: stdin の JSON を `POST /event` で送る。本体が落ちていても `claude` を妨げない（短いタイムアウト、失敗は黙って終了）
- [x] T4-2 `channel.mjs`: MCP サーバーとして起動し、自己登録とロングポーリングを行う。stdin が閉じたら本体へ終了を通知する
- [x] T4-3 本体の自動起動: `/health` で確認し、つながらなければ別プロセスで起動する。多重起動してもポートの確保で 1 つになることを確認する（NFR-005）
- [x] T4-4 チャネルサーバーの登録方法。結果: `claude mcp add --scope user`（アカウントごと）。起動用の関数は、開発用フラグが不要になったので作らない。`node scripts/print-setup.mjs` が、このリポジトリの場所に合わせたコマンドを表示する
- [x] T4-5 `settings.json` へ追加するフック設定の雛形。アカウントごとに追加する手順を `docs/setup.md` に反映する
  - 実装: `src/hook/{hook,payload}.mjs`、`src/channel/channel.mjs`、`src/shared/hub-client.mjs`、`src/setup/hooks-config.mjs`、`scripts/print-setup.mjs`。テスト: `tests/parts.test.mjs`、`tests/e2e.test.mjs`（実際のプロセスを起動して確認。`npm test` で全 82 件）
  - 決めたこと: hook.mjs は必要な項目（`session_id`、`cwd`、`transcript_path`、`prompt`（2000 字まで）、`notification_type`、`reason`、`tool_name`、`source`）だけを送る（`PostToolUse` の入力が大きく、Hub の本文上限 1MB を超えうるため）。使うフックは 6 種（`PreToolUse`・`Notification` は状態を動かさないので使わない）
  - 実機確認: チャネルサーバー 3 本を同時に起動しても Hub は 1 つだけ起動し、チャネルが終了しても Hub は残った（detached 起動。ただし実際の `claude` の終了で残るかは T6-2）
  - 未確認: `claude mcp add --scope user` の保存先（アカウントごとか）／実際の `claude` から起動したときの動作 → T6-2

## フェーズ 5: 画面（React ＋ esbuild、ADR 0008）

- [x] T5-1 プロジェクトの作成、WebSocket クライアント（スナップショット受信、差分の適用、切断時の再接続）
- [x] T5-2 一覧の導出ロジック: アカウントでのグループ化、並び順（許可待ち → 返答待ち → 作業中、同じ状態の中は `stateSince` の新しい順）、件数の集計
- [x] T5-3 一覧の表示: 状態、経過時間、プロジェクト、直近の発言、短縮セッション ID。経過時間は画面側で更新する（AC-001-8）
- [x] T5-4 要対応の強調表示、件数サマリー、`document.title` への反映（AC-010-*）
- [x] T5-5 アカウントグループの折りたたみ（折りたたみ時も要対応の件数を表示）、「すべて／要対応のみ」の絞り込み
- [x] T5-6 空の状態の表示（AC-001-7）、本体に接続できないときの表示
- [x] T5-7 コンポーネントテスト（AC-001-2, 7, 8, 9、AC-008-*、AC-010-*）
- [x] T5-8 spec の未決事項（強調表示の方法、表示文字数と省略、経過時間の形式など）をここで決めて spec に反映する
  - 結果: `spec.md`「画面で決めたこと」に記載
  - 実装: `src/web/{logic,client,components,main}.mjs`、`index.html`、`styles.css`、`scripts/build-web.mjs`（`npm run build` → `dist/web/`）。JSX は使わず `createElement` で書き、ビルドなしで `node:test` からテストできる。テスト: `tests/web-*.test.mjs`（`npm test` で全 120 件）
  - 実機確認: ブラウザ（Chrome）で擬似データ 6 件を表示し、強調・絞り込み・折りたたみ時の件数・経過時間の更新・タブのタイトルを確認した

## フェーズ 6: 検証と仕上げ

- [x] T6-1 負荷確認: 擬似セッション 30 件で、一覧の表示・更新を確認する（AC-001-4）
  - 結果（`tests/load.test.mjs`）: 30 件の同時接続・一斉更新の反映 34ms、330 件のイベント 224ms、30 行の描画 17.5ms、30 件の一斉切断の反映 27ms。いずれも要件（3 秒以内）に対して十分な余裕がある
- [x] T6-2 実機の通し確認（手順と結果の記入欄は `acceptance.md` の 2）。結果: 手順 2〜10 を確認（通常の作業中の Esc の問題は ADR 0009 で解決）。手順 1（空の状態）は、すべての `claude` を終了する必要があるため、画面のテストでの確認にとどめた: 複数アカウント・複数セッションで、状態の変化、反映時間（3 秒以内）、終了・強制終了時の削除（1 分以内）、本体の再起動後の復元を確認する（AC-001-3, 5, 6）
- [x] T6-3 受け入れ条件の確認: spec の AC を一つずつ確認し、テストとの対応を整理する（`acceptance.md` の 1。全 AC がテストか実機手順に対応している）
- [x] T6-4 `docs/setup.md` を実際の手順に更新し、`reference-code.md` の叩き台コードを削除する（`setup.md` はフェーズ 4・5 で更新済み。`reference-code.md` を削除し、参照を外した）
- [x] T6-5 `spec.md` のステータスを `Implemented` にし、`open-questions.md` を整理する（`plan.md`・REQ-001/008/010 も Implemented。`state-model.md` を実態に合わせた）

## 依存関係
- フェーズ 0 は他のすべてに先行する。特に T0-2, T0-3, T0-4 は plan の状態遷移の前提
- フェーズ 2 はフェーズ 0 の結果で、状態遷移表が確定してから着手する
- フェーズ 3 とフェーズ 4 は、フェーズ 2 の後に並行できる
- フェーズ 5 は、WebSocket の仕様（T3-2）が固まれば、フェーズ 3・4 と並行できる
- 画面（フェーズ 5）は、擬似データでも先行して作れる

## 検証 → 想定される分岐

| 検証 | 結果 | 取る対応 |
|---|---|---|
| T0-2 | 区別できない | 許可待ちの検知方法を変える（例: `PermissionRequest` フックの利用）。ADR を追加し、MVP の範囲に影響があれば spec を見直す |
| T0-4 | ID が一致しない | セッションを同一視する別のキー（`cwd` ＋ 親プロセスなど）を検討する。設計全体に影響するため ADR を追加 |
| T0-5 | 開発用フラグが必要 | ADR 0006 を更新。MVP から警告画面の承認が必要になる |
| T0-6 | 切断を検知できない | 50 秒の期限だけで削除する。期限の値を見直す |
| T0-7 | 3 秒に収まらない | フックの軽量化（常駐プロセスの利用など）か、NFR-003 の見直し |
