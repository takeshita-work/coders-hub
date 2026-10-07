# Claude Code の仕組みの調査メモ

- 調査時点の情報。Claude Code のバージョンアップで変わる可能性がある（Channels は research preview）
- この文書は仕様ではない。採用した判断は `specs/adr/` を参照

## 1. 会話ログ（JSONL）
- 場所: `<CLAUDE_CONFIG_DIR>\projects\<エンコードされたプロジェクトパス>\<session-id>.jsonl`
- ファイル監視で全アカウントのやり取りを集約できる
- 内部フォーマットのため、バージョンアップで変わる可能性がある
- 用途: 会話内容の表示（補助的）

## 2. フック
各 `CLAUDE_CONFIG_DIR` の `settings.json` に設定する。stdin に `session_id`、`transcript_path`、`cwd` などを含む JSON が渡される。フックのプロセスは `CLAUDE_CONFIG_DIR` を引き継ぐので、アカウントを判別できる。

| イベント | 用途 |
|---|---|
| `UserPromptSubmit` | 作業開始（作業中にする） |
| `Stop` | 応答完了（返答待ちにする） |
| `Notification` | 許可待ち・アイドル状態の通知 |
| `PermissionRequest` | 許可ダイアログの直前に発火。外部で許可／拒否を判断できる |
| `PreToolUse` | ツール実行前の判断 |

### 同期フック（通常）
- Stop フックで `{"decision":"block","reason":"..."}` を返すと、その指示で作業を続けさせられる
- 待っている間はセッションがふさがる
- タイムアウトは既定 600 秒。途中で延長する仕組み（ハートビート）はない

### asyncRewake フック
- `"asyncRewake": true` を付けるとバックグラウンドで実行され、終了コード 2 で Claude を起こす
- セッションがアイドルでもすぐに起こせる。stderr の内容が Claude に渡る
- 待機中もターミナルはふさがらない
- タイムアウトはかかる（通常の async フックと異なる）。大きな値を設定する（上限値は要検証）
- 既知の不具合: 2.1.246 で SessionStart に付けると起動をふさぐという報告あり

## 3. Channels（research preview）
- 実行中のセッションへ外部からメッセージを送り込むための公式の仕組み
- 実体はローカルの MCP サーバー。Claude Code が子プロセスとして起動し、stdio で通信する
- `claude/channel` 機能を宣言し、`notifications/claude/channel` 通知でイベントを送る
- **待機時間の上限がない**。アイドル中でも送れる
- 作業中に届いたメッセージはキューに入り、次のターンでまとめて処理される
- **許可プロンプトの中継**ができる（`claude/channel/permission`）。ターミナルとアプリの両方に同時に出て、先に返った回答が使われる
- 通知に対する受信確認はない。チャネルが有効でない場合はエラーなしで捨てられる
- 制約
  - 自作チャネルは起動時に `--dangerously-load-development-channels` が必要
  - 起動のたびに警告画面が出る（Enter で承認）
  - Team / Enterprise プランは管理者による有効化が必要
  - 対話的な TTY が必要（`claude -p` や VS Code 拡張では動かない可能性あり）

## 4. その他
- **Remote Control**: VS Code 拡張でも `/remote-control` で使えるが、接続先は claude.ai/code とモバイルアプリのみ。自作アプリから使える公開 API はない
- **Agent View**（`claude agents`）: 公式のセッション一覧 TUI。主に `claude --bg` のバックグラウンドセッションが対象
- **Agent SDK / `claude -p --resume`**: 別プロセスになるため、実行中のセッションへの介入には向かない

## 5. 指示送信方式の比較

| 項目 | asyncRewake の Stop フック | Channels |
|---|---|---|
| 開発用フラグ・警告画面 | 不要 | 必要 |
| 待機時間の上限 | あり（timeout の値） | なし |
| 許可プロンプトへの応答 | PermissionRequest フックが別途必要 | 同じ仕組みでできる |
| 作業中に届いた指示 | 本体側で保留して次の待機に渡す | キューに入る |
| ターミナルとの共存 | 可能 | 可能 |

## 6. 既存の類似ツール
`specs/00-product/landscape.md` を参照。

## 参考資料
- [Channels reference - Claude Code Docs](https://code.claude.com/docs/en/channels-reference)
- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Connect Claude Code to tools via MCP - Claude Code Docs](https://code.claude.com/docs/en/mcp)
- [interlink-mcp DELIVERY.md](https://docs.rs/crate/interlink-mcp/latest/source/docs/DELIVERY.md)
- [Issue #89960: asyncRewake blocks session startup](https://github.com/anthropics/claude-code/issues/89960)
- [cliq/claude-monitor](https://github.com/cliq/claude-monitor)
- [bruceyxli/claude-code-monitor](https://github.com/bruceyxli/claude-code-monitor)
