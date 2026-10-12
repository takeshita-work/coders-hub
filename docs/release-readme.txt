Coders Hub __VERSION__（Windows x64）
=====================================

複数の Claude Code のセッション（複数のアカウントを含む）を、ブラウザの 1 つの画面で見て、
指示の送信・許可と質問への応答ができるアプリです。Node.js などの開発環境は要りません。

【入れ方】
1. この zip を展開し、coders-hub.exe を、好きな場所に置きます（置いたあとは、移動しないでください。
   設定に、この exe のパスを書きます）。
2. Windows の SmartScreen が「PC が保護されました」と出したときは、
   「詳細情報」→「実行」を選びます（この exe は署名していません）。
   不安な場合は、SHA256SUMS.txt の値と、次のコマンドの結果を、見比べてください。
     Get-FileHash .\coders-hub.exe -Algorithm SHA256
3. 設定を表示します。
     .\coders-hub.exe setup
   表示された内容を、claude に入れます。
   - 「1. フック設定」: 使う claude の設定ファイル（settings.json。アカウントごと）に追加します。
   - 「2. 一覧だけのモード」「3. 操作モード」: JSON を、coders-hub.json などの名前で保存します。

【使い方】
1. claude を起動します（一覧だけのモード）。
     claude --mcp-config coders-hub.json
   指示の送信・許可と質問への応答もしたいときは、操作モードで起動します。
     claude --mcp-config coders-hub-control.json --dangerously-load-development-channels server:coders-hub
2. 最初の claude のセッションが、Hub（画面を配信する部分）を自動で起動します。
   手動で起動するときは、coders-hub.exe を実行します（ウィンドウを閉じると止まります）。
3. ブラウザで http://127.0.0.1:47766/ を開きます。
   Edge / Chrome の「アプリとしてインストール」で、専用のウィンドウにもできます。

【ポート】
- 内部 47765、画面 47766 です。変えるときは、次のファイルを作ります（Hub・フック・チャネルサーバーのすべてが、同じファイルを読みます）。
  %APPDATA%\coders-hub\config.json
  { "internalPort": 47765, "uiPort": 47766 }
  片方だけでも書けます。環境変数 CODERS_HUB_INTERNAL_PORT・CODERS_HUB_UI_PORT があれば、そちらが優先です。
  変えたあとは、動いている Hub を止めて、claude を起動し直します。

【更新】
- 新しいリリースの zip を展開し、coders-hub.exe を置き換えます。設定は、同じ場所なら、そのまま使えます。
- 動いている Hub は、先に止めます（タスク マネージャーで coders-hub.exe を終了）。

【アンインストール】
- claude の設定から、追加したフック設定と MCP の設定を消し、coders-hub.exe を削除します。

【困ったとき】
- 一覧に出ない: http://127.0.0.1:47765/health が ok を返すか確認します。claude で /mcp を開き、
  coders-hub が connected か確認します。
- 画面が開かない: Hub が動いていません。claude を起動するか、coders-hub.exe を実行してください。
- 「すでに使われています」: 別のアプリがポートを使っています。設定ファイルでポートを変えてください。
- 通信は、このパソコンの中だけ（127.0.0.1）です。外部には送りません。

【ライセンス】
- Coders Hub は MIT ライセンスです（LICENSE）。exe に含まれる Node.js と npm パッケージのライセンス表示は、
  THIRD_PARTY_NOTICES.txt にあります。

【注意】
- 個別のサポートは、お約束できません（ベストエフォートです）。
- 不具合は、GitHub の Issues で報告してください。
