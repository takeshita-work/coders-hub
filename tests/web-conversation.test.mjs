// 画面側の会話の表示（機能 004）: 表示ロジック・クライアント・部品
// AC-007-1〜8, 10〜12, 14, 17
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:8766/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'getComputedStyle', 'MutationObserver']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { createElement: h } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const { render, screen, fireEvent, cleanup, waitFor, act } = await import('@testing-library/react')
const { createClient } = await import('../src/web/client.mjs')
const { applyLatest, deliveredInstructionIds, emptyConversation, formatClock, prependOlder, withConversationError } = await import('../src/web/logic.mjs')
const { ConversationMessage, Detail } = await import('../src/web/components.mjs')

afterEach(() => cleanup())

const sess = (extra = {}) => ({
  sessionId: 's1', state: 'waiting', stateSince: 1, account: 'C:\\x\\.claude-a', cwd: 'D:\\p', lastPrompt: null, channelAlive: true,
  controllable: true, pending: [], requests: [], ...extra,
})
const msg = (offset, extra = {}) => ({ id: `${offset}`, at: 1_000, role: 'user', text: `発言 ${offset}`, ...extra })
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('統合（AC-007-8, 10）', () => {
  it('最初のページは、そのまま入る。最新ページの再取得では、新着が足され、古い分は残る', () => {
    let conv = applyLatest(emptyConversation(), { messages: [msg(100), msg(200)], cursor: 100, etag: 'W/"1"' })
    assert.deepEqual(conv.messages.map((m) => m.id), ['100', '200'])
    assert.deepEqual([conv.cursor, conv.etag, conv.loaded], [100, 'W/"1"', true])
    conv = prependOlder(conv, { messages: [msg(10), msg(50)], cursor: null })
    assert.deepEqual(conv.messages.map((m) => m.id), ['10', '50', '100', '200'])
    assert.equal(conv.cursor, null)
    // 最新ページ（100 以降）を再取得: 新着 300 が足され、古い分（10・50）は残る。cursor は、さかのぼった分を保つ
    conv = applyLatest(conv, { messages: [msg(100), msg(200), msg(300)], cursor: 100, etag: 'W/"2"' })
    assert.deepEqual(conv.messages.map((m) => m.id), ['10', '50', '100', '200', '300'])
    assert.equal(conv.cursor, null)
    assert.equal(conv.etag, 'W/"2"')
  })

  it('ツールの結果が付いたなど、同じ ID のメッセージは、新しい内容に置き換わる', () => {
    let conv = applyLatest(emptyConversation(), { messages: [{ id: '5:0', role: 'tool', tool: { name: 'Bash', result: null } }], cursor: null, etag: 'a' })
    conv = applyLatest(conv, { messages: [{ id: '5:0', role: 'tool', tool: { name: 'Bash', result: 'ok' } }], cursor: null, etag: 'b' })
    assert.equal(conv.messages.length, 1)
    assert.equal(conv.messages[0].tool.result, 'ok')
  })

  it('同じレコードの中の番号つきの ID（"位置:番号"）も、順に並ぶ', () => {
    const conv = applyLatest(emptyConversation(), { messages: [{ id: '9:0' }, { id: '9:1' }], cursor: null, etag: null })
    const older = prependOlder(conv, { messages: [{ id: '3' }, { id: '9:0' }], cursor: null })
    assert.deepEqual(older.messages.map((m) => m.id), ['3', '9:0', '9:1'], '重複は足さない')
  })

  it('AC-007-17: 失敗しても、読めている会話は残る。次に成功すれば、エラーは消える', () => {
    let conv = applyLatest(emptyConversation(), { messages: [msg(1)], cursor: null, etag: 'a' })
    conv = withConversationError(conv, 'unreadable')
    assert.deepEqual([conv.messages.length, conv.error], [1, 'unreadable'])
    conv = applyLatest(conv, { messages: [msg(1)], cursor: null, etag: 'b' })
    assert.equal(conv.error, null)
  })

  it('AC-007-3: 会話に現れたダッシュボードの指示の ID が集まる', () => {
    const ids = deliveredInstructionIds([msg(1, { source: 'dashboard', instructionId: 'abc' }), msg(2), msg(3, { source: 'dashboard', instructionId: null })])
    assert.deepEqual([...ids], ['abc'])
  })

  it('時刻は 時:分', () => {
    assert.match(formatClock(new Date(2026, 9, 11, 9, 5).getTime()), /^09:05$/)
    assert.equal(formatClock(undefined), '')
  })
})

