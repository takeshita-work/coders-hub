// 画面側の指示の送信（機能 002）: 表示ロジック・クライアント・部品
// AC-002-1, 002-4, 002-5, 002-6, 002-9, 003-3, 003-5
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MAX_INSTRUCTION, addRejected, addSubmitted, holdNotice, reconcileInstructions, recordsFor, reduceInstruction, validateInstruction,
} from '../src/web/logic.mjs'
import { createClient } from '../src/web/client.mjs'
import { App, Composer, Instructions } from '../src/web/components.mjs'

const sess = (id, extra = {}) => ({
  sessionId: id, state: 'waiting', stateSince: 1, account: 'C:\\x\\.claude-a', cwd: 'D:\\p', lastPrompt: null, channelAlive: true,
  controllable: true, pending: [], ...extra,
})
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('入力の検証（AC-002-4）', () => {
  it('空・空白だけは送れない', () => {
    for (const t of ['', '  \n ', undefined]) assert.equal(validateInstruction(t).ok, false)
  })
  it('上限（10,000 文字）までは送れて、超えたら送れない', () => {
    assert.equal(validateInstruction('あ'.repeat(MAX_INSTRUCTION)).ok, true)
    const over = validateInstruction('あ'.repeat(MAX_INSTRUCTION + 1))
    assert.equal(over.ok, false)
    assert.match(over.reason, /10000/)
  })
})

describe('記録の更新（AC-002-6）', () => {
  it('instruction メッセージで状態が変わる。WebSocket のほうが先に届いても、あとの応答で状態は戻らない', () => {
    let records = new Map()
    records = reduceInstruction(records, { type: 'instruction', sessionId: 's1', id: 'a', status: 'held' })
    records = reduceInstruction(records, { type: 'instruction', sessionId: 's1', id: 'a', status: 'delivering' })
    records = addSubmitted(records, { id: 'a', sessionId: 's1', status: 'held', preview: 'こんにちは' })
    assert.equal(records.get('a').status, 'delivering')
    assert.equal(records.get('a').preview, 'こんにちは')
    records = reduceInstruction(records, { type: 'instruction', sessionId: 's1', id: 'a', status: 'failed', reason: 'boom' })
    assert.deepEqual([records.get('a').status, records.get('a').reason], ['failed', 'boom'])
    records = reduceInstruction(records, { type: 'instruction', sessionId: 's1', id: 'a', status: 'confirmed' })
    assert.equal(records.get('a').reason, undefined, '理由は新しい状態に引き継がない')
  })

  it('recordsFor は、そのセッションの記録を送った順に最大件数まで返す', () => {
    let records = new Map()
    for (let i = 0; i < 7; i++) records = addSubmitted(records, { id: `i${i}`, sessionId: i % 2 ? 's2' : 's1', status: 'held', preview: '' })
    assert.deepEqual(recordsFor(records, 's1', 3).map((r) => r.id), ['i2', 'i4', 'i6'])
  })
})

describe('再接続後の整理（AC-003-5）', () => {
  const rec = (status) => new Map([['a', { id: 'a', sessionId: 's1', status, preview: 'x' }]])

  it('保留中のはずの指示が Hub の pending になければ「失われました」になる', () => {
    const next = reconcileInstructions(rec('held'), new Map([['s1', sess('s1', { pending: [] })]]))
    assert.equal(next.get('a').status, 'lost')
    assert.match(next.get('a').reason, /再起動/)
  })

  it('再接続の直後でセッションがまだ一覧にない場合も、理由は再起動を含む', () => {
    // Hub の再起動直後は、チャネルサーバーが再登録するまでセッションが一覧にない
    assert.match(reconcileInstructions(rec('held'), new Map()).get('a').reason, /再起動/)
  })

  it('pending に残っていれば、そのまま', () => {
    const records = rec('held')
    assert.equal(reconcileInstructions(records, new Map([['s1', sess('s1', { pending: [{ id: 'a', preview: 'x' }] })]])), records)
  })

  it('セッションごと消えていても「失われました」', () => {
    assert.equal(reconcileInstructions(rec('held'), new Map()).get('a').status, 'lost')
  })

  it('送信中のまま結果を受け取れなかった指示は「届いたか確認できません」', () => {
    for (const status of ['delivering', 'sent']) {
      assert.equal(reconcileInstructions(rec(status), new Map([['s1', sess('s1')]])).get('a').status, 'unconfirmed')
    }
  })

  it('終わった指示は変えない', () => {
    const records = rec('confirmed')
    assert.equal(reconcileInstructions(records, new Map()), records)
  })
})

