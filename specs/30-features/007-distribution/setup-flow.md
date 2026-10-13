# セットアップの流れと文面

- ステータス: Draft（文面は、実機で試しながら詰める）
- 関連: ADR 0026（`claude mcp add` で登録）、ADR 0027（手順を 1 つずつ表示）、AC-011-8・29・31
- **このファイルが、セットアップの文面の正**。「手順」の節に、利用者に表示される文面を、具体的な値のまま書く。文面を直すときは、先にここを直し、`src/setup/steps.mjs` を合わせる。`tests/setup-flow.test.mjs` が、両者の一致を確かめる（食い違うと落ちる）

## 全体の流れ
利用者は、案内のメニューの `1`（セットアップを進める）で、次の 3 つを順に読んで進める。

| # | id | 内容 | 回数 | 利用者がすること |
|---|---|---|---|---|
| 1 | register | チャネルサーバーを登録する（アカウントの指定を含む） | アカウントごとに 1 回 | 別のアカウントのときだけ `CLAUDE_CONFIG_DIR` を指定し、`claude mcp add` を実行して、`claude mcp list` で確認する |
| 2 | hooks | フックを追加する | アカウントごとに 1 回 | 枠（`{ "hooks": { 6 行 } }`）をコピーして貼る。`"hooks"` がなければ枠ごと、あれば 1 行ずつ（すでにあるイベントは、`[ ]` の中身だけ）貼る |
| 3 | use | 起動して確認する | 使うたび | Hub を起動し、claude を（操作モードなら開発用フラグつきで）起動し、画面で確認する |

- 1〜2 は、**そのアカウントで 1 回だけ**行う。設定は、アカウントの設定フォルダの中に保存される
- 1 と 2 は、どちらを先にしてもよい。どちらも終わってから、claude を起動し直す
- Hub を起動するのは、利用者（ADR 0020）。登録しただけでは、Hub は起動しない

## 書き方のきまり（テストが読む）
- 手順は、`### 番号. id: 見出し` で始める。順番がそのまま、表示の順番になる
- 手順の直後の **1 つ目のコードブロック**（` ```text `）が本文。行ごとに表示する。空行も、そのまま空行として表示する
- **2 つ目のコードブロック**（` ```powershell `・` ```json `）が、コピーできる内容。なければ、コピーなし（メニューに `c` を出さない）
- 本文の行頭の `[配布版のみ] ` は、配布版（exe）のときだけ出す行（印は、表示しない）
- 文面は、次の「例の前提」の値で、具体的に書く。`steps.mjs` にこの値を渡して作った出力が、手順の節と一致する

## 例の前提
次の値は、例です。実際の表示では、利用者の値に置き換わります（登録のコマンドとフックの JSON は exe のパス、画面の URL はポート）。

- exe のパス: `C:\Tools\coders-hub\coders-hub.exe`
- 内部 API のポート: `47765`（既定）
- 画面のポート: `47766`（既定）

## メニューの操作
案内のウィンドウのメニューは、`1` セットアップを進める、`2` ログを開く（ADR 0028 の予定。設定のファイル保存は、なくす）。`1` で、手順を 1 つずつ表示する。
- `Enter`: 次へ（最後の手順のあとは、メニューへ戻る）
- `b`: 前へ（最初の手順では出さない）
- `c`: コピーできる内容を、クリップボードへ（コピーできる内容がある手順だけ出す）
- `q`: メニューへ戻る
- 手順を読み込めなかったときは、「手順を読み込めませんでした。」と出して、メニューへ戻る

## 未確認の点（実機で確かめて、確かめたら、ここから消す）
- 開発用フラグなしの `claude` で、警告やエラーが出ないか（ADR 0026）
- 起動済みの claude に、登録・フックが反映されないか（手順 2 の「起動し直します」の根拠）
- settings.json の hooks の構造（イベント名 → 配列 → `{ "hooks": [...] }`）が、今の claude の仕様のままか。イベントごとの 1 行を、そのまま貼れるか

## 確認済みの点（2026-10-12。Windows PowerShell 5.1、使い捨ての `CLAUDE_CONFIG_DIR` で実機確認）
- `claude mcp add --scope user coders-hub -- "<exe>" channel --channel` を、直接実行すると、`--` も引用符つきの exe のパスも、そのまま渡る。保存された定義は、`command` = exe、`args` = `["channel", "--channel"]`（手順 1 のコマンド）
- `.ps1` のラッパー（`@args` で転送するもの）経由では、素の `--` が消えて、`unknown option '--channel'` になる。`'--'` と引用符で囲めば、渡る。手順の文面には、書いていない（直接実行が前提）
- `--scope user` の登録は、`<CLAUDE_CONFIG_DIR>\.claude.json` に保存される。設定フォルダごとに分かれる（手順 1 の「アカウントの指定」）
- 登録済みのときに、もう一度 `claude mcp add` を実行すると、`MCP server coders-hub already exists in user config` のエラーになる（手順 1 の「先に、解除してから、登録します」）
- `claude mcp list` は、`coders-hub: <exe> channel --channel - ✔ Connected` と表示する。Hub が止まっていても、Connected になる（手順 1 の「一覧に coders-hub が出れば」）

## 確認済みの点（2026-10-13。実際の Hub と、`claude mcp add` で登録した `claude` で確認）
- `claude mcp add --scope user` の登録で、`claude --dangerously-load-development-channels server:coders-hub` を起動すると、Hub に「操作できる」セッションとして出る（チャネルサーバーは `coders-hub.exe channel --channel`）
- **プロジェクトの `.mcp.json` に同じ名前（`coders-hub`）があると、ユーザー設定の登録より優先される。** `--channel` のない定義なら、開発用フラグがあっても「閲覧のみ」になる。`claude mcp list` に「Conflicting scopes」の警告が出る。手順 1 の前に、そのフォルダの `.mcp.json` に `coders-hub` がないか確認する（あれば消すか、同じ名前を使わない）
- さらに、`.claude/settings.local.json` の `enabledMcpjsonServers` に `coders-hub` が入ると（プロジェクトの MCP サーバーを許可すると、`claude` が自分で書き込む）、**2 つのチャネルサーバーが同時に動く**。同じセッションに、操作できる登録と閲覧のみの登録が交互に届き、画面の「閲覧のみ」が点滅する
- `claude --resume` では、チャネルサーバーの `CLAUDE_CODE_SESSION_ID` だけが新しい ID になり、Hub で 2 行に分かれる（元の行は閲覧のみ）。機能 001 の tasks.md フェーズ R で扱う

## 手順

### 1. register: チャネルサーバーを登録する

```text
アカウント（claude の設定フォルダ）ごとに、手順 1〜2 を行います。
次のコマンドを、順に PowerShell で実行します。