describe('クライアント（AC-007-11, 14）', () => {
  const setup = (respond) => {
    const calls = []
    const client = createClient({
      url: 'ws://hub/ws', onChange() {}, WebSocketImpl: class { close() {} }, setTimer: () => 0, clearTimer() {},
      fetchImpl: async (url, init) => { calls.push({ url, init }); return respond(url, init) },
    })
    return { client, calls }
  }
  const json = (status, body, headers = {}) => ({ ok: status < 300, status, json: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } })

  it('独自ヘッダーつきの GET。ETag は If-None-Match で送る。ブラウザにキャッシュさせない', async () => {
    const { client, calls } = setup(() => json(200, { messages: [{ id: '1' }], cursor: 12 }, { etag: 'W/"9"' }))
    const result = await client.fetchConversation('s 1', { etag: 'W/"8"' })
    assert.deepEqual([result.status, result.cursor, result.etag, result.messages.length], ['ok', 12, 'W/"9"', 1])
    assert.equal(calls[0].url, '/api/sessions/s%201/conversation?limit=20')
    assert.equal(calls[0].init.method, 'GET')
    assert.equal(calls[0].init.cache, 'no-store')
    assert.equal(calls[0].init.headers['X-Coders-Hub'], '1')
    assert.equal(calls[0].init.headers['If-None-Match'], 'W/"8"')
  })

  it('304 は notModified。before のときは If-None-Match を送らない', async () => {
    const { client, calls } = setup(() => ({ ok: false, status: 304 }))
    assert.deepEqual(await client.fetchConversation('s1', { etag: 'x' }), { status: 'notModified' })
    await client.fetchConversation('s1', { before: 500, etag: 'x' })
    assert.equal(calls[1].url, '/api/sessions/s1/conversation?limit=20&before=500')
    assert.equal(calls[1].init.headers['If-None-Match'], undefined)
  })

  it('エラーは code で返す（Hub のエラー・接続できない）', async () => {
    assert.deepEqual(await setup(() => json(404, { error: 'no-transcript' })).client.fetchConversation('s1'), { status: 'error', code: 'no-transcript' })
    assert.deepEqual(await setup(() => { throw new Error('refused') }).client.fetchConversation('s1'), { status: 'error', code: 'network' })
  })

  it('AC-007-14: ブラウザに保存しない（localStorage・sessionStorage を使わない）', async () => {
    const used = []
    const handler = { get: (_, k) => { used.push(k); return undefined } }
    Object.defineProperty(globalThis, 'localStorage', { value: new Proxy({}, handler), configurable: true })
    const { client } = setup(() => json(200, { messages: [msg(1)], cursor: null }))
    await client.fetchConversation('s1')
    assert.deepEqual(used, [])
    delete globalThis.localStorage
  })
})

describe('メッセージの表示（AC-007-2〜7）', () => {
  const html = (message, props = {}) => renderToStaticMarkup(h(ConversationMessage, { message, ...props }))

  it('AC-007-2: 利用者の発言は user、Claude の応答は通常の吹き出し。時刻が付く', () => {
    const user = html(msg(1, { at: new Date(2026, 9, 11, 14, 30).getTime() }))
    assert.match(user, /class="msg user"/)
    assert.match(text(user), /あなた 14:30 発言 1/)
    assert.match(html({ id: '2', role: 'assistant', text: '応答', at: 1 }), /class="msg md-msg"[^>]*data-conversation="assistant"/)
  })

  it('AC-007-3: ダッシュボードから送った指示には、目印が付く', () => {
    assert.match(text(html(msg(1, { source: 'dashboard', instructionId: 'abc' }))), /あなた ダッシュボードから/)
  })

  it('AC-007-4: ツールの使用は 1 行（名前と結果）。結果がなければ、末尾のものだけ「実行中」', () => {
    const tool = (result) => ({ id: '1:0', role: 'tool', at: 1, tool: { name: 'Bash', result } })
    assert.match(text(html(tool('ok'))), /Bash 成功/)
    assert.match(text(html(tool('rejected'))), /Bash 拒否/)
    assert.match(text(html(tool('error'))), /Bash エラー/)
    assert.match(text(html(tool(null), { running: true })), /Bash 実行中/)
    assert.match(text(html(tool(null), { running: false })), /Bash 結果なし/)
  })

  it('AC-007-5: AskUserQuestion は、質問文と答えが出る', () => {
    const out = html({ id: '1:0', role: 'question', at: 1, tool: { name: 'AskUserQuestion', result: 'ok' }, answers: [{ question: '好きな色は？', answer: '赤' }, { question: '果物は？', answer: null }] })
    assert.match(text(out), /質問.*好きな色は？ 赤 果物は？/)
  })

  it('AC-007-6: Claude の応答は Markdown として整形され、文章の中の HTML は、解釈されず文字として出る', () => {
    const out = html({ id: '1', role: 'assistant', at: 1, text: '<img src=x onerror=alert(1)> **太字**' })
    assert.doesNotMatch(out, /<img/)
    assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.match(out, /<strong>太字<\/strong>/)
  })

  it('AC-007-6: 利用者の発言は、書いたとおりの文字で出る（Markdown にしない）', () => {
    const out = html(msg(1, { text: '**そのまま** と <b>タグ</b>' }))
    assert.doesNotMatch(out, /<strong>|<b>/)
    assert.match(out, /\*\*そのまま\*\* と &lt;b&gt;タグ&lt;\/b&gt;/)
  })

  it('AC-007-7: 省略された発言には、省略の表示が付く', () => {
    assert.match(text(html(msg(1, { truncated: true }))), /…（以下省略）/)
  })
})

