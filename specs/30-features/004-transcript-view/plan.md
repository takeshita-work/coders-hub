# 004 会話の表示 実装計画

- ステータス: Draft
- 対応 spec: ./spec.md
- 関連 ADR: 0016（読み方）、0012（保護）、0007（ログの末尾読み）、0015
- 参考: `../../20-design/api/README.md`

## 方針
Hub に、会話ログを読む部品（`conversation.mjs`）と、取得 API（`GET /api/sessions/:sessionId/conversation`）を足す。画面は、詳細を開いている間だけ、条件つきで取得を繰り返し、会話の領域に出す。Hub は本文を持たない（要求のたびに読み、返したら捨てる。ADR 0016）。

```
詳細を開いている間 2 秒ごと ──GET /conversation（If-None-Match）──► Hub ──► 会話ログ（JSONL）の末尾から読む
「さらに表示」           ──GET /conversation?before=<位置>────────►     （ファイルの更新時刻・サイズで ETag）
```

## 会話ログの形式（実機で確認、open-questions 参照）
1 行 1 レコード。使うのは次だけ。

| レコード | 取り出すもの |
|---|---|
| `user`（本文が文字列、または `text` ブロック） | 利用者の発言。`isSidechain` はサブエージェントなので除く。`isMeta` は除くが、`origin.kind` が `channel` のものは、ダッシュボードから送った指示として出す（本文は `<channel source="coders-hub" id="…">\n本文\n</channel>`。ID を取り出す） |
| `assistant` の `text` ブロック | Claude の応答 |
| `assistant` の `tool_use` | ツールの使用（名前）。`AskUserQuestion` は質問文（`input.questions`） |
| `user` の `tool_result`（`tool_use_id`、`is_error`） | 対応するツール行の結果。`is_error` が真で、本文に `doesn't want to proceed`（実機: `The user doesn't want to proceed with this tool use. The tool use was rejected …`）または `User rejected tool use`（ADR 0007 の記録）を含めば「拒否」、そのほかの `is_error` は「エラー」、それ以外は「成功」。文言が変わっても、「エラー」と表示されるだけで害はない。`AskUserQuestion` は答え（レコードの `toolUseResult.answers`。質問文 → 答え）を質問に添える |

捨てるもの: `thinking`、ツールの入力・出力の本文、`system`・`attachment`・`last-prompt` などの記録、`<command-name>`・`<local-command-…>` などのスラッシュコマンドの記録（本文が `<command-` または `<local-command` で始まる）、中断の記録（`[Request interrupted by user…`）。不明なレコードは無視する（NFR-008）。

## 部品

| 部品 | 責務 |
|---|---|
| `src/hub/conversation.mjs`（新規） | `parseConversation(lines)`: レコードの並びから、メッセージの並びを作る（上の表）。`readConversation(file, { before, limit })`: ファイルを末尾から読む。`locateTranscript(session)`: 会話ログの場所を決める |
| `src/hub/hub.mjs` | `GET /api/sessions/:sessionId/conversation`。保護（Host・Origin・独自ヘッダー）を読み取りにも適用する |
| `src/web/client.mjs` | `fetchConversation(sessionId, { before, etag })`（`Cache-Control` を使わず、ETag は画面のメモリ内で持つ） |
| `src/web/logic.mjs` | 取得した結果の統合（最新ページの置き換え、古いページの前置き）、送った指示の重複除去 |
| `src/web/markdown.mjs`（新規） | 応答の Markdown を React の要素に整形する（`marked` の字句解析のみ使う。HTML 文字列を作らない。ADR 0017） |
| `src/web/components.mjs` | 会話の表示（発言・応答・ツール行・質問と答え・自動の読み込み・読み込めないときの表示） |
| `src/web/styles.css` | 会話の見た目（試作のものを元に）。件数が多いときの描画の工夫 |

## 読み方（`readConversation`）
- 入力: ファイルのパス、`before`（位置。省略なら末尾）、`limit`（既定 20、上限 100。発言・応答・質問の数で、ツールの行は数えない）
- 末尾（または `before`）から前へ、256 KB ずつ読む。改行で切って、完全な行だけを使う。チャンクの先頭の中途半端な行は、次のチャンクと合わせる
- 取り出したメッセージ（ツールの行を除く）が `limit` に達するか、ファイルの先頭に着くか、1 回の取得で読む量が 8 MB に達するまで続ける。8 MB で止まったときは、そこまでの分を返し、`cursor` で続きを読めるようにする
- 末尾（または `before`）の後ろにも、256 KB だけ先読みして、ツールの結果の突き合わせにだけ使う（ツールの使用と結果が、ページの境目で離れないように）。先読み分のメッセージは返さない
- 末尾の、書き込み途中の行（改行がない・JSON として壊れている）は、使わない
- 戻り値: `{ messages, cursor, etag }`。`messages` は古い順。各メッセージに、ログの位置から作った `id`。`cursor` は、さらに前を読むための位置（先頭に達していれば `null`）。`etag` は、ファイルの更新時刻とサイズから作る
- 本文は、4,000 文字で切る（`truncated: true`）。読んだ内容は、関数の外に残さない（モジュールの変数・キャッシュを持たない）

