# 未解決の論点

決まったら ADR にして、ここから消す（または解決済みに移す）。

## 要検証（技術前提）出どころ: 設計メモ §12
- [ ] Channels がターミナル版 `claude` の Windows 環境で動作するか → 指示送信の方式（ADR 0001）に影響
- [ ] asyncRewake フックの `timeout` の上限値
- [ ] 作業中のセッションに asyncRewake フックが exit 2 で終わった場合の扱い
- [ ] PermissionRequest フックとターミナルのダイアログの表示順序
- [ ] `CLAUDE_CODE_SESSION_ID` とフックの `session_id` が一致するか
- [ ] Codex CLI など他ツールのフック仕様
- [ ] MVP で許可待ちを検知できるか: Channels の許可中継を使わず、`Notification` フックだけで「許可待ち」と「アイドル」を区別できるか（`001-session-list`）
- [ ] 許可後に `permission` から `working` へ戻す合図に使うフック（`PreToolUse`／`PostToolUse`）の挙動と、呼び出し頻度による負荷（`001-session-list/plan.md`）
- [ ] Windows で `claude` を強制終了したとき、チャネルサーバーの `/poll` の接続切断を本体が検知できるか（NFR-006）
- [ ] Windows でフックの `node` 起動の遅延が、3 秒以内（NFR-003）に収まるか

## 要決定（仕様）
- [x] 利用者の範囲: 自分専用に決定（`../00-product/vision.md`）。公開は想定しない
- [x] MVP の範囲: 一覧のみ（REQ-001, 008, 010）。指示送信・許可応答・外部公開は次
- [x] 通知の要否: 画面内の表示のみ。ブラウザ通知・スマホ通知はしない
- [x] 永続化の方針: 保存しない。メモリのみ（NFR-009）
- [x] MVP の生存確認の方法: チャネルサーバーを MVP に入れ、ロングポーリングで確認する（ADR 0006）
- [ ] チャネル機能を宣言しない通常の MCP サーバーとして起動すれば、MVP で開発用フラグ・警告画面が不要か（ADR 0006）
- [x] 30 セッションの一覧の整理: アカウントでグループ化（`../20-design/screens/README.md`）
- [x] 画面への状態反映の方式: WebSocket（`../20-design/architecture.md`）
- [x] スマホ表示のレスポンシブ対応: 次の段階（外部公開と同時）
- [x] 画面側のフレームワーク: React + Vite（`../20-design/architecture.md`）
- [ ] 外部公開の方式（Cloudflare Tunnel + Access／Tailscale）→ ADR 0005
- [ ] 外部からの許可応答を「拒否のみ」に絞るか
