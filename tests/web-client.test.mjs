// WebSocket クライアント（スナップショット、差分、切断時の再接続）。偽の WebSocket とタイマーで確認する
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '../src/web/client.mjs'

const setup = ({ now = () => 10_000 } = {}) => {
  const sockets = []
  class FakeWebSocket {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this) }
    close() { this.closed = true; this.onclose?.() }
    open() { this.onopen?.() }
    receive(message) { this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) }) }
    drop() { this.onclose?.() }
  }
  const timers = []
  const states = []
  const client = createClient({
    url: 'ws://hub/ws',
    onChange: (st) => states.push(st),
    WebSocketImpl: FakeWebSocket,
    now,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
  })
  return { client, sockets, timers, states, last: () => states.at(-1) }
}
const sess = (id, state = 'working') => ({ sessionId: id, state, stateSince: 1, account: null, cwd: null, lastPrompt: null, channelAlive: true })

describe('createClient', () => {
  it('接続前は ready ではない（空の表示を出さない）', () => {
    const t = setup()
    t.client.start()
    assert.equal(t.last().ready, false)
    assert.equal(t.last().connected, false)
  })

  it('AC-001-1: スナップショットと差分を適用し、Hub との時刻のずれを持つ', () => {
    const t = setup({ now: () => 10_000 })
    t.client.start()
    const ws = t.sockets[0]
    ws.open()
    ws.receive({ type: 'snapshot', now: 12_500, sessions: [sess('a')] })
    assert.equal(t.last().connected, true)
    assert.equal(t.last().ready, true)
    assert.equal(t.last().offset, 2_500)
    ws.receive({ type: 'added', session: sess('b', 'waiting') })
    ws.receive({ type: 'updated', session: sess('a', 'permission') })
    ws.receive({ type: 'removed', sessionId: 'b' })
    assert.deepEqual([...t.last().sessions.values()].map((x) => [x.sessionId, x.state]), [['a', 'permission']])
  })

  it('壊れたメッセージは無視する', () => {
    const t = setup()
    t.client.start()
    t.sockets[0].open()
    t.sockets[0].receive('not json')
    assert.equal(t.last().connected, true)
  })

  it('切断されたら最後の一覧を残して接続中を外し、自動で再接続してスナップショットを取り直す', () => {
    const t = setup()
    t.client.start()
    t.sockets[0].open()
    t.sockets[0].receive({ type: 'snapshot', now: 10_000, sessions: [sess('a')] })
    t.sockets[0].drop()
    assert.equal(t.last().connected, false)
    assert.equal(t.last().sessions.size, 1) // 古い情報として残す
    assert.equal(t.timers.at(-1).ms, 1000)

    t.timers.at(-1).fn() // 1 秒後
    assert.equal(t.sockets.length, 2)
    t.sockets[1].open()
    t.sockets[1].receive({ type: 'snapshot', now: 10_000, sessions: [sess('z')] })
    assert.equal(t.last().connected, true)
    assert.deepEqual([...t.last().sessions.keys()], ['z'])
  })

  it('stop したら再接続しない', () => {
    const t = setup()
    t.client.start()
    t.sockets[0].open()
    t.client.stop()
    assert.equal(t.sockets[0].closed, true)
    assert.equal(t.timers.length, 0)
  })
})
