# 003 許可・質問への応答 実装計画

- ステータス: Approved（2026-10-10。spec に合わせる）
- 対応 spec: ./spec.md
- 関連 ADR: 0002, 0010, 0011, 0012, 0014
- 参考: `../002-send-instruction/plan.md`（指示の送信と同じ構成を流用する）、`../../../docs/research/claude-code-mechanisms.md`

## 方針
許可と質問は、`claude` への入口が違うので、別々の経路で Hub 本体に集める。Hub 本体の中では、どちらも「要求（request）」として同じ待ち行列に入れ、画面からの応答の API を 1 つにそろえる。

| 種類 | 入口（`claude` → Hub） | 応答の戻し方（Hub → `claude`） |
|---|---|---|
| 許可 | チャネルサーバーが `notifications/claude/channel/permission_request` を受け、Hub の `POST /permission` へ転送 | 待機中の `/poll` の応答に `verdicts` を載せ、チャネルサーバーが `notifications/claude/channel/permission` を送る |
| 質問 | `AskUserQuestion` 用の同期フック（新規 `ask-hook.mjs`）が Hub の `POST /ask` を呼び、答えが返るまで待つ | `/ask` の応答（200 `{ answers }`）を、フックが `PermissionRequest` の `allow` ＋ `updatedInput.answers` として標準出力に書く |

```
許可   claude ─permission_request─► channel.mjs ─POST /permission─► Hub ◄─POST /api/…/response─ 画面
                                         ▲                           │
                                         └─── /poll の応答（verdicts）┘

質問   claude ─PermissionRequest(AskUserQuestion)─► ask-hook.mjs ─POST /ask（保留）─► Hub ◄─ 画面
                         ▲                                │                           │
                         └──── 標準出力（allow＋answers）─┘◄───── 200 { answers } ───┘
```

要求の閉じ方は 3 つ。

1. 画面から応答した（許可／拒否／回答）
2. ターミナルで先に応答された → 次のどれかで閉じる。
   - ツールが終わった合図（`PostToolUse`）: 同じツール（質問は `AskUserQuestion`）の応答待ちのうち、最も古い 1 件を閉じる。**届いて 2 秒以内の要求は閉じない**（実機の受け入れで分かった競合: 画面から許可した直後は、次の要求が先に届き、前のツールの `PostToolUse` が少し遅れて届く。人が新しい許可画面を読んで応答するには、2 秒より長くかかる）
   - 返答待ちに戻ったこと（ターミナルでの拒否・中断、ターンの終了。会話ログ ADR 0007、状態ファイル ADR 0009）
   - 質問は、フックの接続が切れたこと（拒否＝強制終了）でも閉じる
   作業中に戻っただけでは閉じない（前のツールの `PostToolUse` で状態が作業中になるため）
3. 質問の待ち時間切れ、またはセッションの終了

遅れて返した応答は無視されるだけなので（質問は実機で確認、ADR 0014）、「閉じた要求には応答を送らない」ことだけをルールにして、競合の細かい制御はしない。

## 実機で分かったこと（2026-10-09、`claude` 2.1.295、Windows）

| 項目 | 結果 |
|---|---|
| 許可要求の内容 | `request_id`（5 文字）、`tool_name`、`description`、`input_preview`（JSON の文字列）。`Bash` の `description` はモデルが付けた説明、`Write`・`Edit` は固定の文 |
| 許可／拒否 | `allow` で実行が進み、`deny` で実行されない。拒否はモデルに「拒否された」と伝わる |
| 要求の届き方 | 1 件ずつ順に届く。1 件目に応答すると、すぐ 2 件目が届く |
| `input_preview` の長さ | 3,268 文字までは切れない。約 12,000 文字のコマンドは、全体で約 3,600 文字に省略されて届く（先頭 約 2,000 文字＋`
⋯ N code points elided ⋯
`＋末尾 約 1,500 文字）。省略した文字数は N で分かる |
| 質問（`AskUserQuestion`） | 許可中継には流れない。`PermissionRequest` フックには `tool_input.questions`（質問文・`header`・選択肢の `label` と `description`・`multiSelect`）が入る |
| 質問への代理回答 | フックの出力 `{ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { …tool_input, answers } } } }` で通る。`answers` は「質問文 → 答えの文字列」。複数選択はカンマ区切り、自由入力は文字列そのまま。3 問まとめても通る |
| 選択肢にない答え・空の答え | 単一選択の `紫`、複数選択の `りんご,バナナ` は、そのまま通り、モデルは「Other の自由入力」として受け取る。空の答えもエラーにならないが、モデルは「回答がなかった」と受け取る |
| 複数セッションの同時質問 | フックの入力の `session_id` で区別できる。2 つのセッションの答えは、取り違えられずに別々に渡る |
| フックの待ち | 20〜26 秒待っても通る。質問画面は待っている間も出る |
| ターミナルで先に答えたとき | フックは終了せずタイムアウトまで残る。遅れて返した答えは無視される。`AskUserQuestion` の `PostToolUse` が答えの直後に発火し、`tool_response.answers` に答えが入る |
| ターミナルで拒否（Esc） | 待っているフックは、通知なしに強制終了される（接続が切れる） |
| 許可要求にターミナルで先に答えたとき | `claude` は、チャネルに「解決済み」の通知を送らない。遅れて返した `allow`／`deny` は無視される（許可のあとの `allow` は 1 回だけ実行、拒否のあとの `allow` は実行されない、許可のあとの `deny` は結果を変えない） |

