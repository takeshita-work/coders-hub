# API 定義

- ステータス: Draft（一覧、指示の送信（機能 002）、許可・質問への応答（機能 003）まで）
- 実装: `src/hub/hub.mjs`。結合テスト: `tests/hub.test.mjs`、`tests/hub-instructions.test.mjs`、`tests/hub-requests.test.mjs`
- 概要は `../architecture.md`、セキュリティは `../security.md`

## 内部 API（`127.0.0.1:8765`、外部公開しない）
`hook.mjs`・`channel.mjs` から Hub 本体への通信。本文は JSON（上限 1MB）。

| エンドポイント | 呼び出し元 | 内容 | 応答 |
|---|---|---|---|
| `GET /health` | channel | 起動確認 | 200 `ok` |
| `POST /event` | hook | フックのイベントを通知 | 204。本文が不正なら 400、大きすぎれば 413 |
| `POST /poll` | channel | 登録・生存確認のロングポーリング。操作モードでは指示の受け取りも兼ねる | 指示がなければ約 30 秒後に 204。指示があれば 200 |
| `POST /bye` | channel | 終了の通知（stdin が閉じたとき） | 204 |
| `POST /permission` | channel | 許可要求の転送（操作モード。機能 003） | 204。400（不正）、404（セッションなし）、409（操作モードでない） |
| `POST /ask` | ask-hook | 質問（`AskUserQuestion`）の転送。答えが入るまで保留（機能 003、ADR 0014） | 答えがあれば 200 `{ answers }`。それ以外は 204 |

### `POST /event`
```json
{
  "event": "UserPromptSubmit",
  "account": "C:\\Users\\yuya\\.claude-takeshita.work",
  "input": { "session_id": "...", "cwd": "...", "transcript_path": "...", "prompt": "..." }
}
```
- `event`: フック名（必須）。`input`: フックの標準入力の JSON（必須。`session_id` がなければ無視される）。`hook.mjs` は大きい項目（ツールの入出力など）を除き、`session_id`・`cwd`・`transcript_path`・`prompt`（2000 字まで）・`notification_type`・`reason`・`tool_name`・`source` だけを送る
- `account`: 環境変数 `CLAUDE_CONFIG_DIR`（なくてもよい）
- 状態への影響は `../../30-features/001-session-list/plan.md`「状態遷移とフック」を参照

### `POST /poll`
```json
{ "session": "<CLAUDE_CODE_SESSION_ID>", "account": "<CLAUDE_CONFIG_DIR>", "cwd": "...", "pid": 1234 }
```
- `session` は必須。初回の呼び出しでセッションを登録する（Hub の再起動後も、次の呼び出しで一覧に戻る）
- 同じ `session` の新しい `/poll` が来たら、古い `/poll` は 204 で終わる（1 セッション 1 本）
- **応答する前に接続が切れたら、`claude` が終了したと見なして即座に一覧から外す**（強制終了の検知。NFR-006）
- 最後の `/poll` から `expireMs`（既定 50 秒）を過ぎても外す。切断を検知できない場合の保険
- 操作モード（機能 002、ADR 0011）の追加項目:
  - 要求: `channel`（boolean。`channel.mjs --channel` なら true。このセッションが `controllable` になる）、`results`（`[{ id, ok, error? }]`。前回の応答で受けた指示の通知の結果）
  - 応答: 渡せる指示があるとき 200 `{ "instructions": [{ "id", "text" }] }`（常に 1 件。ADR 0013）。待機中の `/poll` は、渡せる指示ができた時点で（その場で）応答する
  - 渡す条件: そのセッションの状態が返答待ち（`waiting`）で、前の指示が片づいていること
- 許可の応答（機能 003、ADR 0002）: 画面から許可・拒否が返ると、応答に `"verdicts": [{ "request_id", "behavior": "allow" | "deny" }]` が加わる（指示と同じ応答に載ることがある）。待機中の `/poll` は、応答ができた時点で（その場で）応答する。渡した応答は二度渡さない

### `POST /permission`
```json
{ "session": "...", "request_id": "abcde", "tool_name": "Bash", "description": "...", "input_preview": "{ ... }" }
```
- チャネルサーバーが、`claude` から受けた `notifications/claude/channel/permission_request` を転送する。`session`・`request_id`・`tool_name` は必須
- `input_preview` は、`claude` が省略して渡すことがある（約 3,600 文字を超えると中間が `⋯ N code points elided ⋯` になる）。Hub はそのまま持つ
- 同じ `request_id` が応答待ちなら、二重には載せない
- 要求は、そのセッションの `requests` に載り、WebSocket の `request` で通知される