describe('createClient の送信（AC-002-1, 002-9, 003-3）', () => {
  const setup = (respond) => {
    const calls = []
    const states = []
    class FakeWebSocket { constructor() { this.sent = [] } close() {} }
    const client = createClient({
      url: 'ws://hub/ws',
      onChange: (st) => states.push(st),
      WebSocketImpl: FakeWebSocket,
      fetchImpl: async (url, init) => { calls.push({ url, init }); return respond(url, init) },
      setTimer: () => 0,
      clearTimer: () => {},
    })
    return { client, calls, last: () => states.at(-1) }
  }
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body })

  it('AC-002-1: 独自ヘッダーと JSON で POST し、保留／送信中の記録を残す', async () => {
    const t = setup(() => json(202, { id: 'abc123', status: 'held' }))
    t.client.start()
    const result = await t.client.sendInstruction('s 1', 'こんにちは\n2 行目')
    assert.equal(result.ok, true)
    const { url, init } = t.calls[0]
    assert.equal(url, '/api/sessions/s%201/instructions')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['X-Coders-Hub'], '1')
    assert.equal(init.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(init.body), { text: 'こんにちは\n2 行目' })
    assert.deepEqual([t.last().instructions.get('abc123').status, t.last().instructions.get('abc123').preview], ['held', 'こんにちは'])
  })

  it('AC-002-4: 空の指示は送らない', async () => {
    const t = setup(() => json(202, { id: 'x', status: 'held' }))
    t.client.start()
    assert.equal((await t.client.sendInstruction('s1', '  ')).ok, false)
    assert.equal(t.calls.length, 0)
  })

  it('AC-002-9: Hub がエラーを返したら、「送れませんでした」の記録を理由つきで残す', async () => {
    const t = setup(() => json(404, { error: 'not-found', message: 'セッションが見つかりません' }))
    t.client.start()
    const result = await t.client.sendInstruction('gone', 'やって')
    assert.deepEqual([result.ok, result.reason], [false, 'セッションが見つかりません'])
    const [rec] = [...t.last().instructions.values()]
    assert.deepEqual([rec.status, rec.reason, rec.sessionId], ['failed', 'セッションが見つかりません', 'gone'])
  })

  it('AC-002-9: Hub に接続できなくても、画面が黙らない', async () => {
    const t = setup(() => { throw new Error('network') })
    t.client.start()
    const result = await t.client.sendInstruction('s1', 'やって')
    assert.equal(result.ok, false)
    assert.equal([...t.last().instructions.values()][0].status, 'failed')
  })

  it('AC-003-3: 取り消しは DELETE（独自ヘッダーつき）。結果を閉じると記録が消える', async () => {
    const t = setup((url, init) => (init.method === 'DELETE' ? { ok: true, status: 204 } : json(202, { id: 'abc123', status: 'held' })))
    t.client.start()
    await t.client.sendInstruction('s1', 'やって')
    assert.equal((await t.client.cancelInstruction('s1', 'abc123')).ok, true)
    const del = t.calls.at(-1)
    assert.equal(del.init.method, 'DELETE')
    assert.equal(del.url, '/api/sessions/s1/instructions/abc123')
    assert.equal(del.init.headers['X-Coders-Hub'], '1')
    t.client.dismissInstruction('abc123')
    assert.equal(t.last().instructions.size, 0)
  })
})

