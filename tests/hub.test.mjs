// 結合テスト: Hub を実際に起動し、内部 API と WebSocket を通して確認する（AC-001-1, 3, 5, 6）
import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { createHub } from '../src/hub/hub.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ACCOUNT = 'C:\\Users\\yuya\\.claude-a'

let hub, ports, dir
const config = { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 300, expireMs: 400 }

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-test-'))
  fs.mkdirSync(path.join(dir, 'static'))
  fs.writeFileSync(path.join(dir, 'static', 'app.js'), 'console.log(1)')
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret')
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

beforeEach(async () => {
  hub = createHub({ config, statusMonitor: null, staticDir: path.join(dir, 'static'), sweepIntervalMs: 50 })
  ports = await hub.start()
})
afterEach(() => hub.stop())

const internal = (p, body, init = {}) =>
  fetch(`http://127.0.0.1:${ports.internalPort}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
const hook = (event, extra = {}, session = 's1') =>
  internal('/event', { event, account: ACCOUNT, input: { session_id: session, cwd: 'D:\\proj', ...extra } })

// WebSocket に接続し、届いたメッセージを溜める
const connect = (headers = {}) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${ports.uiPort}/ws`, { headers })
    const messages = []
    const waiters = []
    ws.on('message', (data) => {
      messages.push(JSON.parse(data))
      waiters.forEach((w) => w())
    })
    const client = {
      ws,
      messages,
      waitFor(predicate, timeout = 2000) {
        return new Promise((res, rej) => {
          const check = () => {
            const m = messages.find(predicate)
            if (m) { res(m); return true }
            return false
          }
          if (check()) return
          const timer = setTimeout(() => rej(new Error('timeout: ' + JSON.stringify(messages))), timeout)
          waiters.push(() => { if (check()) clearTimeout(timer) })
        })
      },
    }
    ws.once('open', () => resolve(client))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error('rejected ' + res.statusCode)))
  })

const rawGet = (port, urlPath) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    }).on('error', reject)
  })

describe('内部 API', () => {
  it('GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${ports.internalPort}/health`)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'ok')
  })

  it('不正な入力は 400、未知のパスは 404', async () => {
    assert.equal((await internal('/event', 'not json')).status, 400)
    assert.equal((await internal('/event', { event: 'Stop' })).status, 400)
    assert.equal((await internal('/poll', {})).status, 400)
    assert.equal((await internal('/nope', {})).status, 404)
  })

  it('大きすぎる本文は 413', async () => {
    const res = await internal('/event', JSON.stringify({ event: 'Stop', input: { x: 'a'.repeat(1_100_000) } }))
    assert.equal(res.status, 413)
  })
})

describe('WebSocket への配信', () => {
  it('AC-001-1, 3: 接続時にスナップショット、以降はフックの変化が差分で届く', async () => {
    const c = await connect()
    const snap = await c.waitFor((m) => m.type === 'snapshot')
    assert.deepEqual(snap.sessions, [])

    const t0 = Date.now()
    assert.equal((await hook('SessionStart')).status, 204)
    const added = await c.waitFor((m) => m.type === 'added')
    assert.equal(added.session.state, 'waiting')
    assert.equal(added.session.account, ACCOUNT)

    await hook('UserPromptSubmit', { prompt: 'こんにちは' })
    const updated = await c.waitFor((m) => m.type === 'updated' && m.session.state === 'working')
    assert.equal(updated.session.lastPrompt, 'こんにちは')
    assert.ok(Date.now() - t0 < 3000) // AC-001-3

    await hook('SessionEnd')
    await c.waitFor((m) => m.type === 'removed' && m.sessionId === 's1')
    c.ws.close()
  })

  it('後から接続した画面は、スナップショットで現在の一覧を受け取る', async () => {
    await hook('PermissionRequest')
    const c = await connect()
    const snap = await c.waitFor((m) => m.type === 'snapshot')
    assert.equal(snap.sessions.length, 1)
    assert.equal(snap.sessions[0].state, 'permission')
    c.ws.close()
  })

  it('別のサイトの Origin からの接続は拒否する', async () => {
    await assert.rejects(connect({ Origin: 'http://evil.example' }))
  })

  it('自分のホストの Origin なら接続できる', async () => {
    const c = await connect({ Origin: `http://127.0.0.1:${ports.uiPort}` })
    c.ws.close()
  })
})

