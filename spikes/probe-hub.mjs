// 検証スパイク用（使い捨て）: 仮の Hub 本体。/poll の接続の開始・終了を記録するだけ。
// T0-6: claude の強制終了時に、本体が /poll の接続切断を検知できるかを見る。
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')
mkdirSync(logDir, { recursive: true })
const log = (type, extra = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), type, ...extra })
  console.log(line)
  try { appendFileSync(join(logDir, 'hub.jsonl'), line + '\n') } catch {}
}

const readJson = async (req) => {
  let raw = ''
  for await (const c of req) raw += c
  try { return JSON.parse(raw) } catch { return {} }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return }

  if (req.method === 'POST' && req.url === '/poll') {
    const me = await readJson(req)
    log('poll-open', { session: me.session, pid: me.pid, account: me.account })
    // 切断の検知: レスポンスを返す前に接続が閉じたら、クライアントが落ちたということ
    res.on('close', () => log('poll-close', { session: me.session, pid: me.pid, answered: res.writableFinished }))
    const timer = setTimeout(() => { res.statusCode = 204; res.end() }, 30000)
    res.on('close', () => clearTimeout(timer))
    return
  }

  if (req.method === 'POST' && req.url === '/bye') {
    const me = await readJson(req)
    log('bye', { session: me.session, pid: me.pid, reason: me.reason })
    res.end('ok')
    return
  }

  res.statusCode = 404
  res.end()
}).listen(8765, '127.0.0.1', () => log('hub-listening', { port: 8765 }))
