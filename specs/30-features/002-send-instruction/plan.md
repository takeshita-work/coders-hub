# 002 指示の送信 実装計画

- ステータス: Draft
- 対応 spec: ./spec.md
- 関連 ADR: 0001, 0011, 0012, 0013
- 参考: `../001-session-list/plan.md`、`../../../docs/research/claude-code-mechanisms.md`

## 方針
画面から Hub 本体へ指示を送る。Hub 本体は、セッションが**返答待ち**のときだけ、そのセッションのチャネルサーバーの `/poll` の応答として指示を渡す（作業中・許可待ち・質問待ちの間は保留する。ADR 0013）。チャネルサーバーは、それを `notifications/claude/channel` として `claude` に通知する。

作業中に届いた通知は、指示ではなく「外部からの参考情報」の注意書きとして渡され、モデルは従わない（実機で確認、ADR 0013）。そのため、`claude` 側のキューには頼らない。

```
画面 ──POST /api/sessions/:id/instructions──► Hub 本体
                                                │  state == waiting になるまで保留（メモリ）
                                                │  waiting になったら 1 件だけ /poll の応答（200 { instructions }）
                                                ▼
                                       channel.mjs（--channel）
                                                │  notifications/claude/channel（meta: { id }）
                                                ▼
                                             claude  ──► 会話ログ（JSONL）に記録
                                                              ▲
                          Hub 本体が会話ログを確認して「届きました」などにする
```

## 実機で分かったこと（フェーズ 0、2026-10-09）

| 項目 | 結果 |
|---|---|
| フラグなしで起動 | エラーも警告もなく起動・接続する。通知は黙って捨てられ、会話ログに何も残らない |
| `meta` | キーがタグの属性になる。`<channel source="coders-hub-channels" id="x1" kind="probe">本文</channel>`。通知の約 2 ミリ秒後に `queue-operation` の `enqueue` として記録される |
| 返答待ちで届いた通知 | `enqueue` → 約 10 ミリ秒後に `dequeue`。`type: user`、`origin.kind: channel` の通常のユーザー入力として処理される |
| ターン終了の直後に届いた通知 | 通常のユーザー入力として次のターンで処理される。送った順が保たれる |
| ツールを使う作業の途中（許可待ちを含む）に届いた通知 | `enqueue` → `remove`。`attachment`（`queued_command`）として記録され、「NOT from your user … untrusted external data」の注意書きで渡される。モデルは従わなかった |
| 特殊文字・長文 | 引用符・バックスラッシュ・`<`・`&`・改行・日本語は保たれる。5,000 文字も全部届く。`</channel>` だけ `<\/channel>` になる |

## 部品と責務

| 部品 | 追加する責務 |
|---|---|
| `channel.mjs` | 引数 `--channel` のとき、`claude/channel` を宣言する。`/poll` の本文に `channel: true` を付ける。応答の指示を、`meta: { id }` 付きの通知として送り、結果（送信できた／失敗）を次の `/poll` で本体へ返す |
| `sessions.mjs`（ストア） | セッションに `controllable`（操作モードのチャネルサーバーが接続中）を持たせる。状態が `waiting` になったことを、指示の待ち行列へ知らせる |
| `instructions.mjs`（新規） | 指示の待ち行列（セッションごと）、状態、1 件ずつの払い出し、取り消し、タイムアウト、本文の破棄 |
| `hub.mjs` | 画面用の書き込み API、保護（ADR 0012）、`/poll` の応答に指示を載せる、WebSocket への配信 |
| `monitor.mjs`（会話ログの監視） | 渡した指示のあるセッションの会話ログを確認し、`id` を含む記録を見つけて結果を判定する |
| 画面 | 行の「指示を送る」操作、入力欄、保留中の表示と取り消し、結果の表示 |

## API の追加

### 画面用（`:8766`、ADR 0012 の保護あり）
`POST /api/sessions/:sessionId/instructions`
- 本文: `{ "text": "..." }`
- 応答: 202 `{ "id": "<指示の ID>", "status": "held" | "delivering" }`
- エラー: 400（空・不正）、403（保護）、404（セッションなし）、409（操作モードでない）、413（上限超過）

`DELETE /api/sessions/:sessionId/instructions/:id`
- 保留中の指示を取り消す。応答: 204。保留中でなければ 409、なければ 404

### WebSocket `/ws`
| `type` | 内容 |
|---|---|
| `instruction` | `{ sessionId, id, status, reason? }`。`status` は下記 |