## 部品と責務

| 部品 | 追加する責務 |
|---|---|
| `channel.mjs` | 操作モードで `claude/channel/permission` も宣言する。`permission_request` を受けて Hub の `POST /permission` へ転送する。`/poll` の応答の `verdicts` を、`notifications/claude/channel/permission` として送る |
| `hook/ask-hook.mjs`（新規） | `AskUserQuestion` 用の同期フック。質問を Hub の `POST /ask` へ送って待ち、答えを標準出力に書く。Hub が動いていない・操作できない・時間切れのときは、何も出力せずに終了する |
| `requests.mjs`（新規） | 要求の待ち行列（セッションごと）、状態、検証、閉じる処理、本文の破棄。HTTP・WebSocket から独立した純粋なロジック |
| `sessions.mjs` | `Session` に `requests`（開いている要求の一覧）を持たせる。状態が許可待ち・質問待ちから抜けたことを `requests.mjs` に知らせる |
| `hub.mjs` | `POST /permission`、`POST /ask`、`/poll` の応答に `verdicts`、画面用の応答 API（保護あり）、WebSocket への配信 |
| `setup/hooks-config.mjs` | 既存の非同期フックに加えて、`PermissionRequest` の `matcher: "AskUserQuestion"` に同期の `ask-hook.mjs` を足す（`timeout` 付き） |
| 画面 | 許可待ちの行に内容と「許可」「拒否」、質問待ちの行に質問と選択肢と送信、結果の表示 |

## 要求（request）

### 状態

```
open(応答待ち) ──画面から応答──► allowed / denied / answered
   ├─ 状態が許可待ち・質問待ちから抜けた ──► terminal(ターミナルで応答済み)
   ├─ 質問の待ち時間切れ ──► timeout(時間切れ)
   ├─ セッション終了 ──► failed(応答できませんでした。reason: closed)
   └─ 応答の送信に失敗 ──► failed(reason を付ける)
```

- 閉じた要求（`open` 以外）は、60 秒だけ覚えて消す。画面の再読み込みには、`open` の要求だけを返す
- 閉じた要求にも、本文（入力・質問）は残さない（NFR-009）。ID と結果だけを持つ

### 形

```
Request {
  id,            // 許可: claude の request_id / 質問: Hub が付ける ID
  kind,          // 'permission' | 'question'
  createdAt,
  // 許可
  toolName, description, inputPreview,
  // 質問
  questions: [{ question, header, options: [{ label, description }], multiSelect }]
}
```

`Session.requests` は `open` の要求の一覧（許可は 1 件ずつ届くので通常 1 件）。

## API の追加

### 内部（`:8765`）
`POST /permission`（チャネルサーバー → Hub）
- 本文: `{ session, request_id, tool_name, description, input_preview }`
- 応答: 204。セッションが操作モードでないときは 409（チャネルサーバーは無視してよい。ターミナルに任せる）

`POST /ask`（`ask-hook.mjs` → Hub）
- 本文: `{ session, questions }`
- Hub は、答えが入るか、要求が閉じるまで応答を保留する
  - 答えが入った: 200 `{ answers }`
  - 時間切れ（Hub 側の上限: 85 秒）、セッションが操作モードでない・不明: 204（フックは何も出力せず、ターミナルの質問画面に任せる）
- 応答する前に接続が切れた = フックが強制終了された（ターミナルで拒否など）。要求を `terminal` として閉じる

`POST /poll`（既存）
- 応答に `verdicts` を追加できる: `{ "instructions": [...], "verdicts": [{ "request_id", "behavior": "allow" | "deny" }] }`（どちらも省略可。1 つ以上あれば 200）
- 許可の応答ができたら、待機中の `/poll` をすぐ 200 で終わらせる

