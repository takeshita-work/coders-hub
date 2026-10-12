// 画面からの Hub の終了（機能 007、ADR 0020）。AC-011-24
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createHub } from '../src/hub/hub.mjs'

const config = { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 }
let hub

afterEach(() => hub?.stop())

const start = async (extra = {}) => {
  hub = createHub({ config, statusMonitor: null, instructionMonitor: null, staticDir: 'nowhere', sweepIntervalMs: 50, ...extra })
  return hub.start()
}
const post = (ports, { headers = {}, host } = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port: ports.uiPort, path: '/api/shutdown', method: 'POST',
    headers: { Host: host ?? `127.0.0.1:${ports.uiPort}`, 'X-Coders-Hub': '1', 'Content-Type': 'application/json', ...headers },
  }, (res) => {
    let raw = ''
    res.on('data', (c) => (raw += c))
    res.on('end', () => resolve({ status: res.statusCode, body: raw }))
  })
  req.on('error', reject)
  req.end('{}')
})
const until = async (fn) => {
  for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 20))
  return fn()
}

describe('POST /api/shutdown', () => {
  it('AC-011-24: 202 を返してから、終了の処理を呼ぶ', async () => {
    let called = 0
    const ports = await start({ onShutdown: () => { called += 1 } })
    const res = await post(ports)
    assert.equal(res.status, 202)
    assert.deepEqual(JSON.parse(res.body), { ok: true })
    assert.ok(await until(() => called === 1), '終了の処理が呼ばれない')
  })

  it('AC-011-24: 保護を満たさない要求（ヘッダー違い・別の Host・別の Origin）は 403 で、終了しない', async () => {
    let called = 0
    const ports = await start({ onShutdown: () => { called += 1 } })
    assert.equal((await post(ports, { headers: { 'X-Coders-Hub': '0' } })).status, 403)
    assert.equal((await post(ports, { host: `evil.example:${ports.uiPort}` })).status, 403)
    assert.equal((await post(ports, { headers: { Origin: 'http://evil.example' } })).status, 403)
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(called, 0)
  })

  it('終了の処理がない Hub は 501', async () => {
    const ports = await start()
    assert.equal((await post(ports)).status, 501)
  })
})