`Session` に次を加える。
- `controllable`（boolean）
- `pending`: 保留中の指示の `[{ id, createdAt, preview }]`（`preview` は先頭 40 文字。画面の再読み込み・再接続後の表示用）

### 内部（`:8765`）
`POST /poll`
- 要求に追加: `channel`（boolean。操作モードなら true）、`results`（`[{ id, ok, error? }]`。前回の応答で受けた指示の送信結果）
- 応答: 指示があれば 200 `{ "instructions": [{ "id", "text" }] }`（常に 1 件）。なければ今までどおり約 30 秒後に 204
- 指示を払い出す条件になったら、待機中の `/poll` をすぐ 200 で終わらせる

## 指示の状態

```
held(保留中) ──(state==waiting, 先頭の 1 件)──► delivering ──(results: ok)──► sent
   │                                              │   └─(results: ng)──► failed
   ├─(取り消し)──► cancelled                       └─(15 秒)──► unconfirmed
   └─(セッション終了/Hub 再起動)──► lost
sent ──(会話ログ: id 付きの user 記録)──► confirmed
sent ──(会話ログ: id 付きの queued_command / remove)──► missed
sent ──(15 秒)──► unconfirmed
```

- 払い出す条件: そのセッションの `state` が `waiting` で、前に渡した指示が `confirmed`／`missed`／`unconfirmed`／`failed` のいずれかで終わっていること（1 件ずつ）
- 本文は、`delivering` に移る時点で Hub 本体のメモリから消す（AC-002-10）。以降は ID と状態だけを持つ
- 終わった状態（`confirmed` など）の指示の記録は、60 秒後に消す
- Hub 本体を再起動すると、保留中の指示は消える。画面は、再接続のスナップショットの `pending` に ID がないことで `lost` と判定する

## 結果の確認
1. `delivering`／`sent` の指示があるセッションの会話ログ（`transcript_path`）の末尾を、短い間隔（約 0.5 秒）で確認する（ADR 0007 の仕組みを流用する）
2. 通知の `meta` に `id` を付ける。会話ログの `queue-operation`（`enqueue`）の本文に `id="<ID>"` が出る
3. 判定:
   - `enqueue` のあと、`type: user`・`origin.kind: channel` の記録（同じ `id`）→ `confirmed`
   - `enqueue` のあと `remove`、または `attachment`（`queued_command`）の記録 → `missed`
   - どちらも 15 秒以内に見つからない → `unconfirmed`
4. 会話ログが読めない場合は、`unconfirmed` になるだけで、送信自体には影響しない（NFR-008）

## 検証事項（残り）
1. 質問待ち（`AskUserQuestion`）の間に届いた通知の扱い（許可待ちと同じ注意書きになる想定）
2. 払い出しと同時にターミナルで入力が始まったときの記録（`missed` の判定の確認）

## リスク
- Channels は research preview で、仕様が変わるおそれがある（ADR 0001）。通知の形式を `channel.mjs` に閉じ込める
- 注意書きの文面や、`remove` の記録は内部フォーマット（NFR-008）。変わったら `missed` を判定できず、`unconfirmed` になる
- 画面側の書き込み API は、PC 上でコマンドを実行させる入口になる。保護（ADR 0012）のテストを必ず書く
- 保留中の指示が、状況の変わったあとに実行されるおそれがある。保留中の表示と取り消しで補う

## テスト方針

| AC | 確認方法 |
|---|---|
| AC-002-1, 002-5 | 画面の部品のテスト（`web-components`）。`controllable` の有無で入力が出る・出ない |
| AC-002-3 | `channel` のテスト。特殊文字を含む本文が変わらず通知になる |
| AC-002-4 | 入力検証のテスト（`hub` の API、画面の入力） |
| AC-002-6〜002-9 | `instructions`（状態遷移とタイムアウト）、`hub`（API と WebSocket）、`monitor`（記録の判定） |
| AC-003-1〜003-5 | `instructions`（1 件ずつの払い出し、取り消し、消失）、`hub`、`web-logic`（`lost` の判定） |
| AC-002-2, 005-1〜005-3 | 実機の手順（`acceptance.md`） |
| AC-002-10 | `instructions` のテスト（払い出し後に本文が残らない） |
| AC-002-11 | `hub` のテスト（`Host`・`Origin`・ヘッダー・`Content-Type`） |
| 結合 | `e2e`：本物の `hook.mjs`・`channel.mjs`（`--channel`）と Hub を起動し、模擬の MCP クライアントで通知を受ける |
