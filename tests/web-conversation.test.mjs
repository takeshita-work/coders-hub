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
    await waitFor(() => assert.match(text(container.textContent), /発言 1/))
    assert.match(container.textContent, /応答です/)
    assert.ok(container.querySelector('.talk').textContent.indexOf('発言 1') < container.querySelector('.talk').textContent.indexOf('応答です'))
  })

  it('AC-007-11: 2 回目の取得は ETag を渡し、変更なし（notModified）なら表示は変わらない', async () => {
    const { fn, calls } = pageFetcher([ok([msg(1)], null, 'W/"7"')])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.match(container.textContent, /発言 1/))
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
    await waitFor(() => assert.match(container.textContent, /発言 10/))
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
    await waitFor(() => assert.match(container.textContent, /ダッシュボードから/))
    assert.equal(container.querySelectorAll('[data-instruction-status="confirmed"]').length, 0)
    assert.equal(container.querySelectorAll('[data-instruction-status="failed"]').length, 1)
    assert.equal(container.querySelectorAll('[data-instruction-status="held"]').length, 1)
  })

  it('AC-007-17: 読み込めないときは「会話を読み込めません」。ほかの表示（入力欄・状態）は出たまま', async () => {
    const { fn } = pageFetcher([{ status: 'error', code: 'unreadable' }])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.ok(container.querySelector('[data-conversation-note="error"]')))
    assert.match(container.textContent, /会話を読み込めません/)
    assert.ok(container.querySelector('textarea'))
    assert.ok(container.querySelector('.status-line'))
  })

  it('会話の記録がまだない（no-transcript）ときは、エラーではなく、記録がない旨を出す', async () => {
    const { fn } = pageFetcher([{ status: 'error', code: 'no-transcript' }])
    const { container } = render(detail({ fetchConversation: fn }))
    await waitFor(() => assert.ok(container.querySelector('[data-conversation-note="none"]')))
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
    await waitFor(() => assert.match(container.textContent, /発言 10/))
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
    await waitFor(() => assert.match(container.textContent, /発言 1/))
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el)
    sc.top = 100
    fireEvent.scroll(el) // 上を読んでいる（一番下から離れている）
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    await waitFor(() => assert.match(container.textContent, /発言 2/))
    assert.equal(sc.top, 100, '上を読んでいるときは動かさない')
    sc.top = 1500
    fireEvent.scroll(el) // 一番下の近く
    await act(async () => { await new Promise((r) => setTimeout(r, 2100)) })
    await waitFor(() => assert.match(container.textContent, /発言 3/))
    assert.equal(sc.top, 2000, '一番下の近くにいるときは、一番下へ')
  })
})
