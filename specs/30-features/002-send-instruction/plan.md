# 002 指示の送信 実装計画

- ステータス: Draft
- 対応 spec: ./spec.md
- 関連 ADR: 0001, 0011, 0012
- 参考: `../001-session-list/plan.md`、`../../../docs/research/claude-code-mechanisms.md`

## 方針
画面から Hub 本体へ指示を送り、Hub 本体が、そのセッションのチャネルサーバーの `/poll` の応答として渡す。チャネルサーバーは、それを `notifications/claude/channel` として `claude` に通知する。
作業中に届いた通知は、`claude` 側のキューに入る（実機で確認済み）ので、Hub 本体では保留しない。Hub 本体は、「チャネルサーバーに渡すまで」の待ち行列だけを持つ。

```
画面 ──POST /api/sessions/:id/instructions──► Hub 本体（待ち行列・メモリ）
                                                │  /poll の応答（200 { instructions }）
                                                ▼
                                       channel.mjs（--channel）
                                                │  notifications/claude/channel
                                                ▼
                                             claude  ──► 会話ログ（JSONL）に記録
                                                              ▲
                          Hub 本体が会話ログを確認して「届きました」にする
```

## 部品と責務

| 部品 | 追加する責務 |
|---|---|
| `channel.mjs` | 引数 `--channel` のとき、`claude/channel` を宣言する。`/poll` の本文に `channel: true` を付ける。応答の指示を通知として送り、結果（送信できた／失敗）を次の `/poll` で本体へ返す |
| `sessions.mjs`（ストア） | セッションに `controllable`（操作モードのチャネルサーバーが接続中）を持たせる |
| `instructions.mjs`（新規） | 指示の待ち行列、状態（`queued`／`sent`／`confirmed`／`unconfirmed`／`failed`）、タイムアウト、本文の破棄 |
| `hub.mjs` | 画面用の書き込み API、保護（ADR 0012）、`/poll` の応答に指示を載せる、WebSocket への結果の配信 |
| `monitor.mjs`（会話ログの監視） | 指示が `sent` のセッションの会話ログを確認し、届いた記録を見つける |
| 画面 | 行の「指示を送る」操作、入力欄、結果の表示 |

## API の追加

### 画面用（`:8766`、ADR 0012 の保護あり）
`POST /api/sessions/:sessionId/instructions`
- 本文: `{ "text": "..." }`
- 応答: 202 `{ "id": "<指示の ID>" }`
- エラー: 400（空・不正）、403（保護）、404（セッションなし）、409（操作モードでない）、413（上限超過）

### WebSocket `/ws`
| `type` | 内容 |
|---|---|
| `instruction` | `{ sessionId, id, status, reason? }`。`status` は `queued`／`sent`／`confirmed`／`unconfirmed`／`failed` |

`Session` に `controllable`（boolean）を加える。

### 内部（`:8765`）
`POST /poll`
- 要求に追加: `channel`（boolean。操作モードなら true）、`results`（`[{ id, ok, error? }]`。前回の応答で受けた指示の送信結果）
- 応答: 指示があれば 200 `{ "instructions": [{ "id", "text" }] }`。なければ今までどおり約 30 秒後に 204
- 指示が入ったら、待機中の `/poll` をすぐ 200 で終わらせる

## 指示の状態

```
queued ──(/poll で渡した)──► 渡し済み ──(results: ok)──► sent ──(会話ログに記録)──► confirmed
   │                              │                          └─(15 秒)──► unconfirmed
   └─(15 秒たっても渡せない)─► unconfirmed      └─(results: ng)──► failed
```

- 本文は、チャネルサーバーに渡した時点で Hub 本体のメモリから消す（AC-002-10）。以降は ID と状態だけを持つ
- Hub 本体を再起動すると、待ち行列は消える。画面側は、15 秒のタイムアウトで `unconfirmed` にする（画面が自分で時計を持つ）
- 状態は `confirmed`／`unconfirmed`／`failed` になってから、一定時間（60 秒）で本体のメモリからも消す

## 「届きました」の確認
1. `sent` になった指示のセッションについて、会話ログ（`transcript_path`）の末尾を短い間隔（約 0.5 秒）で確認する（ADR 0007 の仕組みを流用する）
2. 実機の記録では、通知の直後に `queue-operation` の `enqueue` が書かれ、本文は `<channel source="...">本文</channel>` の形だった
3. 通知の `meta` に指示の ID を付けて、記録から読み取れれば、ID で突き合わせる（検証 2）。読めなければ、本文で突き合わせる

## 検証事項（実装前に実機で確認する）
1. チャネル機能を宣言したサーバーを、開発用フラグなしで起動したときの挙動
2. 通知の `meta`（`{ id: "..." }`）が、会話ログのどこに、どう残るか
3. 許可待ち・質問待ちのセッションに通知したとき、処理されるタイミング
4. 短時間に複数の通知を送ったときの順序
5. 長い本文・改行・特殊文字（引用符・バックスラッシュ・`<`・`>`）の通り方

## リスク
- Channels は research preview で、仕様が変わるおそれがある（ADR 0001）。通知の形式を `channel.mjs` に閉じ込める
- 会話ログの形式は内部フォーマット（NFR-008）。読めなくなったら「届いたか確認できません」になるだけで、送信自体には影響しない
- 画面側の書き込み API は、PC 上でコマンドを実行させる入口になる。保護（ADR 0012）のテストを必ず書く

## テスト方針

| AC | 確認方法 |
|---|---|
| AC-002-1, 002-5 | 画面の部品のテスト（`web-components`）。`controllable` の有無で入力が出る・出ない |
| AC-002-3 | `instructions` と `channel` のテスト。特殊文字を含む本文が変わらず通知になる |
| AC-002-4 | 入力検証のテスト（`hub` の API、画面の入力） |
| AC-002-6〜002-9 | `instructions`（状態遷移とタイムアウト）、`hub`（API と WebSocket） |
| AC-002-2, 003-1, 003-2, 005-1, 005-2 | 実機の手順（`acceptance.md`） |
| AC-002-10 | `instructions` のテスト（渡したあとに本文が残らない） |
| AC-002-11 | `hub` のテスト（`Host`・`Origin`・ヘッダー・`Content-Type`） |
| 結合 | `e2e`：本物の `hook.mjs`・`channel.mjs`（`--channel`）と Hub を起動し、模擬の MCP クライアントで通知を受ける |
