# API 定義

- ステータス: Draft（MVP の範囲。`/permission`・`/wait` と指示の送信は「次」の段階で追加する）
- 実装: `src/hub/hub.mjs`。結合テスト: `tests/hub.test.mjs`
- 概要は `../architecture.md`、セキュリティは `../security.md`

## 内部 API（`127.0.0.1:8765`、外部公開しない）
`hook.mjs`・`channel.mjs` から Hub 本体への通信。本文は JSON（上限 1MB）。

| エンドポイント | 呼び出し元 | 内容 | 応答 |
|---|---|---|---|
| `GET /health` | channel | 起動確認 | 200 `ok` |
| `POST /event` | hook | フックのイベントを通知 | 204。本文が不正なら 400、大きすぎれば 413 |
| `POST /poll` | channel | 登録・生存確認のロングポーリング | 指示がなければ約 30 秒後に 204 |
| `POST /bye` | channel | 終了の通知（stdin が閉じたとき） | 204 |

### `POST /event`
```json
{
  "event": "UserPromptSubmit",
  "account": "C:\\Users\\yuya\\.claude-takeshita.work",
  "input": { "session_id": "...", "cwd": "...", "transcript_path": "...", "prompt": "..." }
}
```
- `event`: フック名（必須）。`input`: フックの標準入力の JSON をそのまま（必須。`session_id` がなければ無視される）
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

## 画面側（`127.0.0.1:8766`）

### 静的ファイル
- `GET /` ほか: 画面のビルド結果（`dist/web/`）を配信する。`index.html` がなければ、動作確認用の簡易ページを返す
- 配信フォルダの外のファイルは返さない（403）

### WebSocket `/ws`
`Origin` ヘッダーがあるときは、`Host` と同じものだけ受け付ける（別サイトのページからの接続を防ぐ）。Hub からブラウザへの一方向（ブラウザからのメッセージは使わない）。

| `type` | 内容 | いつ |
|---|---|---|
| `snapshot` | `{ now, sessions: [Session] }` | 接続した直後。再接続のたびに取り直す |
| `added` | `{ session }` | セッションが増えたとき |
| `updated` | `{ session }` | 見える項目が変わったとき |
| `removed` | `{ sessionId }` | セッションが外れたとき |

`now` は Hub の時刻（ミリ秒）。経過時間は `stateSince` から画面側で計算する（AC-001-8）。

### Session
| 項目 | 内容 |
|---|---|
| `sessionId` | セッションの識別子 |
| `account` | `CLAUDE_CONFIG_DIR`（不明なら `null`） |
| `cwd` | 作業ディレクトリ（不明なら `null`） |
| `state` | `working` / `waiting` / `permission` |
| `stateSince` | 現在の状態になった時刻（ミリ秒） |
| `lastPrompt` | 最後のプロンプト（なければ `null`） |
| `channelAlive` | チャネルサーバーが接続しているか |
