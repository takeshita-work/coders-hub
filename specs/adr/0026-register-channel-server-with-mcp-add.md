# 0026: チャネルサーバーは `claude mcp add` で、`--channel` つきで登録する

- ステータス: Accepted
- 日付: 2026-10-12

## 背景
今は、チャネルサーバーを `--mcp-config` に渡す JSON（`coders-hub.json`・`coders-hub-control.json`）で、起動のたびに指定している（ADR 0004・0011・0020・0025）。
このため、利用者は設定ファイルを保存し、起動のたびに `--mcp-config` を付けなければならない。セットアップの手順が長い。

ユーザーの要望（2026-10-12）: `claude mcp add` でセットアップしたい。

## 選択肢
1. `--channel` なしで登録する（一覧だけのモード。操作モードは `--mcp-config` を残す）
2. `--channel` つきで登録する（操作モードの有効化は、開発用フラグだけにする）
3. 2 つの名前で登録する（一覧用と操作用）

## 決定
2 を採用する。ユーザーの選択（2026-10-12）。

- 登録: `claude mcp add --scope user coders-hub -- <サーバー> --channel`（アカウントごとに 1 回）
  - 配布版: `"<exe のパス>" channel --channel`
  - 開発時: `node "<channel.mjs のパス>" --channel`
- 解除: `claude mcp remove --scope user coders-hub`
- サーバーの名前は `coders-hub` 固定（開発用フラグの `server:coders-hub` と一致させる）
- 操作モードの起動: `claude --dangerously-load-development-channels server:coders-hub`。`--mcp-config` は要らない
- 開発用フラグなしの `claude`: サーバーは動き、一覧と生存確認は働く。通知は黙って捨てられる
- `setup` の出力と `setup --write` から、`coders-hub.json`・`coders-hub-control.json` をなくす。代わりに、登録のコマンドを出す（フックの設定は、今までどおり）

ADR 0004 の「MCP はユーザースコープに登録せず `--mcp-config` で指定する」と、ADR 0011 の「起動用スクリプトが、操作モードのときだけ `--channel` 入りの設定を渡す」を、この ADR で置き換える（サーバーの実装が 1 つで、`--channel` で宣言を切り替える点は維持）。

## 理由
- 手順が、「登録を 1 回」と「操作したいときはフラグを付ける」の 2 つだけになる
- 設定ファイルの保存・管理・パスの更新が要らなくなる

## 影響・トレードオフ
- **開発用フラグなしで起動した `claude` も、Hub には「操作モード」と伝わる**（`/poll` の `channel: true`）。画面は「操作できる」と表示するが、指示は届かない。ADR 0011 が避けた状態に戻る。検知は、指示の受信確認（機能 002。「届いたか確認できません」の表示）に頼る
- 全セッションにチャネルサーバーが付く。一覧に出したくないセッションでも付く（解除は `claude mcp remove`）
- exe を移動・更新したら、登録のやり直しが要る（パスを含むため）
- 要検証: ユーザースコープに登録した、チャネル機能を宣言するサーバーを、開発用フラグなしで起動したときの挙動（警告・エラーが出ないか）。ADR 0011 の「要検証」と同じ点で、実機で確認する
- 影響する文書: README・`docs/setup.md`・`docs/release-readme.txt`・`architecture.md`・機能 002 / 007 の spec と受け入れ条件・案内のメニュー（ADR 0025 の「2」）
