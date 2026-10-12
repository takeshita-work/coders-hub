Coders Hub __VERSION__（Windows x64）
=====================================

複数の Claude Code のセッション（複数のアカウントを含む）を、ブラウザの 1 つの画面で見て、
指示の送信・許可と質問への応答ができるアプリです。Node.js などの開発環境は要りません。

【入れ方】
1. coders-hub.exe を、書き込めるフォルダ（Program Files 以外）に置きます（置いたあとは、移動しないでください。
   設定に、この exe のパスを書きます）。
2. Windows の SmartScreen が「PC が保護されました」と出したときは、
   「詳細情報」→「実行」を選びます（この exe は署名していません）。
   不安な場合は、SHA256SUMS.txt の値と、次のコマンドの結果を、見比べてください。
     Get-FileHash .\coders-hub.exe -Algorithm SHA256
3. 設定を用意します。coders-hub.exe をダブルクリックすると出るメニューで、1（設定を表示）または 2（設定をファイルに保存）を選びます。
   ターミナルを使う場合は、次のようにします。
     .\coders-hub.exe setup | more
   表示された内容を、claude に入れます。
   （coders-hub.exe は、ウィンドウのない形式です。表示は「coders-hub.exe setup | more」のように、パイプで受け取ります）
   - 「1. フック設定」: 使う claude の設定ファイル（settings.json。アカウントごと）に追加します。
   - 「2. 一覧だけのモード」「3. 操作モード」: JSON を、coders-hub.json などの名前で保存します。

【使い方】
1. Hub を起動します。coders-hub.exe をダブルクリックします。Hub はウィンドウなしで動き、案内のウィンドウ（画面の URL・終了の方法）が出ます。
   Enter で閉じます（閉じても Hub は動き続けます）。
   ログオン時に自動で起動したいときは、スタートアップ（shell:startup）に、「coders-hub.exe start」（案内なし）のショートカットを置きます。
2. claude を起動します（一覧だけのモード）。
     claude --mcp-config coders-hub.json
   指示の送信・許可と質問への応答もしたいときは、操作モードで起動します。
     claude --mcp-config coders-hub-control.json --dangerously-load-development-channels server:coders-hub
   claude は、Hub を起動しません。Hub が動いていなくても動き、Hub が動き始めたら一覧に出ます。
3. ブラウザで http://127.0.0.1:47766/ を開きます。
   Edge / Chrome の「アプリとしてインストール」で、専用のウィンドウにもできます。

【ポート】
- 内部 47765、画面 47766 です。変えるときは、coders-hub.exe と同じフォルダに、次のファイル（config.json）を作ります（Hub・フック・チャネルサーバーのすべてが、同じファイルを読みます）。
  exe は、書き込めるフォルダに置いてください。
  { "internalPort": 47765, "uiPort": 47766 }
  片方だけでも書けます。環境変数 CODERS_HUB_INTERNAL_PORT・CODERS_HUB_UI_PORT があれば、そちらが優先です。
  変えたあとは、動いている Hub を止めて、claude を起動し直します。

【Hub の終了・更新】
- 終了: 画面の「フィルター・ソート」のパネルの最下段にある「Hub を終了」を押します（確認が出ます）。
  ほかに、タスク マネージャーで coders-hub.exe を終了できます。終了しても、claude は Hub を起動し直しません。
- 更新: Hub を終了してから、新しいリリースの coders-hub.exe をダウンロードして、置き換えます。config.json は触りません（設定は、そのまま使えます）。
  もう一度、ダブルクリックで起動します。

【アンインストール】
- Hub を終了し、claude の設定から、追加したフック設定と MCP の設定を消し、coders-hub.exe を削除します。
  必要なら、config.json（exe と同じフォルダ）と、%LOCALAPPDATA%\coders-hub\（ログ）も削除します。

【困ったとき】
- 一覧に出ない: http://127.0.0.1:47765/health が ok を返すか確認します。claude で /mcp を開き、
  coders-hub が connected か確認します。
- 画面が開かない（接続できない）: Hub が動いていません。coders-hub.exe をダブルクリックしてください。
  起動しないときは、%LOCALAPPDATA%\coders-hub\hub.log に理由が出ます。
- 「すでに使われています」: 別のアプリがポートを使っています。設定ファイルでポートを変えてください。
- 通信は、このパソコンの中だけ（127.0.0.1）です。外部には送りません。

【ライセンス】
- Coders Hub は MIT ライセンスです（LICENSE）。exe に含まれる Node.js と npm パッケージのライセンス表示は、
  THIRD_PARTY_NOTICES.txt にあります。

【注意】
- 個別のサポートは、お約束できません（ベストエフォートです）。
- 不具合は、GitHub の Issues で報告してください。