### `POST /ask`
```json
{ "session": "...", "questions": [{ "question": "...", "header": "...", "options": [{ "label": "...", "description": "..." }], "multiSelect": false }] }
```
- `AskUserQuestion` 用の同期フック（`ask-hook.mjs`）が、質問（`tool_input.questions`）を送る。Hub は、答えが入る・要求が閉じる・待ち時間（既定 85 秒）が過ぎるまで、応答を保留する
- 応答: 答えが入れば 200 `{ "answers": { "<質問文>": "<答え>" } }`。複数選択の答えはカンマ区切りの 1 つの文字列。それ以外（操作モードでない・不明なセッション・時間切れ・ターミナルで先に応答）は 204。フックは 204 のとき何も出力せず、`claude` の質問画面に任せる
- 400: `session` がない・`questions` が不正
- 応答する前に接続が切れた（フックが強制終了された。ターミナルで拒否など）ら、要求を閉じる

## 画面側（`127.0.0.1:8766`）

### 静的ファイル
- `GET /` ほか: 画面のビルド結果（`dist/web/`）を配信する。`index.html` がなければ、動作確認用の簡易ページを返す
- 配信フォルダの外のファイルは返さない（403）

### 指示の送信・許可と質問への応答（`/api/`。書き込みは ADR 0012 の保護あり）
書き込み（POST・DELETE）は、次をすべて満たすときだけ受け付ける。満たさなければ 403（CORS のヘッダーは返さない）。
- `Host` が `127.0.0.1:<画面ポート>` か `localhost:<画面ポート>`
- `Origin` があるときは `Host` と同じオリジン
- ヘッダー `X-Coders-Hub: 1`
- POST は `Content-Type: application/json`

| エンドポイント | 内容 | 応答 |
|---|---|---|
| `POST /api/sessions/:sessionId/instructions` | 本文 `{ "text": "..." }`。1〜10,000 文字 | 202 `{ "id", "status" }`（`held` または `delivering`）。400（空・不正）、403、404（セッションなし）、409（操作モードでない）、413（上限超過） |
| `DELETE /api/sessions/:sessionId/instructions/:id` | 保留中の指示の取り消し | 204。404（指示なし）、409（保留中でない） |
| `POST /api/sessions/:sessionId/requests/:requestId/response` | 許可要求・質問への応答。許可: `{ "behavior": "allow" \| "deny" }`。質問: `{ "answers": { "<質問文>": "<答え>" \| ["<答え>", …] } }`（配列はカンマ区切りにして渡す。答えは 1 つ 2,000 文字まで。空は不可） | 204。400（形が不正・答えが足りない）、403、404（セッション・要求なし）、409（すでに閉じている） |

エラーの本文は `{ "error": "<コード>", "message": "<理由>" }`。

### WebSocket `/ws`
`Origin` ヘッダーがあるときは、`Host` と同じものだけ受け付ける（別サイトのページからの接続を防ぐ）。Hub からブラウザへの一方向（ブラウザからのメッセージは使わない）。

| `type` | 内容 | いつ |
|---|---|---|
| `snapshot` | `{ now, sessions: [Session] }` | 接続した直後。再接続のたびに取り直す |
| `added` | `{ session }` | セッションが増えたとき |
| `updated` | `{ session }` | 見える項目が変わったとき |
| `removed` | `{ sessionId }` | セッションが外れたとき |

| `instruction` | `{ sessionId, id, status, reason? }` | 指示の状態が変わったとき |
| `request` | `{ sessionId, id, status, reason? }` | 許可要求・質問の状態が変わったとき |

`status`: `held`（保留中）／`delivering`（渡した）／`sent`（通知できた）／`confirmed`（届いた）／`missed`（指示として扱われなかった）／`unconfirmed`（15 秒たっても確認できない）／`failed`（通知に失敗）／`cancelled`（取り消し）／`lost`（セッション終了などで消えた）。

`request` の `status`: `open`（応答待ち）／`allowed`（許可した）／`denied`（拒否した）／`answered`（回答した）／`terminal`（ターミナルで応答済み）／`timeout`（質問の時間切れ）／`failed`（応答できなかった。セッションの終了など）。

`now` は Hub の時刻（ミリ秒）。経過時間は `stateSince` から画面側で計算する（AC-001-8）。

### Session
| 項目 | 内容 |
|---|---|
| `sessionId` | セッションの識別子 |
| `account` | `CLAUDE_CONFIG_DIR`（不明なら `null`） |
| `cwd` | 作業ディレクトリ（不明なら `null`） |
| `state` | `working` / `waiting` / `permission` / `question` |
| `stateSince` | 現在の状態になった時刻（ミリ秒） |
| `lastPrompt` | 最後のプロンプト（なければ `null`） |
| `channelAlive` | チャネルサーバーが接続しているか |
| `controllable` | 操作モードのチャネルサーバーが接続している（指示を送れる） |
| `requests` | 応答待ちの許可要求・質問。許可: `{ id, kind: 'permission', createdAt, toolName, description, inputPreview }`。質問: `{ id, kind: 'question', createdAt, questions: [{ question, header, options: [{ label, description }], multiSelect }] }`。閉じたら外れ、本文は残らない |
| `pending` | 保留中の指示 `[{ id, createdAt, preview }]`。`preview` は先頭 1 行の 40 文字まで（本文は含まない）。再接続した画面が、保留中の指示が消えたことを検知するのに使う |
