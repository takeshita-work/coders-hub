# セットアップ手順（下書き）

- **未実装の段階の下書き**。実装後に実態に合わせて更新する
- 仕様（`specs/`）との差分:
  - MVP は一覧のみ。`wait.mjs`（asyncRewake 方式）は MVP では使わない
  - MVP のチャネルサーバーは登録と生存確認だけ（ADR 0006）。開発用フラグが必要かは要検証
  - 配置先は元の案では `C:\tools\coders-hub\`。現在の作業ディレクトリは `D:\organization\works\#tools\#web-app\coders-hub`。配置先は未決

## 1. 配置（初回のみ）

```powershell
mkdir C:\tools\coders-hub
cd C:\tools\coders-hub
npm init -y
npm install @modelcontextprotocol/sdk zod
```

```
C:\tools\coders-hub\
├── hub.mjs          ← Coders Hub 本体
├── channel.mjs      ← チャネルサーバー（各セッションが自動で起動）
├── hook.mjs         ← フック用スクリプト（状態通知）
├── wait.mjs         ← asyncRewake 用の待機スクリプト（代替方式。MVP では使わない）
├── mcp.json         ← チャネルサーバーの起動設定
├── package.json
└── node_modules\
```

## 2. `mcp.json`

```json
{
  "mcpServers": {
    "coders-hub": {
      "command": "node",
      "args": ["C:\\tools\\coders-hub\\channel.mjs"]
    }
  }
}
```

## 3. フック設定（アカウントごとに初回のみ）
各 `CLAUDE_CONFIG_DIR` の `settings.json` に追加する。

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node C:/tools/coders-hub/hook.mjs", "async": true }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node C:/tools/coders-hub/hook.mjs", "async": true }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "node C:/tools/coders-hub/hook.mjs", "async": true }] }]
  }
}
```

asyncRewake 方式を使う場合（「次」の段階の代替方式）は、Stop に次を追加する。

```json
{ "type": "command", "command": "node C:/tools/coders-hub/wait.mjs", "asyncRewake": true, "timeout": 86400 }
```

## 4. 起動用の関数（初回のみ）

```powershell
# $PROFILE に追記
function claude-work {
  $env:CLAUDE_CONFIG_DIR = "C:\Users\you\.claude-work"
  claude --mcp-config C:\tools\coders-hub\mcp.json `
         --dangerously-load-development-channels server:coders-hub @args
}
```

`--dangerously-load-development-channels` は、チャネル機能を宣言する場合に必要。MVP で不要になるかは要検証（ADR 0006）。

## 5. 作業のまとめ

| タイミング | 作業 | 手動／自動 |
|---|---|---|
| 初回のみ | ファイルの配置、`mcp.json` の作成 | 手動 |
| アカウントごとに初回のみ | `settings.json` へのフック追加 | 手動（スクリプト化も可） |
| 初回のみ | 起動用の関数の作成 | 手動 |
| 毎回 | セッションの登録・生存確認・終了検知 | 自動 |
| 毎回 | 開発用チャネルの警告画面の承認 | 手動（Enter 1回）。必要な場合のみ |
