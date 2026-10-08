# 未解決の論点

決まったら ADR にして、ここから消す（または解決済みに移す）。

## 要検証（技術前提）出どころ: 設計メモ §12
- [ ] Channels がターミナル版 `claude` の Windows 環境で動作するか → 指示送信の方式（ADR 0001）に影響
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
- [ ] 強制終了で `SessionEnd` が発火しないことの確認 → Ctrl+C での終了では `SessionEnd` が来なかった（1 回のみ。`async` のフックが終了で打ち切られた可能性もある）。`taskkill` は未確認。いずれにせよ `/poll` の切断で補う（T0-6）
- [ ] 複数アカウントがフックで区別できるか（今回のログは 1 アカウントのみ）
- [x] 許可後の復帰の合図: `PostToolUse` を使う。`PreToolUse` は許可プロンプトより前に発火する（T0-3）
- [x] Windows で `claude` を Ctrl+C で終了したとき、チャネルサーバーの stdin が閉じ、`/poll` の切断を本体が約 22ms で検知できた（NFR-006、T0-6）。`taskkill`／ウィンドウを閉じる場合は未確認
- [ ] Windows でフックの `node` 起動の遅延が、3 秒以内（NFR-003）に収まるか

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
- [x] 画面側のフレームワーク: React + Vite（`../20-design/architecture.md`）
- [ ] 外部公開の方式（Cloudflare Tunnel + Access／Tailscale）→ ADR 0005
- [ ] 外部からの許可応答を「拒否のみ」に絞るか
