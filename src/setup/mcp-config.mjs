// claude に渡す MCP 設定（--mcp-config）を作る。名前はどちらのモードも coders-hub に揃える（ADR 0011）。
//  - 一覧だけのモード: 引数なし。開発用フラグは要らない
//  - 操作モード: --channel 付き。claude の起動時に --dangerously-load-development-channels server:coders-hub が必要

export const SERVER_NAME = 'coders-hub'
export const CHANNEL_FLAG = `--dangerously-load-development-channels server:${SERVER_NAME}`

// channelPath: channel.mjs の絶対パス。Windows のパスはバックスラッシュを / にする
export const buildMcpConfig = (channelPath, { channel = false } = {}) => ({
  mcpServers: {
    [SERVER_NAME]: {
      command: 'node',
      args: [channelPath.replaceAll('\\', '/'), ...(channel ? ['--channel'] : [])],
    },
  },
})
