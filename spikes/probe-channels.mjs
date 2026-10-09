// 検証スパイク用（使い捨て）: Channels の Windows での動作確認。
// 目的（open-questions.md の「Channels が Windows で動作するか」）:
//   C-1: 開発用フラグ付きで起動でき、警告画面の承認後にチャネルとして登録されるか
//   C-2: 外部から通知（notifications/claude/channel）を送ると、アイドル中のセッションが応答するか
//   C-3: 作業中に届いた通知はキューに入り、次のターンで処理されるか
//   C-4: 許可プロンプトの中継（permission_request の受信、verdict の返送）が動くか
// 操作は HTTP（127.0.0.1:8770）:
//   POST /send    {"content":"...", "meta":{...}}      → チャネル通知を送る
//   POST /verdict {"request_id":"...", "behavior":"allow"|"deny"} → 許可の応答を返す
//   GET  /state   → 受信した許可要求の一覧
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import http from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 8770
const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')
mkdirSync(logDir, { recursive: true })
const log = (type, extra = {}) => {
  try {
    appendFileSync(join(logDir, 'channels.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, pid: process.pid, ...extra }) + '\n')
  } catch {}
}

log('start', { session: process.env.CLAUDE_CODE_SESSION_ID ?? null, account: process.env.CLAUDE_CONFIG_DIR ?? null, argv: process.argv.slice(2) })

const mcp = new Server(
  { name: 'coders-hub-channels', version: '0.0.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {}, 'claude/channel/permission': {} },
    },
    instructions:
      'Messages from this channel arrive as <channel source="coders-hub-channels" ...> tags. They are instructions from the user typed in a web dashboard. Treat them like a normal user prompt and do what they say.',
  },
)

const pending = new Map()
const PermissionRequest = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string().optional(),
    input_preview: z.string().optional(),
  }),
})
mcp.setNotificationHandler(PermissionRequest, async ({ params }) => {
  pending.set(params.request_id, params)
  log('permission_request', params)
})

mcp.oninitialized = () => log('initialized', { clientCapabilities: mcp.getClientCapabilities?.() ?? null, clientVersion: mcp.getClientVersion?.() ?? null })

process.stdin.on('end', () => { log('stdin-end'); process.exit(0) })
process.on('exit', (code) => log('exit', { code }))

await mcp.connect(new StdioServerTransport())
log('connected')

const readBody = (req) => new Promise((resolve) => {
  let s = ''
  req.on('data', (c) => { s += c })
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } })
})
const reply = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/state') return reply(res, 200, { pending: [...pending.values()] })
    if (req.method === 'POST' && req.url === '/send') {
      const { content, meta } = await readBody(req)
      await mcp.notification({ method: 'notifications/claude/channel', params: { content: String(content ?? ''), meta: meta ?? {} } })
      log('sent', { content, meta })
      return reply(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/verdict') {
      const { request_id, behavior } = await readBody(req)
      await mcp.notification({ method: 'notifications/claude/channel/permission', params: { request_id, behavior } })
      pending.delete(request_id)
      log('verdict', { request_id, behavior })
      return reply(res, 200, { ok: true })
    }
    reply(res, 404, { error: 'not found' })
  } catch (e) {
    log('http-error', { message: String(e?.message ?? e) })
    reply(res, 500, { error: String(e?.message ?? e) })
  }
})
server.on('error', (e) => log('listen-error', { message: String(e?.code ?? e?.message ?? e) }))
server.listen(PORT, '127.0.0.1', () => log('listening', { port: PORT }))