### 画面用（`:8766`、ADR 0012 の保護あり）
`POST /api/sessions/:sessionId/requests/:requestId/response`
- 許可: `{ "behavior": "allow" | "deny" }`
- 質問: `{ "answers": { "<質問文>": "<文字列>" | ["<文字列>", …] } }`。配列はカンマ区切りの 1 つの文字列にして渡す
- 応答: 204
- エラー: 400（形が不正、答えが足りない、文字列が長すぎる）、403（保護）、404（セッション・要求なし）、409（操作モードでない・すでに閉じている）
- 検証（質問）: すべての質問に答えがあること。1 つの答えは 2,000 文字まで。選択肢にない文字列も、そのまま通る（実機で確認、T0-8）ので、Hub は選択肢の外を弾かない。空の答えは「回答なし」になるので、400 にする

### WebSocket `/ws`
| `type` | 内容 |
|---|---|
| `request` | `{ sessionId, id, status, reason? }`。`status` は `open` のほか、上の閉じた状態 |

`Session` に `requests`（`open` の要求の一覧。内容つき）を加える。

## ask-hook.mjs の動き
1. 標準入力を読み、`tool_name` が `AskUserQuestion` でなければ何もしない
2. 設定から Hub を呼ぶ。Hub に届かなければ、起動を試みずにすぐ終了する（待たずにターミナルへ任せる。ADR 0014）
3. `POST /ask` を、Hub の待ち時間（設定 `CODERS_HUB_ASK_WAIT_MS`、既定 85 秒）より 5 秒長い待ち時間で呼ぶ（Hub が先に 204 を返せるように）。フックの `timeout`（設定）は、それより長い 100 秒にする
4. 200 なら、`allow` ＋ `updatedInput`（元の入力に `answers` を足したもの）を標準出力に書く。それ以外は何も出力しない
5. 何があっても終了コード 0。`claude` の動作を妨げない（`hook.mjs` と同じ方針）

## 実装上の注意
- **許可要求の検証:** `input_preview` は、画面ではテキストとして表示する（HTML として解釈しない）。長い入力の折りたたみは画面側で行う。Hub は届いた `input_preview` をそのまま持ち、省略の目印（`⋯ N code points elided ⋯`）を見つけたら、画面に「省略されています（N 文字）」と示す
- **要求の閉じ方の競合:** 許可要求の転送と、フックによる状態の変化は、順序が前後する。要求は状態とは独立に追加する。ツールの終了（`PostToolUse`）による閉じ方には 2 秒の猶予を設け（`requests.mjs` の `graceMs`）、返答待ちへの変化による閉じ方は「変化の時刻が要求の受信より後」のものだけにする
- **ADR 0004 との関係:** 質問は、フックが Hub に接続できなければ待たない。Hub を起こすのは、チャネルサーバー（既存）に任せる
- **`zod`:** `channel.mjs` で通知のスキーマに使う。MCP SDK が依存しているが、直接依存として `package.json` に足す
- **設定の配布:** `scripts/print-setup.mjs` と `docs/setup.md` に、質問用フックの設定を足す

## 検証事項（残り）

## リスク
- Channels と許可中継は research preview（ADR 0001、0002）。通知の形式は `channel.mjs` に閉じ込める
- 質問への回答は、`PermissionRequest` フックの出力（`updatedInput`）に依存する。形式が変わったら、回答が通らなくなる。そのときは `/ask` の 204 と同じ扱い（ターミナルに任せる）になるよう、失敗を黙って無視する
- 画面側の応答 API は、PC 上の操作を許可する入口になる。保護（ADR 0012）のテストを必ず書く
- 質問のフックが長く待つので、フックの `timeout` を超えると `claude` がフックを打ち切る。待ち時間とのずれに注意する

## テスト方針

| AC | 確認方法 |
|---|---|
| AC-004-1, 004-7 | 画面の部品のテスト（`web-components`）。内容の表示、折りたたみ、省略の表示 |
| AC-004-2〜004-4 | `requests`（許可／拒否の遷移、ID ごとの応答）、`hub`（API と `/poll` の `verdicts`）、`channel`（通知の送信） |
| AC-004-5 | 画面の部品と `hub`（`controllable` の有無） |
| AC-004-6 | `e2e`：応答から `/poll` の応答までの時間 |
| AC-004-8〜004-10 | `requests`（答えの検証、カンマ区切りの結合）、`ask-hook`（出力の形）、`hub`（`/ask` の保留と応答）、`web-logic` |
| AC-004-11 | `ask-hook`・`hub`：時間切れで 204、フックは何も出力しない |
| AC-004-12 | `requests`：閉じた後に本文が残らない |
| AC-004-13 | `hub`：`Host`・`Origin`・ヘッダー・`Content-Type` |
| AC-005-4〜005-8 | 実機の手順（`acceptance.md`）。閉じる処理は `requests` と `sessions` のテスト |
| 結合 | `e2e`：本物の `hook.mjs`・`ask-hook.mjs`・`channel.mjs`（`--channel`）と Hub を起動し、模擬の MCP クライアントで許可要求を送って、応答を受ける |