describe('部品（AC-002-1, 002-4, 002-5, 002-6, 003-3）', () => {
  it('AC-002-5: 操作できないセッションの入力欄は出ず、理由が出る', () => {
    const html = renderToStaticMarkup(h(Composer, { session: sess('s1', { controllable: false }) }))
    assert.match(text(html), /操作モードで起動していません/)
    assert.doesNotMatch(html, /<textarea/)
  })

  it('AC-002-1, 002-4: 操作できるセッションは入力欄があり、空のうちは送信を押せない', () => {
    const html = renderToStaticMarkup(h(Composer, { session: sess('s1') }))
    assert.match(html, /<textarea[^>]*aria-label="指示"/)
    assert.match(html, /<button[^>]*class="send"[^>]*disabled/)
    assert.match(text(html), /0 \/ 10000/)
  })

  it('AC-003-1: 返答待ち以外のセッションには、返答待ちになってから送られると案内する', () => {
    assert.equal(holdNotice(sess('s1')), null)
    for (const [state, label] of [['working', '作業中'], ['permission', '許可待ち'], ['question', '質問待ち']]) {
      assert.match(holdNotice(sess('s1', { state })), new RegExp(`^${label}のため、返答待ちになってから送られます`))
    }
    assert.match(renderToStaticMarkup(h(Composer, { session: sess('s1', { state: 'working' }) })), /data-hint="hold"/)
    assert.doesNotMatch(renderToStaticMarkup(h(Composer, { session: sess('s1') })), /data-hint="hold"/)
  })

  it('AC-003-3: 保留中の指示は一覧の行に表示され、取り消しの操作がある', () => {
    const session = sess('s1', { state: 'working', pending: [{ id: 'a', createdAt: 1, preview: 'あとで頼む指示' }] })
    const state = { sessions: new Map([['s1', session]]), connected: true, ready: true, offset: 0, instructions: new Map() }
    const html = renderToStaticMarkup(h(App, { state, now: 10_000, filter: 'all' }))
    assert.match(html, /data-instruction-status="held"/)
    assert.match(text(html), /保留中 あとで頼む指示 取り消し/)
  })

  it('AC-002-6: 結果が指示ごとに出る（理由つき）。終わったものには閉じる操作がある', () => {
    const records = [
      { id: 'a', sessionId: 's1', status: 'confirmed', preview: '一つ目' },
      { id: 'b', sessionId: 's1', status: 'missed', preview: '二つ目' },
      { id: 'c', sessionId: 's1', status: 'unconfirmed', preview: '三つ目' },
      { id: 'd', sessionId: 's1', status: 'failed', preview: '四つ目', reason: 'セッションが見つかりません' },
      { id: 'e', sessionId: 's1', status: 'delivering', preview: '五つ目' },
    ]
    const html = renderToStaticMarkup(h(Instructions, { pending: [], records, sessionId: 's1' }))
    const t = text(html)
    for (const label of ['届きました', '指示として扱われませんでした', '届いたか確認できません', '送れませんでした', '送信中']) assert.match(t, new RegExp(label))
    assert.match(t, /セッションが見つかりません/)
    assert.equal((html.match(/aria-label="結果を閉じる"/g) ?? []).length, 4, '送信中のものは閉じられない')
  })

  it('指示を送る操作は、どの行にもある', () => {
    const state = { sessions: new Map([['s1', sess('s1')], ['s2', sess('s2', { controllable: false })]]), connected: true, ready: true, offset: 0, instructions: new Map() }
    const html = renderToStaticMarkup(h(App, { state, now: 10_000, filter: 'all' }))
    assert.equal((html.match(/class="send-toggle[^"]*"/g) ?? []).length, 2)
    assert.match(html, /send-toggle send-toggle-off/)
  })

  it('addRejected: Hub を通らなかった指示は画面だけの ID で記録される', () => {
    const records = addRejected(new Map(), { localId: 'local-1', sessionId: 's1', reason: 'x', preview: 'p' })
    assert.equal(records.get('local-1').status, 'failed')
  })
})