1. アカウントの指定: 既定のアカウントを使うときは、この手順をスキップします。別のアカウントを使うときは、そのアカウントでログインした設定フォルダを指定します（未ログインなら、指定後に claude を起動してログインします）。以降の手順も、同じ PowerShell で行います。

   $env:CLAUDE_CONFIG_DIR = "$HOME\.claude-account"

2. 登録: claude に coders-hub を登録します。

   claude mcp add --scope user coders-hub -- "C:\Tools\coders-hub\coders-hub.exe" channel --channel

3. 確認: 一覧に coders-hub が出れば、登録できています。

   claude mcp list

やり直すとき: 先に、次のコマンドで解除してから、登録します。

   claude mcp remove --scope user coders-hub

[配布版のみ] exe を移動・更新したら、登録し直します。
```

### 2. hooks: フックを追加する

```text
フックは、claude の状態を Hub に知らせます。settings.json に追加します。
次の枠は、c でコピーできます。自動では書き換わらないので、貼る前に、settings.json のバックアップを取ります。

【settings.json の場所】
  ・既定のアカウント: $HOME\.claude\settings.json
  ・別のアカウント（手順 1 で指定した場合）: $env:CLAUDE_CONFIG_DIR\settings.json
  ・1 つのプロジェクトだけで試す: そのプロジェクトの .claude\settings.local.json

【ファイルがない】
  ・次の枠を、そのまま settings.json として、新しく作ります（上の場所に保存）。

【ファイルはあるが、"hooks" がない】
  ・最上位の { } の中に、枠の "hooks": { ... } の部分（2 行目から、最後から 2 行目まで）を足します。前の項目の後ろに、カンマ（,）を付けます。

【すでに "hooks" がある】
  ・枠の中の、イベントごとの行を足します。
    - そのイベントがまだない: 行ごと、"hooks" の { } の中に貼ります。
    - すでにある: [ ] の中身（{ から } まで）だけを、既存の最後の項目の後ろに、カンマ付きで足します（行ごと貼ると、同じ名前が 2 つになります）。

【貼ったあと】
  ・JSON として正しいか（カンマ・括弧）を確かめます。
  ・動いている claude は、起動し直します。
```

```json
{
  "hooks": {
    "SessionStart": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]}],
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]}],
    "PermissionRequest": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]},{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" ask-hook","timeout":100}]}],
    "PostToolUse": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]}],
    "Stop": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]}],
    "SessionEnd": [{"hooks":[{"type":"command","command":"\"C:/Tools/coders-hub/coders-hub.exe\" hook","async":true}]}]
  }
}
```

### 3. use: 起動して確認する

```text
1. Hub を起動します（exe をダブルクリック。起動済みなら不要）。
2. claude を起動します。指示の送信などの操作もするときは、次のコマンドで起動します（コマンドなしの起動は、一覧と状態の表示だけです）。
3. http://127.0.0.1:47766/ を開き、セッションが一覧に出ることを確認します。
```

```powershell
claude --dangerously-load-development-channels server:coders-hub
```
