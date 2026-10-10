// 結合テスト: 指示の送信 API・/poll での受け渡し・保護（機能 002、ADR 0012・0013）
// AC-002-1, 002-4, 002-5, 002-6, 002-9, 002-11, 003-1, 003-3, 003-5
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createHub } from '../src/hub/hub.mjs'

const ACCOUNT = 'C:\\Users\\yuya\\.claude-a'
const config = { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let hub, ports

beforeEach(async () => {
  hub = createHub({ config, statusMonitor: null, instructionMonitor: null, staticDir: 'nowhere', sweepIntervalMs: 50 })
  ports = await hub.start()
})
afterEach(() => hub.stop())

const internal = (route, body) =>
  fetch(`http://127.0.0.1:${ports.internalPort}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const hook = (event, extra = {}, session = 's1') =>
  internal('/event', { event, account: ACCOUNT, input: { session_id: session, cwd: 'D:\\proj', ...extra } })
const poll = (extra = {}, session = 's1') => internal('/poll', { session, account: ACCOUNT, cwd: 'D:\\proj', channel: true, ...extra })

// 画面側からの書き込み。保護を満たす既定のヘッダーを付ける
const ui = (method, route, { body, headers = {} } = {}) => {
  const host = `127.0.0.1:${ports.uiPort}`
  return fetch(`http://${host}${route}`, {
    method,
    headers: { Host: host, 'X-Coders-Hub': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const send = (text, session = 's1', opts = {}) => ui('POST', `/api/sessions/${session}/instructions`, { body: { text }, ...opts })

// 操作モードのチャネルが /poll で登録し、返答待ちになった状態にする
const ready = async () => {
  const first = await poll()
  assert.equal(first.status, 204) // 指示がなければ約 pollTimeoutMs 後に 204
  await hook('Stop')
}

describe('保護（ADR 0012、AC-002-11）', () => {
  beforeEach(async () => { await ready() })

  it('AC-002-11: 保護を満たすリクエストは受け付ける', async () => {
    assert.equal((await send('こんにちは')).status, 202)
  })

  it('AC-002-11: 独自ヘッダーがなければ 403', async () => {
    const res = await send('x', 's1', { headers: { 'X-Coders-Hub': '' } })
    assert.equal(res.status, 403)
  })

  it('AC-002-11: 他のサイトのページ（Origin が違う）からは 403', async () => {
    const res = await send('x', 's1', { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.status, 403)
  })

  it('AC-002-11: Host が違う（DNS リバインディング）と 403', async () => {
    // fetch は Host を上書きできないので、生の HTTP で送る
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: ports.uiPort, path: '/api/sessions/s1/instructions', method: 'POST',
          headers: { Host: `evil.example:${ports.uiPort}`, 'X-Coders-Hub': '1', 'Content-Type': 'application/json' } },
        (res) => { res.resume(); resolve(res.statusCode) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ text: 'x' }))
    })
    assert.equal(status, 403)
  })

  it('AC-002-11: Content-Type が JSON でなければ 403', async () => {
    const res = await send('x', 's1', { headers: { 'Content-Type': 'text/plain' } })
    assert.equal(res.status, 403)
  })

  it('AC-002-11: 事前確認（OPTIONS）は許可しない。CORS のヘッダーも返さない', async () => {
    const res = await fetch(`http://127.0.0.1:${ports.uiPort}/api/sessions/s1/instructions`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-coders-hub' },
    })
    assert.equal(res.status, 403)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })

  it('AC-002-11: 取り消しも同じ保護がかかる', async () => {
    const { id } = await (await send('x')).json()
    const res = await ui('DELETE', `/api/sessions/s1/instructions/${id}`, { headers: { 'X-Coders-Hub': '' } })
    assert.equal(res.status, 403)
  })
})

describe('受け付け（AC-002-4, 002-5, 002-9）', () => {
  it('AC-002-9: 存在しないセッションは 404', async () => {
    assert.equal((await send('x', 'nope')).status, 404)
  })

  it('AC-002-5: 操作モードでないセッションは 409', async () => {
    await poll({ channel: false })
    assert.equal((await send('x')).status, 409)
    assert.equal(hub.store.get('s1').controllable, false)
  })

  it('AC-002-4: 空は 400、上限超過は 413', async () => {
    await ready()
    assert.equal((await send('   ')).status, 400)
    assert.equal((await send('あ'.repeat(10_001))).status, 413)
    assert.equal((await ui('POST', '/api/sessions/s1/instructions', { body: {} })).status, 400)
  })
})

