// 検証スパイク用（使い捨て）: チャネルサーバーの最小実装。
// チャネル機能（claude/channel）は宣言しない通常の MCP サーバーとして起動する。
// 目的（specs/30-features/001-session-list/tasks.md）:
//   T0-4: MCP サーバー側の CLAUDE_CODE_SESSION_ID がフックの session_id と一致するか
//   T0-5: 開発用フラグ・警告画面なしで起動できるか
//   T0-6: claude の強制終了時に stdin クローズ／プロセス終了／/poll の切断を検知できるか
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HUB = 'http://127.0.0.1:8765'
const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')
mkdirSync(logDir, { recursive: true })

const me = {
  session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
  account: process.env.CLAUDE_CONFIG_DIR ?? null,
  cwd: process.cwd(),
  pid: process.pid,
}

const log = (type, extra = {}) => {
  try {
    appendFileSync(join(logDir, 'mcp.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, session: me.session, pid: process.pid, ...extra }) + '\n')
  } catch {}
}

const parentAlive = () => {
  try { process.kill(process.ppid, 0); return true } catch { return false }
}

log('start', {
  ppid: process.ppid,
  env: {
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? null,
  },
  cwd: process.cwd(),
  argv: process.argv.slice(2),
})

let stopping = false
const shutdown = async (reason) => {
  if (stopping) return
  stopping = true
  log('shutdown', { reason, parentAlive: parentAlive() })
  try {
    await fetch(HUB + '/bye', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...me, reason }),
      signal: AbortSignal.timeout(500),
    })
  } catch {}
  process.exit(0)
}

process.stdin.on('end', () => shutdown('stdin-end'))
process.stdin.on('close', () => shutdown('stdin-close'))
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try { process.on(sig, () => shutdown(sig)) } catch {}
}
process.on('exit', (code) => log('exit', { code }))

// 通常の MCP サーバー（チャネル機能は宣言しない）
const mcp = new Server({ name: 'coders-hub-probe', version: '0.0.0' }, { capabilities: {} })
await mcp.connect(new StdioServerTransport())
log('connected')

// 生存の記録（強制終了のあと、孤児プロセスとして残るかを見る）
setInterval(() => log('alive', { parentAlive: parentAlive() }), 5000)

// Hub 本体へのロングポーリング（設計どおり。仮の本体 probe-hub.mjs が受ける）
for (;;) {
  if (stopping) break
  try {
    const res = await fetch(HUB + '/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(me),
    })
    log('poll-result', { status: res.status })
  } catch (e) {
    log('poll-error', { message: String(e?.cause?.code ?? e?.message ?? e) })
    await new Promise((r) => setTimeout(r, 3000))
  }
}
