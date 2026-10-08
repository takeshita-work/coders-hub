// チャネルサーバー。claude がセッションごとに起動する MCP サーバー（stdio）。
// MVP の役割は登録と生存確認だけ（ADR 0006）。チャネル機能は宣言しないので、開発用フラグは要らない（T0-5）。
//  - Hub 本体へ /poll（ロングポーリング）で自己登録し、生存を知らせる
//  - claude が終了して stdin が閉じたら /bye で知らせて終了する
//  - Hub が動いていなければ、起動する（ADR 0004）
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../shared/config.mjs'
import { ensureHub, postJson } from '../shared/hub-client.mjs'

const config = loadConfig()
const me = {
  session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
  account: process.env.CLAUDE_CONFIG_DIR ?? null,
  cwd: process.cwd(),
  pid: process.pid,
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  if (me.session) await postJson(config, '/bye', me, { timeoutMs: 500 }).catch(() => {})
  process.exit(0)
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown)

// 通常の MCP サーバーとして接続する（ツールも機能もなし）。先に接続して、claude の起動を待たせない
const mcp = new Server({ name: 'coders-hub', version: '0.1.0' }, { capabilities: {} })
await mcp.connect(new StdioServerTransport())

// セッション ID が分からなければ登録できない。MCP サーバーとして待機するだけにする
if (me.session) {
  for (;;) {
    if (stopping) break
    try {
      const res = await postJson(config, '/poll', me, { timeoutMs: config.pollTimeoutMs + 10_000 })
      if (res.status !== 204) await sleep(res.ok ? 0 : 3000) // 指示は MVP では扱わない
    } catch {
      // Hub に届かない: 起動を試みて、少し待って再接続する（再起動後の復元も同じ経路）
      await ensureHub(config)
      await sleep(1000)
    }
  }
}
