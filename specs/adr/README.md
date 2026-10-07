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
| 0001 | 指示の送信に Channels を使う | Proposed |
| 0002 | 許可応答に Channels の許可中継を使う | Proposed |
| 0003 | 状態取得にフックを使う | Accepted |
| 0004 | Hub 本体は単一プロセスとし、チャネルサーバーが接続しに行く | Accepted |
| 0005 | 外部公開の方式（Cloudflare Tunnel / Tailscale） | Proposed |
| 0006 | MVP の生存確認にチャネルサーバーを使う | Accepted |