describe('受け渡し（AC-002-1, 003-1, 003-3）', () => {
  it('AC-002-1: 返答待ちのセッションに送ると、待機中の /poll にすぐ 200 で渡る', async () => {
    const waiting = poll() // 待機する
    await sleep(50)
    await hook('Stop')
    const res = await send('こんにちは\n2 行目')
    assert.equal(res.status, 202)
    const { id } = await res.json()
    const answered = await waiting
    assert.equal(answered.status, 200)
    assert.deepEqual(await answered.json(), { instructions: [{ id, text: 'こんにちは\n2 行目' }] })
  })

  it('AC-003-1: 作業中の指示は保留され、返答待ちになった時点で /poll に渡る', async () => {
    await ready()
    await hook('UserPromptSubmit', { prompt: '作業' })
    const waiting = poll()
    await sleep(50)
    const res = await send('あとで渡す')
    const { id, status } = await res.json()
    assert.equal(status, 'held')
    assert.equal(hub.store.get('s1').pending.length, 1)
    await hook('Stop')
    const answered = await waiting
    assert.equal(answered.status, 200)
    assert.deepEqual((await answered.json()).instructions, [{ id, text: 'あとで渡す' }])
    assert.deepEqual(hub.store.get('s1').pending, [])
  })

  it('指示を渡す前に来た /poll は、待たずに 200 を返す', async () => {
    await ready()
    await hook('UserPromptSubmit', { prompt: '作業' })
    await send('先に預ける')
    await hook('Stop')
    const res = await poll()
    assert.equal(res.status, 200)
    assert.equal((await res.json()).instructions[0].text, '先に預ける')
  })

  it('AC-003-3: 保留中の指示は取り消せる。取り消したら渡されない', async () => {
    await ready()
    await hook('UserPromptSubmit', { prompt: '作業' })
    const { id } = await (await send('やめる')).json()
    assert.equal((await ui('DELETE', `/api/sessions/s1/instructions/${id}`)).status, 204)
    assert.equal((await ui('DELETE', `/api/sessions/s1/instructions/${id}`)).status, 409, '取り消し済みは保留中ではない')
    assert.equal((await ui('DELETE', '/api/sessions/s1/instructions/zzz')).status, 404)
  })

  it('渡した指示は取り消せない（409）', async () => {
    await ready()
    const { id } = await (await send('渡す')).json()
    const taken = await poll()
    assert.equal(taken.status, 200)
    assert.equal((await ui('DELETE', `/api/sessions/s1/instructions/${id}`)).status, 409)
  })

  it('/poll の results で通知の結果が反映される（失敗 → failed）', async () => {
    await ready()
    const { id } = await (await send('渡す')).json()
    await poll() // 渡す
    const statuses = []
    hub.instructions.subscribe((c) => statuses.push(`${c.id}:${c.status}`))
    await poll({ results: [{ id, ok: false, error: 'boom' }] })
    assert.ok(statuses.includes(`${id}:failed`))
  })
})

describe('WebSocket（AC-002-6, AC-003-5）', () => {
  const connect = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${ports.uiPort}/ws`)
      const messages = []
      ws.on('message', (d) => messages.push(JSON.parse(d)))
      ws.on('open', () => resolve({ ws, messages }))
      ws.on('error', reject)
    })

  it('AC-002-6: 指示の状態の変化が instruction メッセージで届く', async () => {
    await ready()
    const { ws, messages } = await connect()
    try {
      const { id } = await (await send('こんにちは')).json()
      await sleep(100)
      const seen = messages.filter((m) => m.type === 'instruction' && m.id === id).map((m) => m.status)
      // 待機中の /poll がなければ、次の /poll まで保留のまま
      assert.deepEqual(seen, ['held'])
      const waiting = poll()
      await sleep(100)
      assert.equal((await waiting).status, 200)
      const after = messages.filter((m) => m.type === 'instruction' && m.id === id).map((m) => m.status)
      assert.deepEqual(after, ['held', 'delivering'])
    } finally {
      ws.close()
    }
  })

  it('AC-003-5: 再接続したときのスナップショットに、保留中の指示が含まれる（消えていれば画面が失われたと判定できる）', async () => {
    await ready()
    await hook('UserPromptSubmit', { prompt: '作業' })
    const { id } = await (await send('保留する本文です')).json()
    const { ws, messages } = await connect()
    try {
      await sleep(100)
      const snapshot = messages.find((m) => m.type === 'snapshot')
      const session = snapshot.sessions.find((s) => s.sessionId === 's1')
      assert.equal(session.controllable, true)
      assert.deepEqual(session.pending.map((p) => ({ id: p.id, preview: p.preview })), [{ id, preview: '保留する本文です' }])
    } finally {
      ws.close()
    }
  })
})