describe('詳細での表示と更新（AC-007-1, 3, 8, 10〜12, 17）', () => {
  const detail = (props = {}) => h(Detail, { session: sess(), now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, ...props })
  const pageFetcher = (pages) => {
    const calls = []
    const fn = async (sessionId, options) => { calls.push(options); return pages.shift() ?? { status: 'notModified' } }
    return { calls, fn }
  }
  const ok = (messages, cursor = null, etag = 'W/"1"') => ({ status: 'ok', messages, cursor, etag })

  it('AC-007-1: 開くと、会話が時系列で出る', async () => {
    const { fn } = pageFetcher([ok([msg(1), { id: '2', role: 'assistant', text: '応答です', at: 1 }])])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.match(text(container.textContent), /発言 1/), { timeout: 5000 })
    assert.match(container.textContent, /応答です/)
    assert.ok(container.querySelector('.talk').textContent.indexOf('発言 1') < container.querySelector('.talk').textContent.indexOf('応答です'))
  })

  it('AC-007-11: 2 回目の取得は ETag を渡し、変更なし（notModified）なら表示は変わらない', async () => {
    const { fn, calls } = pageFetcher([ok([msg(1)], null, 'W/"7"')])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.match(container.textContent, /発言 1/), { timeout: 5000 })
    // 2 秒ごとの取得を待たずに、続きの取得を確かめる
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    assert.equal(calls[0].etag, null)
    assert.equal(calls[1].etag, 'W/"7"')
    assert.match(container.textContent, /発言 1/)
  })

  it('AC-007-12: 取得の手段がなければ（詳細を開いていない・テスト）、読まない。会話は出ない', () => {
    const { container } = render(detail())
    assert.equal(container.querySelectorAll('[data-conversation]').length, 0)
  })

  it('AC-007-8: 内容が画面に満たないとき（スクロールできない）は、前の分が自動で読み込まれ、先頭まで読むと止まる。ボタンはない', async () => {
    const { fn, calls } = pageFetcher([ok([msg(100)], 100), ok([msg(10), msg(50)], null)])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.match(container.textContent, /発言 10(?!\d)/), { timeout: 5000 })
    assert.equal(calls[1].before, 100)
    assert.deepEqual([...container.querySelectorAll('[data-conversation="user"]')].map((e) => e.textContent.match(/発言 \d+/)[0]), ['発言 10', '発言 50', '発言 100'])
    assert.equal(screen.queryByRole('button', { name: 'さらに表示' }), null)
    await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
    assert.equal(calls.filter((c) => c.before !== undefined && c.before !== null).length, 1, '先頭まで読んだら、これ以上は読まない')
  })

  it('AC-007-3: ログに現れた指示の「届きました」の記録は、出さない。保留中は出す', async () => {
    const instructions = new Map([
      ['abc', { id: 'abc', sessionId: 's1', status: 'confirmed', preview: '重複する指示', at: 1 }],
      ['zzz', { id: 'zzz', sessionId: 's1', status: 'failed', preview: '送れなかった指示', at: 2 }],
    ])
    const { fn } = pageFetcher([ok([msg(1, { source: 'dashboard', instructionId: 'abc', text: '重複する指示' })])])
    const { container } = render(detail({ fetchConversation: fn, instructions, session: sess({ pending: [{ id: 'p1', createdAt: 1, preview: 'あとで' }] }) }))
    await waitFor(() => assert.match(container.textContent, /ダッシュボードから/), { timeout: 5000 })
    assert.equal(container.querySelectorAll('[data-instruction-status="confirmed"]').length, 0)
    assert.equal(container.querySelectorAll('[data-instruction-status="failed"]').length, 1)
    assert.equal(container.querySelectorAll('[data-instruction-status="held"]').length, 1)
  })

  it('AC-007-17: 読み込めないときは「会話を読み込めません」。ほかの表示（入力欄・状態）は出たまま', async () => {
    const { fn } = pageFetcher([{ status: 'error', code: 'unreadable' }])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.ok(container.querySelector('[data-conversation-note="error"]')), { timeout: 5000 })
    assert.match(container.textContent, /会話を読み込めません/)
    assert.ok(container.querySelector('textarea'))
    assert.ok(container.querySelector('.status-line'))
  })

  it('会話の記録がまだない（no-transcript）ときは、エラーではなく、記録がない旨を出す', async () => {
    const { fn } = pageFetcher([{ status: 'error', code: 'no-transcript' }])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.ok(container.querySelector('[data-conversation-note="none"]')), { timeout: 5000 })
    assert.doesNotMatch(container.textContent, /読み込めません/)
  })
})

