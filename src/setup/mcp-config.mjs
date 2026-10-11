// claude に渡す MCP 設定（--mcp-config）を作る。名前はどちらのモードも coders-hub に揃える（ADR 0011）。
//  - 一覧だけのモード: 引数なし。開発用フラグは要らない
//  - 操作モード: --channel 付き。claude の起動時に --dangerously-load-development-channels server:coders-hub が必要

export const SERVER_NAME = 'coders-hub'
export const CHANNEL_FLAG = `--dangerously-load-development-channels server:${SERVER_NAME}`

// channelPath: channel.mjs の絶対パス。Windows のパスはバックスラッシュを / にする
// exePath: 配布版の exe の絶対パス。渡すと、`<exe> channel [--channel]` を起動する設定になる（ADR 0018）
export const buildMcpConfig = (channelPath, { channel = false, exePath = null } = {}) => ({
  mcpServers: {
    [SERVER_NAME]: exePath
      ? { command: exePath.replaceAll('\\', '/'), args: ['channel', ...(channel ? ['--channel'] : [])] }
      : { command: 'node', args: [channelPath.replaceAll('\\', '/'), ...(channel ? ['--channel'] : [])] },
  },
})
