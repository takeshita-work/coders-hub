# 0002: 許可応答に Channels の許可中継を使う

- ステータス: Accepted
- 日付: 2026-10-07（2026-10-09 に Windows のターミナル版で、中継の受信と応答を確認し、Proposed から Accepted に変更）

## 背景
許可プロンプトにアプリから応答したい（REQ-004）。ターミナルのダイアログとも共存させたい（REQ-005）。

## 選択肢
1. Channels の許可中継（`claude/channel/permission`）
2. PermissionRequest フック（同期）
3. Notification フック（通知のみ）

## 決定
Channels の許可中継を使う。

## 理由
- ターミナルとアプリの両方に同時に出て、先に返った回答が使われる（完全な共存）
- PermissionRequest フックは応答待ちの間ターミナルで応答できない

## 影響・トレードオフ
- ADR 0001 が覆った場合は見直しが必要。その場合の代替は、PermissionRequest フックを短いタイムアウトで使い、応答がなければターミナルに任せる方式
- 実機で確認した: 許可画面が出ると、チャネルサーバーに `notifications/claude/channel/permission_request`（`request_id`・`tool_name`・`description`・`input_preview`）が届く。`notifications/claude/channel/permission`（`request_id`・`behavior: allow`）を返すと、許可画面が消えて実行が進む
- 未検証: 先にターミナルで応答したときの、中継側の要求の扱い（共存）。`deny` の応答。PermissionRequest フックとダイアログの表示順序
