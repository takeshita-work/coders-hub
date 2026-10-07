# 0001: 指示の送信に Channels を使う

- ステータス: Proposed（Windows のターミナル版での動作確認後に Accepted）
- 日付: 2026-10-07

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
- 未検証: Windows のターミナル版での動作（`../10-requirements/open-questions.md`）。動かない場合は asyncRewake を主方式に切り替える（新しい ADR で置き換える）
