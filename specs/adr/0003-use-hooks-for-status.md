# 0003: 状態取得にフックを使う

- ステータス: Accepted
- 日付: 2026-10-07

## 背景
全セッションの状態（作業中／返答待ち／許可待ち）を把握したい（REQ-001）。

## 選択肢
1. フック（UserPromptSubmit / Stop / Notification）
2. JSONL（会話ログ）のファイル監視

## 決定
状態の取得はフックで行う。JSONL の監視は会話内容の表示（補助）に限る。

## 理由
- フックはイベントごとに通知でき、`session_id` と `CLAUDE_CONFIG_DIR` でアカウント・セッションを判別できる
- JSONL は内部フォーマットで、バージョンアップで変わる可能性がある（NFR-008）

## 影響・トレードオフ
- アカウントごとに `settings.json` へフックの追加が必要（初回のみ）
- 未検証: `CLAUDE_CODE_SESSION_ID` とフックの `session_id` の一致
