// Hub 本体: 内部 API（127.0.0.1:8765）と、画面用の静的配信・WebSocket（:8766）。
// 状態管理は sessions.mjs に任せ、ここは入出力だけを担う。API の定義は specs/20-design/api/README.md。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { loadConfig } from '../shared/config.mjs'
import { createStore } from './sessions.mjs'
import { createTranscriptMonitor } from './monitor.mjs'
import { createStatusMonitor } from './status-monitor.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MAX_BODY_BYTES = 1_000_000

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

// 画面が未ビルドのときに出す、動作確認用の簡易ページ（受け取った一覧をそのまま表示する）
const FALLBACK_PAGE = `<!doctype html>
<meta charset="utf-8"><title>Coders Hub（画面は未ビルド）</title>
<style>body{font:14px/1.5 monospace;margin:16px}pre{white-space:pre-wrap}</style>
<h1>Coders Hub</h1>
<p>画面（React）はまだビルドされていません。WebSocket で受け取った一覧を表示します。</p>
<p id="status">接続中…</p><pre id="out"></pre>
<script>
const sessions = new Map(); const out = document.getElementById('out'); const status = document.getElementById('status')
const render = () => { out.textContent = JSON.stringify([...sessions.values()], null, 2) }
const connect = () => {
  const ws = new WebSocket('ws://' + location.host + '/ws')
  ws.onopen = () => { status.textContent = '接続済み' }
  ws.onclose = () => { status.textContent = '切断。再接続します…'; setTimeout(connect, 1000) }
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.type === 'snapshot') { sessions.clear(); m.sessions.forEach((s) => sessions.set(s.sessionId, s)) }
    else if (m.type === 'removed') sessions.delete(m.sessionId)
    else sessions.set(m.session.sessionId, m.session)
    render()
  }
}
connect()
</script>`

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const send = (res, status, body = '', type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

const readJson = async (req) => {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object') throw new Error('not an object')
    return value
  } catch {
    throw new HttpError(400, 'invalid json')
  }
}

const listen = (server, port, host) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })

export const createHub = ({
  config = loadConfig(),
  store = createStore({ expireMs: config.expireMs }),
  staticDir = path.resolve(here, '../../dist/web'),
  sweepIntervalMs = 5000,
  monitorIntervalMs = 1000,
  monitor = createTranscriptMonitor({ store, intervalMs: monitorIntervalMs }),
  statusIntervalMs = 500,
  // null にすると、claude の状態ファイルを見ない（テスト用）
  statusMonitor = createStatusMonitor({ store, intervalMs: statusIntervalMs }),
  log = () => {},
} = {}) => {
  // ---- 内部 API（hook / channel → Hub） ----

  // sessionId -> 保留中の /poll。1 セッションにつき 1 本だけ
  const polls = new Map()

  const answerPoll = (entry) => {
    entry.answered = true
    clearTimeout(entry.timer)
    if (!entry.res.writableEnded) send(entry.res, 204)
  }

  const handlePoll = async (req, res) => {
    const body = await readJson(req)
    const sessionId = body.session
    if (typeof sessionId !== 'string' || !sessionId) throw new HttpError(400, 'session is required')
    // 待っている間に切れていたら、登録しない（切断の通知が先に済んでいるため）
    if (res.destroyed) return

    store.registerChannel({ sessionId, account: body.account ?? null, cwd: body.cwd ?? null })

    const previous = polls.get(sessionId)
    if (previous) answerPoll(previous)

    const entry = { res, answered: false, timer: null }
    entry.timer = setTimeout(() => answerPoll(entry), config.pollTimeoutMs)
    polls.set(sessionId, entry)
    // 応答する前に接続が切れた = claude が終了した（強制終了を含む）。即座に外す
    res.on('close', () => {
      clearTimeout(entry.timer)
      if (polls.get(sessionId) === entry) polls.delete(sessionId)
      if (!entry.answered && !res.writableFinished) {
        log('poll-closed', { sessionId })
        store.channelGone(sessionId)
      }
    })
  }

  const internal = http.createServer(async (req, res) => {
    try {
      const route = `${req.method} ${req.url.split('?')[0]}`
      if (route === 'GET /health') return send(res, 200, 'ok')
      if (route === 'POST /event') {
        const body = await readJson(req)
        if (typeof body.event !== 'string' || typeof body.input !== 'object' || body.input === null) {
          throw new HttpError(400, 'event and input are required')
        }
        store.applyHookEvent({ event: body.event, input: body.input, account: body.account ?? null })
        return send(res, 204)
      }
      if (route === 'POST /poll') return await handlePoll(req, res)
      if (route === 'POST /bye') {
        // チャネルサーバーが終了を知らせた（stdin が閉じたとき）
        const body = await readJson(req)
        if (typeof body.session === 'string') store.channelGone(body.session)
        return send(res, 204)
      }
      send(res, 404, 'not found')
    } catch (e) {
      if (res.headersSent) return res.destroy()
      send(res, e instanceof HttpError ? e.status : 500, e instanceof HttpError ? e.message : 'internal error')
    }
  })

  // ---- 画面側（静的ファイルと WebSocket） ----

  const serveStatic = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405)
    let rel
    try {
      rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'
    } catch {
      return send(res, 400)
    }
    const root = path.resolve(staticDir)
    const file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403)
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        // 画面が未ビルドのときだけ、簡易ページを返す
        if (rel === 'index.html') return send(res, 200, FALLBACK_PAGE, CONTENT_TYPES['.html'])
        return send(res, 404, 'not found')
      }
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
      })
      if (req.method === 'HEAD') return res.end()
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res)
    })
  }

  const ui = http.createServer(serveStatic)
  const wss = new WebSocketServer({ noServer: true })

  // 別のサイトのページから WebSocket をつながれないように、Origin が自分のホストのときだけ受け付ける
  const originAllowed = (req) => {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  ui.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== '/ws' || !originAllowed(req)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {})
      ws.send(JSON.stringify({ type: 'snapshot', now: Date.now(), sessions: store.list() }))
    })
  })

  const broadcast = (message) => {
    const text = JSON.stringify(message)
    for (const client of wss.clients) if (client.readyState === 1) client.send(text)
  }
  const unsubscribe = store.subscribe((change) => broadcast(change))

  // ---- 起動と停止 ----

  let sweepTimer = null

  return {
    store,
    async start() {
      const internalPort = await listen(internal, config.internalPort, config.host)
      let uiPort
      try {
        uiPort = await listen(ui, config.uiPort, config.host)
      } catch (e) {
        internal.close()
        throw e
      }
      sweepTimer = setInterval(() => {
        for (const id of store.sweep()) log('expired', { sessionId: id })
      }, sweepIntervalMs)
      sweepTimer.unref()
      monitor.start()
      statusMonitor?.start()
      return { internalPort, uiPort }
    },
    async stop() {
      clearInterval(sweepTimer)
      monitor.stop()
      statusMonitor?.stop()
      unsubscribe()
      for (const client of wss.clients) client.terminate()
      internal.closeAllConnections()
      ui.closeAllConnections()
      await Promise.all([internal, ui].map((s) => new Promise((resolve) => (s.listening ? s.close(resolve) : resolve()))))
    },
  }
}
