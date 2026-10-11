# 0018: 配布は、単一の exe（Node の Single Executable Applications）を、GitHub のリリースで行う

- ステータス: Accepted
- 日付: 2026-10-11

## 背景
いままでは、開発環境（Node.js と `npm`）がある自分だけが使う前提だった（`vision.md`）。開発環境のない同僚・家族にも渡したい、という要望が出た（2026-10-11）。

配布には、次の制約がある。

- `claude` は、フック（`hook.mjs`・`ask-hook.mjs`）とチャネルサーバー（`channel.mjs`）を、`node …` で起動する。Hub 本体だけを exe にしても、Node.js のない PC では動かない
- チャネルサーバーは、Hub が動いていなければ、Hub を自動で起動する（ADR 0004）。その起動も、`node` を呼んでいる
- 画面（`dist/web/`）は、Hub が配信するファイル。exe と一緒に運ぶ方法が要る
- 配布を受ける人は、開発者ではない。ダウンロードして展開し、設定を `claude` に入れるまでを、短い手順にしたい

実機で、次を確認した（2026-10-11、Node 22.23.1、Windows）。

- Node の Single Executable Applications（SEA）で、`ws`・`@modelcontextprotocol/sdk` を含むコードを、1 本の exe（約 88 MB）にして、動かせた
- SEA のメインは、CommonJS のスクリプトにする必要がある（`mainFormat: "module"` は、Node 22 では効かず、ESM として読めない）。ES モジュールの最上位の `await` は、CommonJS に変換できないので、4 つの入口（`hub/main.mjs`・`channel/channel.mjs`・`hook/hook.mjs`・`hook/ask-hook.mjs`）を、`async` 関数に包む必要がある

## 選択肢
1. zip に `node.exe` とコードを同梱する（展開して使う）
2. 単一の exe（SEA）。引数で、Hub・フック・チャネルサーバー・設定の出力を切り替える
3. Electron のインストーラー

## 決定
2 を採用する。ユーザーの選択（2026-10-11）。

- **形**: `coders-hub.exe` 1 本。サブコマンド: `hub`（既定。Hub 本体）、`hook`、`ask-hook`、`channel [--channel]`、`setup`（`claude` に入れる設定の出力）、`version`
- **配布**: GitHub のリリース。タグ（`v<バージョン>`）の push で、GitHub Actions が、テスト・ビルド・exe の作成・zip 化を行い、リリースに添付する（zip は、exe・日本語の README・LICENSE・SHA-256 の一覧）。ビルドは Windows のランナーで、Node 22 を固定して行う
- **署名**: しない。Windows の SmartScreen の警告が出る場合の開き方を、README に書く
- **公開範囲**: リポジトリを公開する。公開前に、秘密情報の混入の確認と、ライセンスの決定を行う
- **更新**: 新しいリリースを、手動でダウンロードして置き換える。アプリ内の更新の案内はしない（外部への通信を増やさない）
- **画面のファイル**: SEA のアセットとして、exe に埋め込む。開発時は、これまでどおり `dist/web/` を読む
- **Hub の自動起動**: チャネルサーバーは、自分と同じ exe（`process.execPath`）を `hub` で起動する
- **設定の出力**: `coders-hub.exe setup` が、exe の絶対パスを指す設定（フック・MCP）を出力する。開発時の `print-setup.mjs` は、同じ生成部品を使う
- **対象**: Windows x64 のみ（NFR-001）

## 理由
- 配布を受ける人が、Node.js を入れなくてよく、フォルダを 1 つ置くだけで、フック・チャネルサーバー・Hub がそろう
- フック・チャネルサーバー・Hub が、同じ exe の同じバージョンになる（バージョンのずれが起きない）
- GitHub のリリースで、版の管理・ダウンロード・変更履歴を、1 か所にまとめられる

## 影響・トレードオフ
- **サイズ**: 約 88 MB（Node を同梱）。zip で、約 35 MB 前後の見込み
- **署名なし**: SmartScreen やウイルス対策ソフトが、警告や誤検知を出す可能性がある。README に開き方を書き、SHA-256 の一覧で、整合を確認できるようにする
- **Node のバージョン固定**: SEA は、ビルドに使う Node のバイナリに、コードを埋め込む。Node の更新に追従するには、ビルドを作り直す
- **変更が要る箇所**: 入口の `async` 化、画面の配信をアセットから行う、Hub の自動起動を exe から行う、設定の生成を共通化する、ビルドスクリプトと Actions
- **仕様の前提の変更**: `vision.md` の「自分専用」を改める。サポートは、ベストエフォート（個別の対応の約束はしない）
- 公開リポジトリには、これまでのコミット履歴がすべて含まれる。公開前に、履歴の確認が要る（個人のパス・アカウント名・ID など）