describe('/poll（チャネルサーバーの登録と生存確認）', () => {
  it('登録され、指示がなければ周期で 204 を返す', async () => {
    const c = await connect()
    const t0 = Date.now()
    const res = await internal('/poll', { session: 'p1', account: ACCOUNT, cwd: 'D:\\proj', pid: 1 })
    assert.equal(res.status, 204)
    assert.ok(Date.now() - t0 >= 250)
    const added = c.messages.find((m) => m.type === 'added' && m.session.sessionId === 'p1')
    assert.equal(added.session.channelAlive, true)
    c.ws.close()
  })

  it('AC-001-5: 応答前に接続が切れたら（強制終了）、すぐ一覧から外れる', async () => {
    const c = await connect()
    const ac = new AbortController()
    const pending = internal('/poll', { session: 'p2', account: ACCOUNT }, { signal: ac.signal }).catch(() => {})
    await c.waitFor((m) => m.type === 'added' && m.session.sessionId === 'p2')
    const t0 = Date.now()
    ac.abort()
    await pending
    await c.waitFor((m) => m.type === 'removed' && m.sessionId === 'p2')
    assert.ok(Date.now() - t0 < 1000)
    c.ws.close()
  })

  it('周期の 204 のあとに再度 /poll が来る間は、外れない', async () => {
    let alive = true
    const loop = (async () => {
      while (alive) await internal('/poll', { session: 'p3' }).catch(() => {})
    })()
    await sleep(1000) // 期限 400ms より長く、/poll を続ける
    assert.ok(hub.store.get('p3'))
    alive = false
    await sleep(350)
    await loop
  })

  it('AC-001-5: /poll が止まって期限（expireMs）を過ぎたら外れる', async () => {
    const res = await internal('/poll', { session: 'p4' }) // 300ms で 204。以降は来ない
    assert.equal(res.status, 204)
    assert.ok(hub.store.get('p4'))
    await sleep(700)
    assert.equal(hub.store.get('p4'), null)
  })

  it('/bye で外れる', async () => {
    await internal('/poll', { session: 'p5' }).catch(() => {})
    assert.ok(hub.store.get('p5'))
    assert.equal((await internal('/bye', { session: 'p5' })).status, 204)
    assert.equal(hub.store.get('p5'), null)
  })

  it('同じセッションの新しい /poll が来たら、古い /poll は 204 で終わり、外れない', async () => {
    const first = internal('/poll', { session: 'p6' })
    await sleep(50)
    const second = internal('/poll', { session: 'p6' })
    assert.equal((await first).status, 204)
    await sleep(50)
    assert.ok(hub.store.get('p6'))
    await second
  })
})

describe('AC-001-6: 本体の再起動', () => {
  it('再起動後、/poll の自己情報だけで一覧に戻る', async () => {
    await hook('UserPromptSubmit', { prompt: 'x' }, 'r1')
    await hub.stop()

    hub = createHub({ config, statusMonitor: null, staticDir: path.join(dir, 'static'), sweepIntervalMs: 50 })
    ports = await hub.start()
    assert.equal(hub.store.list().length, 0)

    const pending = internal('/poll', { session: 'r1', account: ACCOUNT, cwd: 'D:\\proj' })
    await sleep(100)
    const s = hub.store.get('r1')
    assert.equal(s.state, 'waiting') // 状態は失われ、次のフックで更新される
    assert.equal(s.account, ACCOUNT)
    await pending
  })
})

describe('画面の配信', () => {
  it('静的ファイルを返す', async () => {
    const r = await rawGet(ports.uiPort, '/app.js')
    assert.equal(r.status, 200)
    assert.equal(r.body, 'console.log(1)')
    assert.match(r.headers['content-type'], /javascript/)
  })

  it('存在しないファイルは 404', async () => {
    assert.equal((await rawGet(ports.uiPort, '/missing.js')).status, 404)
  })

  it('配信フォルダの外には出られない', async () => {
    assert.equal((await rawGet(ports.uiPort, '/..%2fsecret.txt')).status, 403)
    assert.equal((await rawGet(ports.uiPort, '/%2e%2e/secret.txt')).status, 403)
  })

  it('画面が未ビルド（index.html がない）なら簡易ページを返す', async () => {
    const r = await rawGet(ports.uiPort, '/')
    assert.equal(r.status, 200)
    assert.match(r.body, /WebSocket/)
  })
})
