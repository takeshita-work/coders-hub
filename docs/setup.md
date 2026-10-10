# セットアップ手順

- 対象: セッション一覧（`specs/30-features/001-session-list`）、指示の送信（`specs/30-features/002-send-instruction`。「8. 操作モード」）
- 仕様との差分: `wait.mjs`（asyncRewake 方式）は「次」の段階。引数なしのチャネルサーバーは登録と生存確認だけ（ADR 0006）で、チャネル機能を宣言しないので、開発用フラグ（`--dangerously-load-development-channels`）は不要（T0-5 で確認）
- 実機での通し確認は、一覧が 001 の `acceptance.md`、指示の送信が 002 の `acceptance.md`。未確認の手順には「未確認」と書く

## 1. 準備（初回のみ）

```powershell
cd "D:\organization\works\#tools\#web-app\coders-hub"
npm install
npm run build     # 画面をビルドする（dist/web/）。画面を変えたら再実行する
npm test          # 任意。全件が通ること
```

Node.js 22 以上が必要。

## 2. 設定を表示する

```powershell
node scripts/print-setup.mjs
```

このリポジトリの場所に合わせた、次の 2 つが表示される。

1. `settings.json` に追加するフック設定
2. チャネルサーバーの登録コマンド

## 3. アカウントごとの設定（アカウントごとに初回のみ）

`CLAUDE_CONFIG_DIR` を切り替えて、アカウントごとに行う。

### 3-1. フック
表示された `hooks` を、そのアカウントの `settings.json`（`$env:CLAUDE_CONFIG_DIR\settings.json`）に追加する。すでに `hooks` がある場合は、イベントごとの配列に項目を足す。

使うフックは `SessionStart`、`UserPromptSubmit`、`PermissionRequest`、`PostToolUse`、`Stop`、`SessionEnd`。すべて `async: true` で、`claude` の動作を妨げない。


### 3-2. チャネルサーバー
```powershell
$env:CLAUDE_CONFIG_DIR = "C:\Users\you\.claude-work"
claude mcp add --scope user coders-hub -- node "D:/organization/works/#tools/#web-app/coders-hub/src/channel/channel.mjs"
```
（実際のコマンドは手順 2 の表示をそのまま使う。未確認: `--scope user` がアカウントごとの設定に保存されること）

プロジェクト単位で試すだけなら、プロジェクト直下の `.mcp.json` に書いて、`settings.local.json` の `enabledMcpjsonServers` で有効化してもよい（T0-5 の実験で確認した方法）。

## 4. 使い方

1. `claude` を普通に起動する（開発用フラグも承認画面も要らない）。
2. 最初のセッションの起動時に、チャネルサーバーが Hub 本体を自動で起動する（ADR 0004）。手動で起動する場合は `npm start`。
3. ブラウザで `http://127.0.0.1:8766/` を開く。
   - ビルドしていない場合は、受け取った一覧を JSON で表示する簡易ページが出る。

Hub のポートは `127.0.0.1` の 8765（内部）と 8766（画面）。環境変数 `CODERS_HUB_INTERNAL_PORT`、`CODERS_HUB_UI_PORT` で変更できる。すべての `claude`、`hook.mjs`、`channel.mjs` で同じ値にそろえること。

## 5. 動作確認の方法（Hub 単体）

`claude` を使わずに、疑似フックを送って画面を確認できる。

```powershell
npm start
curl.exe -X POST http://127.0.0.1:8765/event -H "Content-Type: application/json" -d '{\"event\":\"UserPromptSubmit\",\"account\":\"acc\",\"input\":{\"session_id\":\"demo\",\"cwd\":\"D:/x\",\"prompt\":\"hi\"}}'
```

`event` を `PermissionRequest`、`Stop`、`SessionEnd` に変えると、表示が切り替わる。

## 6. 作業のまとめ

| タイミング | 作業 | 手動／自動 |
|---|---|---|
| 初回のみ | `npm install` | 手動 |
| アカウントごとに初回のみ | `settings.json` へのフック追加、`claude mcp add` | 手動 |
| 毎回 | Hub の起動 | 自動（最初のセッションが起動） |
| 毎回 | セッションの登録・状態の通知・終了検知 | 自動 |

## 7. うまくいかないとき

- 一覧に出ない: `http://127.0.0.1:8765/health` が `ok` を返すか確認する。`claude` で `/mcp` を開き、`coders-hub` が connected か確認する
- ポートがすでに使われている: 別のプロセス（前の実験の仮 Hub など）が使っている。止めるか、ポートを変える
- 状態が更新されない: 手順 3-1 のフックが、そのアカウントの `settings.json` に入っているか確認する
- 指示が「届いたか確認できません」になる: 開発用フラグ（`--dangerously-load-development-channels server:coders-hub`）を付けずに起動した可能性が高い。フラグがないと、サーバーは動くが、通知は黙って捨てられる（手順 8）

## 8. 操作モード（指示を送る）

ダッシュボードから、セッションへ指示を送れるようにする起動方法。一覧だけなら、手順 4 のままでよい。

### 8-1. 設定ファイルを作る
`node scripts/print-setup.mjs` の「3. 操作モード」に表示される JSON を、`coders-hub-control.json` などの名前で保存する。一覧だけのモードとの違いは、引数 `--channel` だけ。サーバーの名前はどちらも `coders-hub`。

### 8-2. 起動する
```powershell
claude --mcp-config coders-hub-control.json --dangerously-load-development-channels server:coders-hub
```

- 起動のたびに、開発用チャネルの警告画面が出る。内容を確認して承認する
- フラグを付けずに起動すると、サーバーは動くが、通知は黙って捨てられる（エラーも警告も出ない。実機で確認済み）
- 起動用のスクリプトがあれば、既定のオプションに入れておくとよい。使わないセッションは、オプションなしで起動する

### 8-3. 使い方
- 一覧の行の「指示を送る」から入力して送る（Ctrl+Enter でも送れる）
- 返答待ちのセッションには、すぐ渡される
- 作業中・許可待ち・質問待ちのセッションへの指示は、保留される。返答待ちになったときに、1 件ずつ渡される。保留中は行に表示され、取り消せる
- 結果は、行に「届きました」などと表示される。画面を再読み込みすると消える
- 「指示として扱われませんでした」: 渡したタイミングが、ターミナルでの入力や作業と重なった。必要なら送り直す
- 本文の中の `</channel>` だけは、`<\/channel>` に置き換わって届く（`claude` の仕様）

### 8-4. 注意
- 操作できるのは、同じ PC の `127.0.0.1` からだけ。外部公開は別の機能（REQ-006）
- 画面からの書き込みは、他のサイトのページからは受け付けない（ADR 0012）