describe('スクロール（機能 006 の AC-UI-23 を会話にも）', () => {
  const fakeScroll = (el, { scrollHeight = 2000, clientHeight = 500, scrollTop = 0 } = {}) => {
    const state = { height: scrollHeight, top: scrollTop }
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.height })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => state.top, set: (v) => { state.top = v } })
    return state
  }
  const props = (fetchConversation) => ({ session: sess(), now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, fetchConversation })

  it('上の端の近くまでスクロールすると、前の分が自動で読み込まれ、いま見ている位置が動かない（増えた高さの分だけ足す）', async () => {
    const pages = [{ status: 'ok', messages: [msg(100)], cursor: 100, etag: 'a' }, { status: 'ok', messages: [msg(10)], cursor: null }]
    const calls = []
    const { container } = render(h(Detail, props(async (id, options) => { calls.push(options); return pages.shift() ?? { status: 'notModified' } })))
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el) // 画面より長い（自動の補充は起きない）
    await screen.findByText(/発言 100/)
    assert.equal(calls.length, 1)
    sc.top = 100
    const origHeight = sc.height
    fireEvent.scroll(el) // 上の端の近く（300px 以内）
    sc.height = origHeight + 600 // 前の分が足されると、高さが 600 増える
    await waitFor(() => assert.match(container.textContent, /発言 10(?!\d)/), { timeout: 5000 })
    assert.equal(calls[1].before, 100)
    assert.equal(sc.top, 700, '100 + 増えた高さ 600')
  })

  it('上の端から離れている間は、前の分を読み込まない', async () => {
    const calls = []
    const { container } = render(h(Detail, props(async (id, options) => { calls.push(options); return { status: 'ok', messages: [msg(100)], cursor: 100, etag: 'a' } })))
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el)
    await screen.findByText(/発言 100/)
    sc.top = 1000
    fireEvent.scroll(el)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    assert.equal(calls.filter((c) => c.before !== undefined && c.before !== null).length, 0)
  })

  it('会話の新着は、上を読んでいるときは動かさず、一番下の近くにいるときは一番下へ', async () => {
    const pages = [
      { status: 'ok', messages: [msg(1)], cursor: null, etag: 'a' },
      { status: 'ok', messages: [msg(1), msg(2)], cursor: null, etag: 'b' },
      { status: 'ok', messages: [msg(1), msg(2), msg(3)], cursor: null, etag: 'c' },
    ]
    const { container } = render(h(Detail, props(async () => pages.shift() ?? { status: 'notModified' })))
    await waitFor(() => assert.match(container.textContent, /発言 1/), { timeout: 5000 })
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el)
    sc.top = 100
    fireEvent.scroll(el) // 上を読んでいる（一番下から離れている）
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    await waitFor(() => assert.match(container.textContent, /発言 2/), { timeout: 5000 })
    assert.equal(sc.top, 100, '上を読んでいるときは動かさない')
    sc.top = 1500
    fireEvent.scroll(el) // 一番下の近く
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    await waitFor(() => assert.match(container.textContent, /発言 3/), { timeout: 5000 })
    assert.equal(sc.top, 2000, '一番下の近くにいるときは、一番下へ')
  })

  it('末尾のメッセージの中身が更新された（ID は同じ・ツールの結果が付くなど）ときも、新着と同じに扱う', async () => {
    const pages = [
      { status: 'ok', messages: [msg(1, { text: '実行中' })], cursor: null, etag: 'a' },
      { status: 'ok', messages: [msg(1, { text: '完了' })], cursor: null, etag: 'b' }, // id は同じ「1」のまま、中身と etag だけ変わる
    ]
    const { container } = render(h(Detail, props(async () => pages.shift() ?? { status: 'notModified' })))
    await waitFor(() => assert.match(container.textContent, /実行中/), { timeout: 5000 })
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el)
    sc.top = 1500 // 一番下の近く
    fireEvent.scroll(el)
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    await waitFor(() => assert.match(container.textContent, /完了/), { timeout: 5000 })
    assert.equal(sc.top, 2000, '末尾のメッセージの中身が変わっただけでも、一番下へ')
  })
})

