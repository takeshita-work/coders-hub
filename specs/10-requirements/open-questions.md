# 未解決の論点

決まったら ADR にして、ここから消す（または解決済みに移す）。

## 要検証（技術前提）出どころ: 設計メモ §12
- [x] Channels がターミナル版 `claude` の Windows 環境で動作するか → 動作を確認した。指示の送信・作業中のキュー・許可の中継とも可（ADR 0001・0002）
- [ ] 許可の中継で、ターミナルが先に応答したときの扱い（共存）、`deny` の応答、2 つのチャネルが同時にあるときの挙動
- [ ] asyncRewake フックの `timeout` の上限値
- [ ] 作業中のセッションに asyncRewake フックが exit 2 で終わった場合の扱い
- [ ] PermissionRequest フックとターミナルのダイアログの表示順序
- [x] `CLAUDE_CODE_SESSION_ID` とフックの `session_id` が一致するか → フック側・MCP サーバー側とも一致を確認済み（T0-4）
- [ ] Codex CLI など他ツールのフック仕様
- [x] MVP で許可待ちを検知できるか: `Notification` の `notification_type`（`permission_prompt`／`idle_prompt`）で区別できる（`001-session-list/tasks.md` T0-2）
- [x] 許可待ちの検知が遅い: `Notification` は約 6 秒遅れるが、`PermissionRequest` は `PreToolUse` の 1〜56ms 後に発火する。`PermissionRequest` を使う（T0-10）
- [x] 許可の**拒否**や **Esc による中断**のあとの状態の戻し方 → 会話ログの定期確認で補う（ADR 0007、Accepted）。経緯: 公式ドキュメントでも、この場合に発火するフックはない（`Stop` は中断で実行されない。`PostToolUseFailure` は権限拒否で発火しない。`PermissionDenied` は auto モード限定）。次の `UserPromptSubmit` まで `permission`／`working` のままになる。対処を決める（`001-session-list/plan.md`）
  - 検討結果: Channels は不可（公式ドキュメントに、プロンプトの解決済み・中断を知らせる通知の記載がない。受け取れるのは開き始めの `permission_request` のみ）
  - 有力: 会話ログ（JSONL、各フックの入力の `transcript_path`）の末尾を、`permission`／`working` のセッションだけ定期的に確認する。実機のログでは、拒否の 1.9 秒後（`PermissionRequest` の 39:14.9 に対し 39:16.68）に `tool_result`（`User rejected tool use`、`is_error`）と `[Request interrupted by user for tool use]` が記録されていた。Esc 中断の記録は未確認
  - 懸念: JSONL は内部フォーマット（NFR-008）。補助用途に限り、読めなくなっても状態が戻らないだけ（現状と同じ）にとどめる
- [x] 強制終了で `SessionEnd` が発火しないこと → Ctrl+C での終了では来なかった（1 回のみ。`async` のフックが終了で打ち切られた可能性もある）。`SessionEnd` に頼らず、`/poll` の切断で検知する（ウィンドウを閉じる・`taskkill /F` でも、すぐ消えることを実機で確認。T6-2）
- [x] 複数アカウントの区別: フックの `CLAUDE_CONFIG_DIR` と、チャネルサーバーの `CLAUDE_CONFIG_DIR` で区別できる。`.claude-takeshita.work` と `.claude-soilook` が別グループで同時に表示されることを実機で確認（T6-2）
- [x] 許可後の復帰の合図: `PostToolUse` を使う。`PreToolUse` は許可プロンプトより前に発火する（T0-3）
- [x] Windows で `claude` を Ctrl+C で終了したとき、チャネルサーバーの stdin が閉じ、`/poll` の切断を本体が約 22ms で検知できた（NFR-006、T0-6）。ウィンドウを閉じる・`taskkill /F` も、実機で確認済み（T6-2）
- [x] Windows でフックの `node` 起動の遅延: 起動から記録まで 20〜46ms。3 秒以内（NFR-003）に収まる（T0-7）。HTTP 送信を含む遅延は T4-1 で再計測

## 指示の送信（機能 002）で確認すること
- [x] チャネル機能を宣言したサーバーを、開発用フラグなしで起動したときの挙動 → エラーも警告もなく起動し、通知は黙って捨てられる（ADR 0011）
- [x] 通知の `meta` → タグの属性として会話ログに残る。ID での突き合わせに使える
- [x] 許可待ちに通知したときの扱い → 指示として扱われず、注意書きになる。Hub 本体で保留する（ADR 0013）
- [ ] 質問待ち（`AskUserQuestion`）に通知したときの扱い（許可待ちと同じと想定）
- [x] 連続送信の順序、長文・特殊文字の通り方 → 順序は保たれる。特殊文字・5,000 文字は届く。`</channel>` だけ `</channel>` になる

## 手動テストで分かったこと（T6-2）
- [x] 通常の作業中の Esc は、早く押すと会話ログに記録が残らず、状態が「作業中」のまま戻らない（送信の 1 秒後に Esc → 記録なし／6 秒後 → 記録あり）。`claude` 自身の状態ファイル（`sessions/<pid>.json` の `status`）で補正する（ADR 0009）
- [x] 拒否のとき、状態ファイルも `waiting`（permission prompt）から `idle` に直接変わる（実機で確認。会話ログの記録の約 0.14 秒後）。Hub の画面もすぐ返答待ちに戻った。許可ダイアログでの Esc は、会話ログ側で確認済み（状態ファイルは未記録）
- [x] 状態ファイルには、Hub が知らないセッション（フック・チャネルサーバーなしの `claude`）も載っている。一覧には自動で加えない（補正のみ）。一覧に出したい `claude` は、チャネルサーバーとフックを設定する
- [x] `AskUserQuestion`（モデルからの質問）は「質問待ち」として 4 つ目の状態にする（ADR 0010）。実機で確認済み（acceptance.md の手順 11）
- [ ] `AskUserQuestion` 以外にも、回答や承認を求めるツール（プランの承認など）があるか。あれば「質問待ち」の判定に足す

## 要決定（仕様）
- [x] 利用者の範囲: 自分専用に決定（`../00-product/vision.md`）。公開は想定しない
- [x] MVP の範囲: 一覧のみ（REQ-001, 008, 010）。指示送信・許可応答・外部公開は次
- [x] 通知の要否: 画面内の表示のみ。ブラウザ通知・スマホ通知はしない
- [x] 永続化の方針: 保存しない。メモリのみ（NFR-009）
- [x] MVP の生存確認の方法: チャネルサーバーを MVP に入れ、ロングポーリングで確認する（ADR 0006）
- [x] チャネル機能を宣言しない通常の MCP サーバーは、開発用フラグも警告・承認画面もなしで起動できた（`.mcp.json` ＋ `enabledMcpjsonServers`。T0-5）
- [x] 30 セッションの一覧の整理: アカウントでグループ化（`../20-design/screens/README.md`）
- [x] 画面への状態反映の方式: WebSocket（`../20-design/architecture.md`）
- [x] スマホ表示のレスポンシブ対応: 次の段階（外部公開と同時）
- [x] 画面側のフレームワーク: React ＋ esbuild（`../20-design/architecture.md`、ADR 0008）。当初の React + Vite から変更
- [ ] 外部公開の方式（Cloudflare Tunnel + Access／Tailscale）→ ADR 0005
- [ ] 外部からの許可応答を「拒否のみ」に絞るか
