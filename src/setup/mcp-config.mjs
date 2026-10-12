// claude に登録するチャネルサーバー（MCP）のコマンドを作る（ADR 0026）。名前は coders-hub 固定（開発用フラグの server: と一致させる）。
// 登録は `claude mcp add --scope user`（アカウントごとに 1 回）。登録するサーバーは常に --channel つきで、操作モードの起動には
// claude の起動時に --dangerously-load-development-channels server:coders-hub が要る（ADR 0011 の「一覧だけのモード」は、MCP 設定を分けないので、この登録では使わない）。

export const SERVER_NAME = 'coders-hub'
export const CHANNEL_FLAG = `--dangerously-load-development-channels server:${SERVER_NAME}`

// PowerShell で、そのまま貼れるように、パスは二重引用符で囲む
const q = (s) => `"${s}"`

// channelPath: channel.mjs の絶対パス（開発時）。exePath: 配布版の exe の絶対パス（渡すと、`<exe> channel --channel` を登録する。ADR 0018）
export const buildMcpAddCommand = (channelPath, { exePath = null } = {}) => {
  const server = exePath ? `${q(exePath)} channel --channel` : `node ${q(channelPath)} --channel`
  return `claude mcp add --scope user ${SERVER_NAME} -- ${server}`
}

export const MCP_REMOVE_COMMAND = `claude mcp remove --scope user ${SERVER_NAME}`
