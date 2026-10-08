// 負荷確認（AC-001-4, AC-001-3）: 擬似セッション 30 件を Hub につなぎ、反映の時間と表示を確認する
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WebSocket } from 'ws'
import { createHub } from '../src/hub/hub.mjs'
import { reduceMessage } from '../src/web/logic.mjs'
import { App } from '../src/web/components.mjs'

const N = 30
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BS = String.fromCharCode(92)
const account = (i) => ['C:', 'Users', 'yuya', `.claude-acc${i % 3}`].join(BS)

let hub, ports, ws, sessions, messages
before(async () => {
  hub = createHub({ statusMonitor: null, config: { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 30_000, expireMs: 50_000 } })
  ports = await hub.start()
  sessions = new Map()
  messages = 0
  ws = new WebSocket(`ws://127.0.0.1:${ports.uiPort}/ws`)
  ws.on('message', (d) => {
    messages += 1
    sessions = reduceMessage(sessions, JSON.parse(d))
  })
  await new Promise((resolve) => ws.once('open', resolve))
})
after(async () => {
  ws.close()
  await hub.stop()
})

const post = (route, body, init = {}) =>
  fetch(`http://127.0.0.1:${ports.internalPort}${route}`, { method: 'POST', body: JSON.stringify(body), ...init })
const hook = (event, i, extra = {}) =>
  post('/event', { event, account: account(i), input: { session_id: `load-${i}`, cwd: ['D:', 'work', `proj${i % 5}`].join(BS), ...extra } })
const until = async (fn, timeout = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return Date.now() - t0
    await sleep(5)
  }
  throw new Error('timeout')
}

describe('30 セッション', () => {
  const aborts = []

  it('AC-001-4: 30 セッションが同時に /poll でつながり、全部が一覧に出る', async () => {
    for (let i = 0; i < N; i++) {
      const ac = new AbortController()
      aborts.push(ac)
      post('/poll', { session: `load-${i}`, account: account(i), cwd: 'D:\\x' }, { signal: ac.signal }).catch(() => {})
    }
    await until(() => sessions.size === N)
    assert.equal(sessions.size, N)
  })

  it('AC-001-3, 4: 30 件の状態変化を一斉に送っても、3 秒以内に全部の表示が更新される', async () => {
    const t0 = Date.now()
    await Promise.all(Array.from({ length: N }, (_, i) => hook('UserPromptSubmit', i, { prompt: `依頼 ${i}` })))
    const ms = await until(() => [...sessions.values()].every((s) => s.state === 'working'))
    console.log(`  30 件の更新の反映: ${Date.now() - t0}ms（受信 ${ms}ms 待ち）`)
    assert.ok(Date.now() - t0 < 3000)
  })

  it('AC-001-4: 各セッションが 10 回ずつ状態を変える（計 300 件）を送っても、最終状態が正しい', async () => {
    const states = ['PermissionRequest', 'PostToolUse', 'Stop', 'UserPromptSubmit']
    const t0 = Date.now()
    for (let round = 0; round < 10; round++) {
      await Promise.all(Array.from({ length: N }, (_, i) => hook(states[(round + i) % 4], i, { prompt: 'x' })))
    }
    // 最後に全員を返答待ちにする
    await Promise.all(Array.from({ length: N }, (_, i) => hook('Stop', i)))
    await until(() => [...sessions.values()].every((s) => s.state === 'waiting'))
    console.log(`  330 件のイベント: ${Date.now() - t0}ms、WebSocket のメッセージ ${messages} 件`)
    assert.equal(sessions.size, N)
    assert.ok(Date.now() - t0 < 5000)
  })

  it('AC-001-4: 30 行の画面を描画できる（描画時間が 100ms 以内）', () => {
    const state = { sessions, connected: true, ready: true, offset: 0 }
    const t0 = performance.now()
    const html = renderToStaticMarkup(h(App, { state, now: Date.now(), filter: 'all' }))
    const ms = performance.now() - t0
    console.log(`  30 行の描画: ${ms.toFixed(1)}ms`)
    assert.equal((html.match(/data-session-id=/g) ?? []).length, N)
    assert.equal((html.match(/class="group"/g) ?? []).length, 3)
    assert.ok(ms < 100)
  })

  it('AC-001-5: 30 セッションを一斉に強制終了（接続切断）しても、すべて外れる', async () => {
    const t0 = Date.now()
    aborts.forEach((ac) => ac.abort())
    await until(() => sessions.size === 0)
    console.log(`  30 件の切断の反映: ${Date.now() - t0}ms`)
    assert.ok(Date.now() - t0 < 3000)
  })
})
