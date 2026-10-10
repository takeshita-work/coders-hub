# 002 指示の送信 タスク

- 対応 plan: ./plan.md
- 凡例: `[ ]` 未着手 / `[x]` 完了。★は検証タスク（結果によって以降の計画が変わる）
- 検証の結果は `../../10-requirements/open-questions.md` に反映し、判断が必要なものは ADR にする。

## フェーズ 0: 検証（実機。`spikes/probe-channels.mjs` を使う）

- [x] T0-1 ★ 開発用フラグなしの起動: チャネル機能を宣言したサーバーを、フラグなしで起動したときの挙動を確認する（ADR 0011 の要検証）
  - 結果: エラーも警告もなく起動・接続する。通知は黙って捨てられ、会話ログに何も残らない。サーバー側からフラグの有無は分からない
- [x] T0-2 ★ `meta` の残り方: `/send` に `meta: { id: "x1" }` を付けて送り、会話ログの記録と、ターミナルの表示を確認する
  - 結果: キーがタグの属性になる（`<channel source="…" id="x1" kind="probe">`）。通知の約 2 ミリ秒後に `enqueue` として記録される。ID での突き合わせに使える
- [x] T0-3 ★ 許可待ち・質問待ちへの通知: 許可プロンプトが出ている間に送り、処理されるタイミングを確認する
  - 結果（許可待ち）: **指示として扱われない。** 許可の応答後（ツール結果の境目）に、「NOT from your user … untrusted external data」の注意書き（`attachment`／`queued_command`、`queue-operation` は `remove`）として渡され、モデルは従わなかった。→ ADR 0013（Hub 本体で保留し、返答待ちで渡す）。質問待ちは未確認
- [x] T0-4 ★ 連続送信の順序: 3 件を続けて送り、処理の順序を確認する
  - 結果: 送った順（1 → 2 → 3）に処理された。ただし、ツールを使わないターンだったため。ツールを使う作業の途中に届くと T0-3 の扱いになる（1 件ずつ払い出す理由）
- [x] T0-5 ★ 本文の通り方: 改行・日本語・引用符・バックスラッシュ・`<`・`>`・長文（5,000 文字）を送り、本文が変わらないか確認する
  - 結果: 引用符・バックスラッシュ・`<`・`&`・バッククォート・改行・日本語は保たれる。5,000 文字も全部届く（記録 5,090 字）。例外は `</channel>` で、`</channel>` に置き換わる

## フェーズ 1: 待ち行列（Hub 本体のロジック）

- [x] T1-1 `instructions.mjs`: 指示の追加（検証・ID 発行）、保留、1 件ずつの払い出し（`waiting` のとき）、取り消し、状態遷移、タイムアウト、本文の破棄
- [x] T1-2 ストア: `controllable`（`channel: true` の `/poll` が来ているセッション）
- [x] T1-3 テスト（AC-002-4, 002-6, 002-8, 002-9, 002-10, 003-1〜003-4）（`instructions` 22 件）

## フェーズ 2: API と保護

- [x] T2-1 `/poll` の拡張: `channel`・`results` の受け取り、指示の応答、待機中の `/poll` を指示の追加で起こす
- [x] T2-2 画面用 `POST /api/sessions/:id/instructions`、`DELETE /api/sessions/:id/instructions/:id`（取り消し）
- [x] T2-3 書き込み API の保護（`Host`・`Origin`・`X-Coders-Hub`・`Content-Type`。ADR 0012）
- [x] T2-4 WebSocket の `instruction` メッセージ、`Session.controllable`・`Session.pending`
- [x] T2-5 `api/README.md` の更新
- [x] T2-6 テスト（AC-002-9, 002-11）（`hub-instructions` 18 件）

## フェーズ 3: チャネルサーバー

- [x] T3-1 `channel.mjs`: 引数 `--channel`、機能の宣言、`/poll` への `channel: true`
- [x] T3-2 指示を `notifications/claude/channel` で通知し、結果を次の `/poll` で返す
- [x] T3-3 テスト（AC-002-3）。模擬の MCP クライアントで通知を受ける（`e2e`：本物の `channel.mjs` から通知を受ける）

## フェーズ 4: 届いたことの確認

- [x] T4-1 会話ログ監視の拡張: `sent` の指示があるセッションを、約 0.5 秒で確認する
- [x] T4-2 記録の読み取り（`id` 属性での突き合わせ。`user`／`origin.kind: channel` は `confirmed`、`remove`／`queued_command` は `missed`）
- [x] T4-3 テスト（AC-002-7, 002-8, 005-3）（`delivery` 11 件）

## フェーズ 5: 画面

- [x] T5-1 `client.mjs`: `sendInstruction`（`X-Coders-Hub` 付き）、`instruction` メッセージの反映
- [x] T5-2 `logic.mjs`: 指示の状態の管理（保留中・取り消し・`lost` の判定）
- [x] T5-3 `components.mjs`: 行の操作、入力欄、結果の表示、操作できないときの理由
- [x] T5-4 テスト（AC-002-1, 002-4, 002-5, 002-6, 003-3, 003-5）（`web-instructions` 21 件）

## フェーズ 6: 起動・導入

- [x] T6-1 起動の方法: 操作モードの MCP 設定（`--channel` 入り）と、起動時のフラグ。`scripts/print-setup.mjs` の更新
- [x] T6-2 `docs/setup.md` の更新（操作モードの起動手順、フラグを付け忘れたときの症状）
- [x] T6-3 結合テスト（`e2e`）

## フェーズ 7: 実機の受け入れ

- [x] T7-1 `acceptance.md` を作り、AC と手順を対応させる
- [x] T7-2 実機で確認（AC-002-2, 003-1, 003-2, 005-1〜005-3 ほか）。手順 1〜9・11 は ○、10 は拒否の場合のみ確認（閉じる場合は自動テスト）、12 は重ならず未確認。結果は `acceptance.md`。確認中に見つけた 2 件（直近の発言に `<channel>` タグが出る、「失われました」の理由の文面）は修正済み
- [x] T7-3 spec・plan を Implemented にし、REQ の状態を更新する（REQ-002・003 は Implemented。REQ-005 は許可応答の機能 003 と合わせて完了）
