# 007 配布（GitHub リリースと単一の exe）

- ステータス: Approved（2026-10-11）
- 対応要件: REQ-011
- 関連 NFR: NFR-001, NFR-005, NFR-009
- 関連 ADR: 0018（配布の方式）、0004（Hub の自動起動）、0011（操作モード）
- 手順の下書き: `../../../docs/setup.md`

## 目的
開発環境（Node.js・`npm`）のない人が、GitHub のリリースから入手した `coders-hub.exe` だけで、Coders Hub を使い始められるようにする。

この機能は、動作そのものは変えない。**入手と起動と設定の入れ方**を変える。

## 用語
`../../00-product/glossary.md` に従う。「配布物」は、リリースに添付する zip。

## 振る舞い

### 配布物
- GitHub のリリースに、`coders-hub-<バージョン>-win-x64.zip` が添付される
- zip の中身: `coders-hub.exe`、`README.txt`（日本語。使い方・設定・SmartScreen の開き方・更新・アンインストール）、`LICENSE`（MIT）、`THIRD_PARTY_NOTICES.txt`（exe に含まれる Node.js と npm パッケージのライセンス表示）、`SHA256SUMS.txt`
- リリースには、変更点（リリースノート）と、zip の SHA-256 が書かれる
- 対象は Windows x64（NFR-001）

### 使い方（利用者）
1. zip を展開し、`coders-hub.exe` を、好きな場所に置く（置き場所は、移動しない）
2. `coders-hub.exe setup` を実行すると、`claude` に入れる設定（フックと、チャネルサーバーの MCP 設定）が、この exe のパスを指す形で、表示される（操作モード用の設定も出す）
3. `claude` を起動する。最初のセッションのチャネルサーバーが、Hub を自動で起動する。手動で起動するときは、`coders-hub.exe`（または `coders-hub.exe hub`）
4. ブラウザで、画面を開く（既定の URL は、README に書く）。Chrome / Edge の「アプリとしてインストール」も使える
5. 更新は、新しいリリースの zip を展開し、exe を置き換える。設定は、同じ置き場所なら、そのまま使える

### サブコマンド
- `hub`（既定）: Hub 本体を起動する
- `hook`・`ask-hook`: フックとして、標準入力のイベントを Hub へ送る（`claude` が起動する）
- `channel [--channel]`: チャネルサーバー（MCP サーバー）として動く（`claude` が起動する）。`--channel` で操作モード（ADR 0011）
- `setup`: `claude` に入れる設定を出力する
- `version`: バージョンを表示する
- 引数なしの実行（ダブルクリックを含む）は、`hub` として動く。ウィンドウに、Hub の起動と画面の URL を表示する

### Hub の自動起動
- チャネルサーバーは、Hub が動いていなければ、**同じ exe を `hub` で起動する**（ADR 0004）。起動した Hub は、`claude` を終了しても、動き続ける

### 画面のファイル
- 画面（HTML・JS・CSS）は、exe に埋め込まれ、Hub が配信する。別のファイルを、横に置く必要はない

### ビルドとリリース（開発者）
- タグ `v<バージョン>` を push すると、GitHub Actions が、次を行う: 依存の取得、テスト、画面のビルド、exe の作成、動作確認（`version`・`hub` の起動と `/health`）、zip と SHA-256 の作成、リリースの作成と添付
- バージョンは、`package.json` の `version` と、タグが一致していること。一致しなければ、リリースを作らない
- テストが失敗したら、リリースを作らない

## 受け入れ条件

AC の番号は、要件 REQ-011 に対応する。

### 配布物
- AC-011-1: タグの push で、GitHub のリリースに、zip・SHA-256 が添付される。リリースに変更点がある
- AC-011-2: zip に、`coders-hub.exe`・`README.txt`・`LICENSE`・`THIRD_PARTY_NOTICES.txt`・`SHA256SUMS.txt` が含まれる。`THIRD_PARTY_NOTICES.txt` に、Node.js と、束ねた npm パッケージ（画面と exe の両方）のライセンス文が入る
- AC-011-3: `SHA256SUMS.txt` の値が、zip の中の exe の SHA-256 と一致する
- AC-011-4: `package.json` の `version` とタグが一致しないと、リリースが作られない。テストが失敗しても、作られない

### exe の動作
- AC-011-5: Node.js のない Windows で、`coders-hub.exe version` がバージョンを表示する
- AC-011-6: `coders-hub.exe`（引数なし・`hub`）で、Hub が起動し、`/health` が `ok` を返し、画面（`/`）が表示される。画面のファイルは、exe に埋め込まれたものが配信される
- AC-011-7: 画面の配信は、埋め込まれたファイル以外（フォルダの外）を返さない（403・404）
- AC-011-8: `coders-hub.exe setup` が、exe のパスを指すフックの設定と MCP の設定を出力する。パスの区切りは、シェルで壊れない形になる。操作モード用の設定も出る
- AC-011-9: `coders-hub.exe hook` と `ask-hook` が、`node` 版と同じ動作をする（標準入力のイベントを Hub へ送る。失敗しても `claude` を妨げない）
- AC-011-10: `coders-hub.exe channel` が、MCP サーバーとして動き、Hub に登録される。`--channel` で操作モードになる
- AC-011-11: Hub が動いていないとき、チャネルサーバーが、同じ exe で Hub を起動する。`claude` を終了しても Hub は残る
- AC-011-12: 本物の `claude` で、配布版の exe を使って、一覧・指示の送信・許可・質問への応答・会話の表示が動く（機能 001〜004、006）
- AC-011-13: 開発時（`npm start`・`node …`）の動作は、これまでと変わらない

### 文書
- AC-011-14: README に、入手・展開・設定・起動・更新・アンインストール・SmartScreen の開き方・困ったとき（ポート・古い Hub）が書かれている

## 対象外
- 署名（コード署名証明書）
- アプリ内の更新の案内・自動更新（ADR 0018）
- Windows 以外・ARM 版
- インストーラー（MSI・自動起動の登録・スタートメニューの登録）。必要になったら別の機能にする
- 外部公開・認証（REQ-006、機能 005）

## 決定済み
- ライセンスは MIT（2026-10-11）。著作権者は `takeshita-work`

## 未決事項
- 公開前の秘密情報・個人情報の確認の範囲（履歴を含む）
- 既定のポート（ポートの変更を、コードの既定にするか、環境変数にするか）
- SmartScreen・ウイルス対策ソフトの誤検知が出たときの対応方針（報告先・ハッシュの公開）
- 配布版のサポートの範囲（個別の対応は約束しない、と README に書く）