## 会話ログの場所（`locateTranscript`）
1. Hub が受け取った `transcript_path`（`store.transcriptOf`）。ただし、ファイル名が `<sessionId>.jsonl` で、親の親のフォルダ名が `projects` のときだけ使う（内部 API は認証がないので、任意のファイルを読ませない）
2. なければ（Hub の再起動後など）、`<アカウント>/projects/*/<sessionId>.jsonl` を探す（アカウントがなければ `~/.claude`）。`sessionId` は、英数字とハイフンだけを許す
3. 見つからなければ 404（`no-transcript`）

## API
`GET /api/sessions/:sessionId/conversation?limit=20&before=<位置>`

- 保護: `Host`・`Origin`・`X-Coders-Hub: 1`（ADR 0012 の検査を、読み取りにも使う。通らなければ 403）
- 応答: 200 `{ messages, cursor }`、ヘッダー `ETag`・`Cache-Control: no-store`。`If-None-Match` が一致すれば 304（本文なし。`before` がない最新ページのときだけ）
- エラー: 404（セッションなし・`no-transcript`）、400（`limit`・`before` が不正）、500（`unreadable`。読めない・形式が想定外）。エラーの本文は `{ error, message }`
- メッセージの形: `{ id, at, role: 'user' | 'assistant' | 'tool' | 'question', text?, truncated?, source?: 'dashboard', instructionId?, tool?: { name, result: 'ok' | 'rejected' | 'error' | null }, answers?: [{ question, answer }] }`

## 画面
- 取得は、詳細を開いている間（`document.hidden` でないとき）、2 秒ごとに、最新ページへ `If-None-Match` つきで行う。304 なら何もしない。詳細を閉じる・別のセッションに移るときは、止める
- 前の分の読み込みは、ボタンではなく、上の端（300px 以内）までスクロールしたとき、または内容が画面に満たないときに、自動で行う（同じ位置からの補充は 1 回だけ）
- 最新ページの結果は、いま持っているメッセージのうち、最新ページの最も古い `id` 以降を置き換える。「さらに表示」の結果は、前に足す（`cursor` を更新する）
- スクロール（機能 006 の AC-UI-23 を、会話の更新にも広げる）
  - 開いたとき・自分の操作（指示の送信・カードの出現）のあとは、一番下へ
  - 会話の新着は、一番下の近くにいるときだけ一番下へ。上を読んでいるときは動かさない
  - 前に足したときは、いま見ている位置が動かないよう、増えた高さの分だけスクロール位置を足す
- 表示の順: 会話 → 応答待ちの許可要求・質問のカード → 結果の行・送った指示・保留中（機能 006 の順）。「届きました」の記録は、同じ `instructionId` の発言が会話にあれば出さない
- 幅が狭いとき（AC-007-21）: 会話の列を `minmax(0, 1fr)` にし、長い 1 語は折り返す（`overflow-wrap: anywhere`）。コードブロック・表は、その中で横にスクロールする
- 描画の工夫（AC-007-20）: メッセージに `content-visibility: auto` を付け、画面の外の分は描画を省く。仮想化のライブラリは使わない
- 読み込めないとき: 会話の領域に「会話を読み込めません」。次の取得で直れば、自動で戻る

## リスクと確認
- **会話ログの形式の変化（NFR-008）**: 想定外のレコードは無視し、取り出せない場合は件数が 0 になる。0 件が続くときの検知は、実機で形式が変わったときに見直す
- **大きなログ**: 11 MB 級のログで、最新 20 件が 1 秒以内に返ること、さかのぼってもログ全体を読まないことを、合成のログで計測する（AC-007-19）
- **読み取りの保護**: 他のサイトからの読み取り（DNS rebinding・別オリジン）が通らないことをテストする（AC-007-15）
- **実機で確認すること**: ダッシュボードから送った指示の ID の突き合わせ、`AskUserQuestion` の答えの記録の形、`/clear` のあとの会話ログ（新しいファイルになるか）