describe('セッションごとのスクロール位置（AC-UI-37）', () => {
  const fakeScroll = (el, { scrollHeight = 2000, clientHeight = 500, scrollTop = 0 } = {}) => {
    const state = { height: scrollHeight, top: scrollTop }
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.height })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => state.top, set: (v) => { state.top = v } })
    return state
  }
  const detail = (sessionId, scrollPositions) => h(Detail, {
    key: sessionId, session: sess({ sessionId }), now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, scrollPositions,
    fetchConversation: async () => ({ status: 'ok', messages: [msg(1)], cursor: null, etag: 'a' }),
  })

  it('初めて開くセッションは一番下。別セッションへ移って戻ると、覚えておいた位置に戻り、一番下でなければ「一番下へ」が出る', async () => {
    const positions = new Map()
    const { container, rerender } = render(detail('s1', positions))
    const el1 = container.querySelector('.detail')
    const sc1 = fakeScroll(el1)
    await screen.findByText(/発言 1/)
    assert.equal(sc1.top, 2000, '初めては一番下')

    sc1.top = 300 // s1 を読んでいる途中
    fireEvent.scroll(el1)
    assert.equal(positions.get('s1'), 1200, '覚えるのは、一番下からの距離（2000 - 300 - 500）')

    rerender(detail('s2', positions)) // 別のセッションへ
    const el2 = container.querySelector('.detail')
    const sc2 = fakeScroll(el2)
    await screen.findByText(/発言 1/)
    assert.equal(sc2.top, 2000, '初めて開く s2 は一番下')
    assert.equal(container.querySelector('.to-bottom').hidden, true)

    rerender(detail('s1', positions)) // s1 に戻る
    const el1b = container.querySelector('.detail')
    const sc1b = fakeScroll(el1b)
    await screen.findByText(/発言 1/)
    assert.equal(sc1b.top, 300, '覚えておいた位置に戻る')
    assert.equal(container.querySelector('.to-bottom').hidden, false, '一番下でないので「一番下へ」が出る')
  })

  it('覚えているのは「一番下からの距離」。最初のページだけ読み込んだ時点の高さが違っても、正しく戻る（ページ分けの影響を受けない）', async () => {
    const positions = new Map()
    positions.set('s1', 900) // 前回、一番下から 900px 離れた位置にいた
    const { container } = render(h(Detail, {
      key: 's1', session: sess({ sessionId: 's1' }), now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {},
      scrollPositions: positions,
      fetchConversation: async () => ({ status: 'ok', messages: [msg(1)], cursor: null, etag: 'a' }), // これ以上、前の会話はない
    }))
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el, { scrollHeight: 1000, clientHeight: 200 }) // 読み込めているのは、800px 分だけ（900px には届かない）
    await screen.findByText(/発言 1/)
    assert.equal(sc.top, 0, '900px には届かないので、読める分だけ戻る（一番上。マイナスにはしない）')
    assert.equal(container.querySelector('.to-bottom').hidden, false, '一番下ではないので「一番下へ」が出る')
  })
})

// ---- ツールの行・グループ・時刻順の並び（AC-007-4, 22, 23, 25。ADR 0029）----
const { ToolGroup, ToolRow } = await import('../src/web/components.mjs')
const { groupTools, mergeTimeline, runningToolIds, summarizeToolGroup, toolHasMore, toolStatus } = await import('../src/web/logic.mjs')

const toolMsg = (id, name, extra = {}, result = 'ok', at = 1_000) => ({ id, role: 'tool', at, tool: { name, result, ...extra } })

