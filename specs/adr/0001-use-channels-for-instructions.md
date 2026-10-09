# 0001: 指示の送信に Channels を使う

- ステータス: Accepted
- 日付: 2026-10-07（2026-10-09 に Windows のターミナル版 `claude` 2.1.295 で動作を確認し、Proposed から Accepted に変更）

## 背景
実行中のセッションへ、時間がたってからでも指示を送る必要がある（REQ-002）。ターミナルでの操作とも共存させたい（REQ-005）。

## 選択肢
1. Channels（主）
2. asyncRewake の Stop フック
3. `claude -p --resume` / Agent SDK

## 決定
Channels を主方式とし、asyncRewake の Stop フックを代替とする。Hub 本体は両方式に対応させる。
`claude -p --resume` は別プロセスになり、実行中セッションへの介入に向かないため採用しない。

## 理由
- 待機時間の上限がない。アイドル中でも送れる
- 作業中に届いた指示はキューに入る
- 許可プロンプトの中継も同じ仕組みでできる（ADR 0002）

## 影響・トレードオフ
- 自作チャネルは `--dangerously-load-development-channels` が必要で、起動のたびに警告画面の承認（Enter）が要る
- research preview の機能で、仕様が変わる可能性がある
- 対話的な TTY が必要。VS Code 拡張では動かない可能性がある
- Team / Enterprise プランは管理者による有効化が必要
- 通知に受信確認がなく、チャネルが無効だと黙って捨てられる
- Windows のターミナル版での動作は、実機で確認した（`spikes/probe-channels.mjs`）
  - 開発用フラグ付きで起動すると、画面に「Channels (experimental) messages from server:… inject directly in this session」と表示され、チャネルとして登録される
  - アイドル中のセッションに通知を送ると、ユーザー入力（`origin.kind: channel`）として処理され、応答する
  - 作業中に届いた通知はキューに入り、ターンの終わった直後（約 10 ミリ秒後）に処理される
  - 本文は `<channel source="サーバー名">…</channel>` として渡る。会話の記録にも残る
- `claude_start.ps1` の環境名のあとに、フラグをそのまま渡せる
