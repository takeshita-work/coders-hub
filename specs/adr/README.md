# ADR（設計判断の記録）

1 判断 = 1 ファイル。`連番-決定内容.md`。`0000-template.md` をコピーして書く。

## ルール
- 一度書いた ADR は書き換えない。方針が変わったら新しい ADR を追加し、古い方を `Superseded by NNNN` にする
- 1 つの ADR には 1 つの判断だけを書く
- 「あとで、なぜこうなっている？と聞かれそうな判断」だけを残す

## ステータス
Proposed / Accepted / Superseded by NNNN / Deprecated

## 一覧

| # | タイトル | ステータス |
|---|---|---|
| 0001 | 指示の送信に Channels を使う | Accepted |
| 0002 | 許可応答に Channels の許可中継を使う | Accepted |
| 0003 | 状態取得にフックを使う | Accepted |
| 0004 | Hub 本体は単一プロセスとし、チャネルサーバーが接続しに行く | Accepted |
| 0005 | 外部公開の方式（Cloudflare Tunnel / Tailscale） | Proposed |
| 0006 | MVP の生存確認にチャネルサーバーを使う | Accepted |
| 0007 | 拒否・中断の検知に会話ログ（JSONL）の定期確認を使う | Accepted |
| 0008 | 画面のビルドに esbuild を使い、テストは node:test にする | Accepted |
| 0009 | 状態のずれの補正に、claude 自身の状態ファイル（sessions/<pid>.json）の status を使う | Accepted（`waiting` の扱いは 0010 で変更） |
| 0010 | モデルからの質問で待つ状態を「質問待ち」として、4 つ目の状態にする | Accepted |
| 0011 | チャネルサーバーは 1 つの実装で、起動引数により操作モードを切り替える | Accepted |
| 0012 | 画面用の書き込み API を、他サイトのページから叩けないように守る | Accepted |
| 0013 | 指示は Hub 本体で保留し、返答待ちになったときに 1 件ずつ渡す | Accepted |
| 0014 | モデルからの質問（AskUserQuestion）への回答は、PermissionRequest フックで返す | Accepted |
| 0015 | 画面を「サイドバー（ツリー）＋詳細」にし、許可・質問は会話の中で応答する | Accepted |
| 0016 | 会話は、画面から要求されたときに会話ログから読み、Hub は保持しない | Accepted |
| 0017 | 応答の Markdown は、marked で字句解析し、React の要素に組み立てて整形する | Accepted |
| 0018 | 配布は、単一の exe（Node の Single Executable Applications）を、GitHub のリリースで行う | Accepted |
| 0019 | ポートは設定ファイル（config.json）でも変えられるようにし、既定を 47765 / 47766 にする | Accepted |
| 0020 | Hub の起動をチャネルサーバーから切り離し、exe のダブルクリックでウィンドウなしに起動する | Accepted |
| 0021 | 設定ファイル（config.json）は、coders-hub.exe と同じフォルダに置く | Accepted |
| 0022 | 配布物は、zip にせず、exe などを個別の資産としてリリースに添付する | Accepted |
| 0023 | 設定ファイル（config.json）には、JSONC のコメントを書けるようにする | Accepted |
| 0024 | exe のダブルクリックでは、案内のウィンドウ（URL・終了の方法）を出し、Enter で閉じる | Accepted |
| 0025 | 案内のウィンドウに、設定の表示・保存とログを開くメニューを付ける | Accepted |