describe('ツールの行（AC-007-4）', () => {
  const tool = (extra = {}, result = 'ok') => toolMsg('1:0', 'Bash', { summary: 'npm test', detail: 'npm test\n# 説明', ...extra }, result, new Date(2026, 9, 12, 0, 20).getTime())
  const out = (message, props = {}) => renderToStaticMarkup(h(ConversationMessage, { message, ...props }))

  it('閉じた 1 行: ツール名・要点・結果・時刻。全文が要点と違うときは、開閉できる（全文だけを出す）', () => {
    const html = out(tool())
    assert.match(html, /<details class="tool-line tool-ok" data-conversation="tool">/)
    assert.match(text(html), /Bash npm test 成功 00:20/)
    assert.match(html, /<div class="tool-detail"><pre class="pre">npm test\n# 説明<\/pre><\/div>/)
  })

  it('全文が要点と同じ行・要点がない行は、開閉しない（矢印も出ない）', () => {
    for (const message of [tool({ detail: 'npm test' }), toolMsg('2:0', 'Write', {})]) {
      const html = out(message)
      assert.doesNotMatch(html, /<details|<summary/)
      assert.match(html, /<div class="tl-row">/)
    }
    assert.match(text(out(toolMsg('2:0', 'Write', {}))), /Write 成功/)
  })

  it('結果: 成功・拒否・エラー・実行中（末尾）・結果なし（末尾以外）。クラスにも出る', () => {
    assert.match(out(tool({}, 'rejected')), /class="tool-line tool-rejected"/)
    assert.match(text(out(tool({}, 'rejected'))), /拒否/)
    assert.match(text(out(tool({}, 'error'))), /エラー/)
    assert.match(out(tool({}, null), { running: true }), /tool-running/)
    assert.match(text(out(tool({}, null), { running: true })), /実行中/)
    assert.match(text(out(tool({}, null), { running: false })), /結果なし/)
  })

  it('コマンド・パスは、文字として出す（HTML を解釈しない）。切れているときは、省略の表示が付く', () => {
    const html = out(tool({ summary: '<img src=x onerror=alert(1)>', detail: '<img src=x onerror=alert(1)>\n続き', truncated: true }))
    assert.doesNotMatch(html, /<img/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.match(text(html), /…（以下省略）/)
  })

  it('出力（結果の中身）は、メッセージにないので、表示にも出ない', () => {
    assert.doesNotMatch(out(tool()), /SECRET/)
    assert.equal(toolHasMore(tool({ detail: 'x', summary: 'x' })), false)
    assert.equal(toolHasMore(tool({ detail: 'x\ny', summary: 'x' })), true)
    assert.equal(toolStatus(tool({}, null), true), 'running')
    assert.equal(toolStatus(tool({}, null), false), 'none')
  })
})

describe('ツールのグループ（AC-007-22）', () => {
  const t = (id, name, result = 'ok', at = 1_000, extra = {}) => toolMsg(id, name, { summary: `${name} の要点`, detail: `${name} の全文`, ...extra }, result, at)
  const hm = (h2, m) => new Date(2026, 9, 12, h2, m).getTime()
  const group = [t('1', 'Bash', 'error', hm(0, 20)), t('2', 'Read', 'ok', hm(0, 21)), t('3', 'Edit', 'ok', hm(0, 21)), t('4', 'Bash', 'ok', hm(0, 22))]

  it('集計: 件数・ツール名（回数）・結果の内訳・時刻の範囲', () => {
    const info = summarizeToolGroup(group)
    assert.equal(info.count, 4)
    assert.deepEqual(info.names, [{ name: 'Bash', count: 2 }, { name: 'Read', count: 1 }, { name: 'Edit', count: 1 }])
    assert.deepEqual(info.tally, { ok: 3, error: 1, rejected: 0, running: 0 })
    assert.deepEqual([info.from, info.to], [hm(0, 20), hm(0, 22)])
    assert.equal(summarizeToolGroup([t('1', 'Bash', null)], new Set(['1'])).tally.running, 1)
  })

  it('閉じた 1 行に、件数・ツール名・内訳・時刻の範囲が出る。開くと、個別の行が並ぶ（各行も開閉できる）', () => {
    const html = renderToStaticMarkup(h(ToolGroup, { group: { id: 'g-1', messages: group }, running: new Set() }))
    assert.match(html, /<details class="tool-group" data-conversation="tool-group">/)
    const summary = text(html.slice(html.indexOf('<summary>'), html.indexOf('</summary>')))
    assert.match(summary, /ツール 4 件 Bash ×2 · Read · Edit 成功 3 エラー 1 00:20〜00:22/)
    assert.equal((html.match(/data-conversation="tool"/g) ?? []).length, 4, '個別の行が 4 つ')
    assert.equal((html.match(/<details class="tool-line/g) ?? []).length, 4, '各行は、全文があるので、開閉できる')
    assert.match(html, /tg-sum warn">エラー 1/)
  })

  it('同じ時刻の範囲は、1 つだけ出す。実行中・拒否も内訳に出る', () => {
    const rows = [t('1', 'Bash', 'rejected', hm(1, 5)), t('2', 'Bash', null, hm(1, 5))]
    const html = renderToStaticMarkup(h(ToolGroup, { group: { id: 'g-1', messages: rows }, running: new Set(['2']) }))
    const summary = text(html.slice(html.indexOf('<summary>'), html.indexOf('</summary>')))
    assert.match(summary, /ツール 2 件 Bash ×2 拒否 1 実行中 1 01:05\s*$/)
  })

  it('連続した 2 件以上だけを、グループにする。1 件・間に発言や質問や結果の行が入るときは、まとめない', () => {
    const m = (id) => ({ type: 'message', message: t(id, 'Bash') })
    const say = (id) => ({ type: 'message', message: { id, role: 'assistant', text: 'x', at: 1 } })
    const ask = { type: 'message', message: { id: 'q', role: 'question', tool: { name: 'AskUserQuestion', result: null }, answers: [] } }
    const ev = { type: 'event', node: 'x', at: 1 }
    const kinds = (items) => groupTools(items).map((i) => (i.type === 'toolgroup' ? `group(${i.messages.map((x) => x.id).join(',')})` : i.type === 'event' ? 'event' : i.message.id))
    assert.deepEqual(kinds([m('1'), m('2'), m('3')]), ['group(1,2,3)'])
    assert.deepEqual(kinds([m('1'), say('a'), m('2')]), ['1', 'a', '2'], '1 件ずつは、まとめない')
    assert.deepEqual(kinds([m('1'), m('2'), say('a'), m('3'), m('4')]), ['group(1,2)', 'a', 'group(3,4)'])
    assert.deepEqual(kinds([m('1'), m('2'), ev, m('3'), m('4')]), ['group(1,2)', 'event', 'group(3,4)'], '結果の行で、グループが分かれる')
    assert.deepEqual(kinds([m('1'), ask, m('2')]), ['1', 'q', '2'], '質問の行は、グループにしない')
    assert.equal(groupTools([m('1'), m('2')])[0].id, 'g-1', 'グループの id は、最初の行の id から（追加されても変わらない）')
  })

  it('末尾のツールの行（あとに発言や応答がない）だけが、実行中', () => {
    const ids = runningToolIds([{ id: 'a', role: 'assistant', text: 'x' }, t('1', 'Bash', null), t('2', 'Bash', 'ok'), t('3', 'Bash', null)])
    assert.deepEqual([...ids].sort(), ['1', '3'])
    assert.deepEqual([...runningToolIds([t('1', 'Bash', null), { id: 'a', role: 'assistant', text: 'x' }])], [], '発言が続いていれば、結果なし')
  })
})

describe('会話の時刻順（AC-007-25）', () => {
  const m = (id, at, role = 'assistant') => ({ id, at, role, text: id })
  const ev = (key, at) => ({ key, at, node: key })
  const order = (items) => items.map((i) => (i.type === 'message' ? i.message.id : i.key))

  it('できごと（結果の行・送った指示）が、起きた時刻に合った位置に入る。同じ時刻なら、メッセージのあと', () => {
    const out = mergeTimeline([m('a', 100), m('b', 300), m('c', 500)], [ev('r1', 200), ev('r2', 300), ev('r3', 900)])
    assert.deepEqual(order(out), ['a', 'r1', 'b', 'r2', 'c', 'r3'])
  })

  it('時刻のないできごとは、一番最後。時刻のないメッセージは、そのままの位置（できごとは、そのあとの、時刻つきのメッセージの前に入る）', () => {
    assert.deepEqual(order(mergeTimeline([m('a', 100), m('x', null), m('b', 300)], [ev('e', undefined), ev('f', 200)])), ['a', 'x', 'f', 'b', 'e'], '時刻のないメッセージは、その位置のまま。できごとは、次の時刻つきのメッセージの前')
  })

  it('前の会話が、まだ読み込まれていないとき: 最初のメッセージより前のできごとは、出さない（読み込むと、位置に入る）', () => {
    const items = [m('a', 100), m('b', 300)]
    assert.deepEqual(order(mergeTimeline(items, [ev('old', 50), ev('r', 200)], { hasMoreBefore: true })), ['a', 'r', 'b'])
    assert.deepEqual(order(mergeTimeline(items, [ev('old', 50), ev('r', 200)], { hasMoreBefore: false })), ['old', 'a', 'r', 'b'])
  })

  it('会話がまだないときは、できごとだけが、時刻順に並ぶ', () => {
    assert.deepEqual(order(mergeTimeline([], [ev('b', 2), ev('a', 1)], { hasMoreBefore: true })), ['a', 'b'])
  })
})

describe('詳細での、ツールの行と結果の行（AC-007-4, 22, 23, 25）', () => {
  const detail = (props = {}) => h(Detail, { session: sess(), now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, ...props })
  const ok = (messages, cursor = null) => ({ status: 'ok', messages, cursor, etag: 'W/"1"' })
  const fetcher = (messages, cursor = null) => async () => ok(messages, cursor)
  const records = (...list) => new Map(list.map((r) => [r.id, { sessionId: 's1', ...r }]))
  const messages = [
    { id: '1', at: 1_000, role: 'user', text: '依頼' },
    { id: '2:0', at: 3_000, role: 'tool', tool: { name: 'Edit', result: 'ok', summary: 'a.mjs', detail: 'D:\\p\\a.mjs' } },
    { id: '4:0', at: 5_000, role: 'assistant', text: '応答' },
  ]

  it('AC-007-25: 許可の結果の行が、会話の中の、起きた時刻の位置（許可 → 実行の順）に入る。再読み込みで消えるので、記録は画面のメモリだけ', async () => {
    const requestRecords = records({ id: 'r1', status: 'allowed', kind: 'permission', summary: 'Edit — a.mjs', at: 2_000 }, { id: 'r2', status: 'allowed', kind: 'permission', summary: '最新', at: 9_000 })
    const { container } = render(detail({ fetchConversation: fetcher(messages), requestRecords }))
    await waitFor(() => assert.match(container.textContent, /応答/), { timeout: 5000 })
    const talk = container.querySelector('.talk').textContent
    const at = (s) => talk.indexOf(s)
    assert.ok(at('依頼') < at('Edit — a.mjs') && at('Edit — a.mjs') < at('a.mjs成功') && at('応答') < at('最新'), `順番: ${talk}`)
  })

  it('AC-007-25: 前の会話が、まだ読み込まれていないときは、最初のメッセージより前の結果の行は、出さない', async () => {
    const requestRecords = records({ id: 'old', status: 'allowed', kind: 'permission', summary: '古い結果', at: 10 })
    const { container } = render(detail({ fetchConversation: fetcher(messages, 100), requestRecords }))
    await waitFor(() => assert.match(container.textContent, /応答/), { timeout: 5000 })
    assert.doesNotMatch(container.textContent, /古い結果/)
  })

  it('AC-007-22: 連続したツールが、詳細の中で、グループになる。間に結果の行が入ると、分かれる', async () => {
    const tools = [1, 2, 3].map((n) => ({ id: `t${n}`, at: 1_000 * n, role: 'tool', tool: { name: 'Bash', result: 'ok', summary: `cmd ${n}`, detail: `cmd ${n}` } }))
    const { container } = render(detail({ fetchConversation: fetcher(tools) }))
    await waitFor(() => assert.equal(container.querySelectorAll('.tool-group').length, 1), { timeout: 5000 })
    assert.equal(container.querySelectorAll('.tool-group .tool-line').length, 3)
    cleanup()
    const requestRecords = records({ id: 'r', status: 'allowed', kind: 'permission', summary: '結果', at: 1_500 })
    const split = render(detail({ fetchConversation: fetcher(tools), requestRecords }))
    await waitFor(() => assert.match(split.container.textContent, /結果/), { timeout: 5000 })
    assert.equal(split.container.querySelectorAll('.tool-group').length, 1, 't2・t3 だけがグループ（t1 は 1 件なので、まとめない）')
    assert.equal(split.container.querySelectorAll('.talk > .tool-line').length, 1)
  })

  it('AC-007-23: 開いた行・グループは、画面が更新されても、開いたまま', async () => {
    const tools = [1, 2].map((n) => ({ id: `t${n}`, at: 1_000 * n, role: 'tool', tool: { name: 'Read', result: 'ok', summary: `f${n}`, detail: `D:\\p\\f${n}` } }))
    const { container, rerender } = render(detail({ fetchConversation: fetcher(tools) }))
    await waitFor(() => assert.equal(container.querySelectorAll('.tool-group').length, 1), { timeout: 5000 })
    const groupEl = container.querySelector('details.tool-group')
    groupEl.open = true
    const row = groupEl.querySelector('details.tool-line')
    row.open = true
    const requestRecords = records({ id: 'late', status: 'allowed', kind: 'permission', summary: '新しい結果', at: 9_000 })
    rerender(detail({ fetchConversation: fetcher(tools), requestRecords, now: 20_000 }))
    await waitFor(() => assert.match(container.textContent, /新しい結果/))
    assert.equal(container.querySelector('details.tool-group'), groupEl, '同じ要素のまま')
    assert.equal(groupEl.open, true)
    assert.equal(groupEl.querySelector('details.tool-line').open, true)
  })
})
