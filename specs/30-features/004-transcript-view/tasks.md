# 004 会話の表示 タスク

- 対応 plan: ./plan.md
- 凡例: `[ ]` 未着手 / `[x]` 完了。★は検証タスク（結果によって以降の計画が変わる）

## フェーズ 0: 検証（実機のログで確認）
- [x] T0-1 ★ `AskUserQuestion` の答えが、会話ログのどこにどの形で記録されるか → `tool_use` の `input.questions` と、結果のレコードの `toolUseResult.answers`（質問文 → 答え）。`tool_result.content` にも文章で入る（実機のログで確認）
- [x] T0-2 ★ ダッシュボードから送った指示の記録（`origin: channel`・`isMeta`・`<channel … id>`）の本文の形を、複数のログで確認する（確認済み。パーサーのテストの元データにする）
- [ ] T0-3 ★ `/clear`・`/compact` のあとの会話ログ（新しいファイルになるか、`transcript_path` が変わるか）を確認する
- [x] T0-4 拒否・エラーの `tool_result` の形 → `is_error: true`、本文は `The user doesn't want to proceed with this tool use. The tool use was rejected …`（実機のログで確認）

## フェーズ 1: パーサー（`src/hub/conversation.mjs`）
- [x] T1-1 `parseConversation`: 利用者の発言・応答・ツール行・`AskUserQuestion`・ダッシュボードの指示（AC-007-2〜5）
- [x] T1-2 捨てるもの（思考・サブエージェント・システムの記録・スラッシュコマンド・中断・`isMeta`）（AC-007-4・9）
- [x] T1-3 4,000 文字で切る（AC-007-7）
- [x] T1-4 壊れた行・不明なレコードを飛ばす（AC-007-18）

## フェーズ 2: 読み取り（`readConversation`・`locateTranscript`）
- [x] T2-1 末尾から 256 KB ずつ読む。完全な行だけを使う。先読みによるツール結果の突き合わせ（AC-007-1・8）
- [x] T2-2 `before`・`cursor`・先頭までさかのぼれる（上限なし）（AC-007-8）
- [x] T2-3 書き込み途中の末尾の行を使わない。1 回の読み取りは 8 MB まで（AC-007-18・19）
- [x] T2-4 ETag（更新時刻とサイズ）。読んだ内容を残さない（キャッシュ・モジュール変数なし。AC-007-13）
- [x] T2-5 会話ログの場所の決定（`transcript_path` の検証、`projects/*/<id>.jsonl` の探索）（AC-007-15・16）

## フェーズ 3: API（`src/hub/hub.mjs`）
- [x] T3-1 `GET /api/sessions/:sessionId/conversation`。保護を読み取りにも適用（AC-007-15）
- [x] T3-2 304・`Cache-Control: no-store`・エラー（404・400・500）（AC-007-11・13・17）
- [x] T3-3 `../../20-design/api/README.md` に、この API を追記する

## フェーズ 4: 画面のロジックとクライアント
- [x] T4-1 `client.mjs` の `fetchConversation`（ETag を画面のメモリで持つ。保存しない。AC-007-14）
- [x] T4-2 `logic.mjs`: 最新ページの置き換え・古いページの前置き・送った指示の重複除去（AC-007-3・8）

## フェーズ 5: 画面の部品
- [x] T5-1 会話の表示（発言・応答・ツール行・質問と答え・時刻・「ダッシュボードから」の目印）（AC-007-1〜6）
- [x] T5-2 2 秒ごとの取得（詳細を開いている間・タブが見えている間だけ）と、止める条件（AC-007-10・12）
- [x] T5-3 「さらに表示」とスクロール位置の保持。新着は、一番下の近くにいるときだけ一番下へ（AC-007-8、機能 006 の AC-UI-23）
- [x] T5-4 読み込めないときの表示と、自動での回復（AC-007-17）
- [x] T5-5 描画の工夫（`content-visibility`。AC-007-20）

## フェーズ 6: テストと確認
- [x] T6-1 パーサー・読み取り・API のテスト（AC-007-1〜19）。実機の形式に合わせた小さなログを元データにする
- [x] T6-2 大きなログ（10 MB 超の合成ログ）で、最新 20 件が 1 秒以内、さかのぼってもログ全体を読まない（AC-007-19）
- [x] T6-3 画面のテスト（SSR・jsdom）。機能 006 のテストを、会話の領域に合わせて更新する
- [ ] T6-4 実機の通し確認（`acceptance.md` を作る）
- [x] T6-5 機能 006 の spec・acceptance の「会話の本文は機能 004」の箇所を更新する
