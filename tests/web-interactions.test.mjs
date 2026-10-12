// 画面の部品の操作（jsdom）。ボタンの押下・選択・入力が、応答の送信・折りたたみなどにつながることを確認する。
// 静的な描画では動かせない onClick／onChange を確かめる（機能 002・003）
// AC-004-1, 004-2, 004-3, 004-7〜004-10, 005-5, 005-6, 002-1, 003-3、機能 006 の AC-UI-5, 6, 9, 17, 22〜26
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
const { render, screen, fireEvent, cleanup, waitFor, within } = await import('@testing-library/react')
const { App, Composer, Detail, PendingMessage, PermissionCard, QuestionCard, RequestInput, ResultLine, SentMessage, SessionRow, defaultUi } = await import('../src/web/components.mjs')

afterEach(() => cleanup())

const permissionRequest = (extra = {}) => ({
  id: 'abcde', kind: 'permission', createdAt: 1, toolName: 'Bash', description: 'List files', inputPreview: '{ "command": "ls" }', ...extra,
})
const colorQuestion = {
  question: '好きな色は？', header: '色', multiSelect: false,
  options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
}
const fruitQuestion = {
  question: '好きな果物は？', header: '果物', multiSelect: true,
  options: [{ label: 'りんご', description: '' }, { label: 'みかん', description: '' }],
}
const questionRequest = (questions = [colorQuestion]) => ({ id: 'q1', kind: 'question', createdAt: 1, questions })
const sess = (id, extra = {}) => ({
  sessionId: id, state: 'permission', stateSince: 1, account: 'C:\\x\\.claude-a', cwd: 'D:\\p', lastPrompt: null, channelAlive: true,
  controllable: true, pending: [], requests: [], ...extra,
})

// onRespond の呼び出しを記録する。results は呼び出しごとの戻り値（なければ { ok: true }）
const recorder = (results = []) => {
  const calls = []
  const fn = async (...args) => { calls.push(args); return results[calls.length - 1] ?? { ok: true } }
  return { calls, fn }
}

describe('許可要求の操作（AC-004-2, 004-3）', () => {
  it('「許可」を押すと、要求 ID と allow で応答が送られる', async () => {
    const { calls, fn } = recorder()
    render(h(PermissionCard, { sessionId: 's1', request: permissionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'abcde', { behavior: 'allow' }])
  })

  it('「拒否」を押すと deny で応答が送られる', async () => {
    const { calls, fn } = recorder()
    render(h(PermissionCard, { sessionId: 's1', request: permissionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByRole('button', { name: '拒否' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0][2], { behavior: 'deny' })
  })

  it('送っている間は二重に押せない', async () => {
    let release
    const calls = []
    const fn = (...args) => { calls.push(args); return new Promise((resolve) => { release = () => resolve({ ok: true }) }) }
    render(h(PermissionCard, { sessionId: 's1', request: permissionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    await waitFor(() => assert.equal(screen.getByRole('button', { name: '拒否' }).disabled, true))
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    assert.equal(calls.length, 1)
    release()
    await waitFor(() => assert.equal(screen.getByRole('button', { name: '拒否' }).disabled, false))
  })

  it('応答に失敗したら、理由をその場に出す。押し直せる', async () => {
    const { fn } = recorder([{ ok: false, reason: 'すでに閉じています' }])
    render(h(PermissionCard, { sessionId: 's1', request: permissionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'すでに閉じています'))
    assert.equal(screen.getByRole('button', { name: '許可' }).disabled, false)
  })
})

describe('長い入力の折りたたみ（AC-004-1）', () => {
  it('「すべて表示」で開き、「折りたたむ」で戻る', () => {
    const preview = 'x'.repeat(1000)
    const { container } = render(h(RequestInput, { preview }))
    const pre = () => container.querySelector('pre')
    assert.equal(pre().dataset.collapsed, 'true')
    assert.ok(pre().textContent.length < 1000)
    fireEvent.click(screen.getByRole('button', { name: 'すべて表示' }))
    assert.equal(pre().dataset.collapsed, 'false')
    assert.equal(pre().textContent, preview)
    fireEvent.click(screen.getByRole('button', { name: '折りたたむ' }))
    assert.equal(pre().dataset.collapsed, 'true')
  })
})

describe('質問への回答の操作（AC-004-7〜004-10）', () => {
  const submitButton = () => screen.getByRole('button', { name: '回答する' })

  it('未回答の間は送れず、選ぶと送れる。送ると、質問文 → 選んだラベルで応答する', async () => {
    const { calls, fn } = recorder()
    render(h(QuestionCard, { sessionId: 's1', request: questionRequest(), onRespond: fn }))
    assert.equal(submitButton().disabled, true)
    fireEvent.click(screen.getByLabelText(/青/))
    assert.equal(submitButton().disabled, false)
    fireEvent.click(submitButton())
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'q1', { answers: { '好きな色は？': '青' } }])
  })

  it('単一選択は選び直せる。自由入力をすると選択が外れ、自由入力が答えになる', async () => {
    const { calls, fn } = recorder()
    render(h(QuestionCard, { sessionId: 's1', request: questionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByLabelText(/赤/))
    fireEvent.click(screen.getByLabelText(/青/))
    assert.equal(screen.getByLabelText(/赤/).checked, false)
    fireEvent.change(screen.getByLabelText('色の自由入力'), { target: { value: '紫' } })
    assert.equal(screen.getByLabelText(/青/).checked, false)
    fireEvent.click(submitButton())
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0][2], { answers: { '好きな色は？': '紫' } })
  })

  it('複数の質問・複数選択・自由入力をまとめて答える。複数選択は配列で送る', async () => {
    const { calls, fn } = recorder()
    render(h(QuestionCard, { sessionId: 's1', request: questionRequest([colorQuestion, fruitQuestion]), onRespond: fn }))
    fireEvent.click(screen.getByLabelText(/赤/))
    assert.equal(submitButton().disabled, true, '2 問目が未回答')
    fireEvent.click(screen.getByLabelText(/りんご/))
    fireEvent.click(screen.getByLabelText(/みかん/))
    fireEvent.click(screen.getByLabelText(/りんご/)) // 外す
    fireEvent.change(screen.getByLabelText('果物の自由入力'), { target: { value: 'バナナ' } })
    fireEvent.click(submitButton())
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0][2], { answers: { '好きな色は？': '赤', '好きな果物は？': ['みかん', 'バナナ'] } })
  })

  it('答えが長すぎると送れず、理由が出る', () => {
    render(h(QuestionCard, { sessionId: 's1', request: questionRequest(), onRespond: async () => ({ ok: true }) }))
    fireEvent.change(screen.getByLabelText('色の自由入力'), { target: { value: 'あ'.repeat(2001) } })
    assert.equal(submitButton().disabled, true)
    assert.match(screen.getByText(/2000 文字まで/).textContent, /2001/)
  })

  it('応答に失敗したら、理由をその場に出す', async () => {
    const { fn } = recorder([{ ok: false, reason: 'Hub に接続できません' }])
    render(h(QuestionCard, { sessionId: 's1', request: questionRequest(), onRespond: fn }))
    fireEvent.click(screen.getByLabelText(/青/))
    fireEvent.click(submitButton())
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Hub に接続できません'))
  })
})


describe('結果の表示の操作（AC-005-5, 005-6）', () => {
  it('結果の「×」を押すと、その要求の ID で閉じる操作が呼ばれる', () => {
    const dismissed = []
    const record = { id: 'a', sessionId: 's1', status: 'terminal', summary: 'Bash: List files' }
    render(h(ResultLine, { record, onDismiss: (id) => dismissed.push(id) }))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(dismissed, ['a'])
  })
})

describe('サイドバーの操作（AC-UI-4〜6, 9, 17, 18）', () => {
  const state = (sessions, extra = {}) => ({
    sessions: new Map(sessions.map((s) => [s.sessionId, s])), connected: true, ready: true, offset: 0,
    instructions: new Map(), requestRecords: new Map(), requestSummaries: new Map(), requestKinds: new Map(), ...extra,
  })
  const app = (st, props = {}) => h(App, { state: st, now: 10_000, ui: defaultUi(), ...props })

  it('AC-UI-17: 短い許可要求の行の「許可」から、セッション ID と要求 ID で応答が送られる。拒否ボタンはない', async () => {
    const { calls, fn } = recorder()
    render(app(state([sess('s1', { requests: [permissionRequest()] })]), { onRespond: fn }))
    assert.equal(screen.queryByRole('button', { name: '拒否' }), null)
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'abcde', { behavior: 'allow' }])
  })

  it('AC-UI-18: 長い入力の要求・質問の行には「許可」ボタンが出ない', () => {
    render(app(state([sess('s1', { requests: [permissionRequest({ inputPreview: 'x'.repeat(300) })] }), sess('s2', { requests: [questionRequest()] })])))
    assert.equal(screen.queryByRole('button', { name: '許可' }), null)
  })

  it('行を押すと、そのセッションを選んで詳細に移る', () => {
    const patches = []
    render(app(state([sess('s1', { state: 'working' })]), { onUi: (p) => patches.push(p) }))
    fireEvent.click(document.querySelector('[data-session-id="s1"] .sess-btn'))
    assert.deepEqual(patches, [{ selected: 's1', view: 'detail' }])
  })

  it('AC-UI-5: アカウントとプロジェクトの見出しを押すと、折りたたみの切り替えが呼ばれる', () => {
    const patches = []
    render(app(state([sess('s1', { state: 'working' })]), { onUi: (p) => patches.push(p) }))
    fireEvent.click(screen.getByRole('button', { name: /claude-a/ }))
    fireEvent.click(document.querySelector('[data-node^="d:"] > .node-head'))
    assert.deepEqual(patches, [{ toggle: 'a:C:\\x\\.claude-a' }, { toggle: 'd:C:\\x\\.claude-a/D:\\p' }])
  })

  it('AC-UI-6, 9: フィルター・ソートのボタンでパネルが開き、スイッチと 2 つのソートが呼ばれる', () => {
    const patches = []
    const { rerender } = render(app(state([sess('s1', { state: 'working' })]), { onUi: (p) => patches.push(p) }))
    fireEvent.click(screen.getByRole('button', { name: 'フィルター・ソート' }))
    assert.deepEqual(patches.pop(), { opts: true })
    rerender(app(state([sess('s1', { state: 'working' })]), { ui: { ...defaultUi(), opts: true }, onUi: (p) => patches.push(p) }))
    assert.equal(screen.getByRole('switch', { name: '操作できるものだけ' }).getAttribute('aria-checked'), 'false')
    fireEvent.click(screen.getByRole('switch', { name: '操作できるものだけ' }))
    fireEvent.click(screen.getByRole('button', { name: 'プロジェクトの並び' }))
    fireEvent.click(screen.getByRole('button', { name: 'セッションの並び' }))
    assert.deepEqual(patches, [{ onlyControl: true }, { dirSort: 'desc' }, { sessSort: 'late' }])
  })

  it('AC-UI-31, AC-011-25: Hub を終了: 押すと確認が出て、「やめる」では何も呼ばれず、「終了する」で呼ばれて完了を表示する', async () => {
    let calls = 0
    const onShutdown = async () => { calls += 1; return { ok: true } }
    render(app(state([sess('s1', { state: 'working' })]), { ui: { ...defaultUi(), opts: true }, onShutdown }))
    fireEvent.click(screen.getByRole('button', { name: '終了…' }))
    assert.match(document.body.textContent, /動いているセッションは、Hub を起動し直すまで一覧から消えます/)
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    assert.equal(calls, 0)
    assert.ok(screen.getByRole('button', { name: '終了…' }), '確認が閉じる')
    fireEvent.click(screen.getByRole('button', { name: '終了…' }))
    fireEvent.click(screen.getByRole('button', { name: '終了する' }))
    await waitFor(() => assert.match(document.body.textContent, /Hub を終了しました/))
    assert.equal(calls, 1)
  })

  it('AC-UI-31: 終了を要求できなかったときは、理由を確認の行に出し、やり直せる', async () => {
    const onShutdown = async () => ({ ok: false, reason: 'Hub に接続できません' })
    render(app(state([sess('s1', { state: 'working' })]), { ui: { ...defaultUi(), opts: true }, onShutdown }))
    fireEvent.click(screen.getByRole('button', { name: '終了…' }))
    fireEvent.click(screen.getByRole('button', { name: '終了する' }))
    await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Hub に接続できません'))
    assert.ok(screen.getByRole('button', { name: '終了する' }), 'やり直せる')
  })

  it('AC-UI-2: 詳細の戻るボタンで一覧に戻る', () => {
    const patches = []
    render(app(state([sess('s1', { state: 'working' })]), { ui: { ...defaultUi(), selected: 's1', view: 'detail' }, onUi: (p) => patches.push(p) }))
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }))
    assert.deepEqual(patches, [{ view: 'list' }])
  })

  it('SessionRow: 選択中の行は aria-current が付く', () => {
    const { container } = render(h('ul', null, h(SessionRow, { session: sess('s1', { state: 'working' }), elapsedMs: 1000, selected: true })))
    assert.equal(container.querySelector('.sess-btn').getAttribute('aria-current'), 'true')
  })
})

describe('詳細の操作（AC-UI-20〜26）', () => {
  const detailProps = (session, extra = {}) => ({
    session, now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, ...extra,
  })

  it('要求の結果が会話に出て、閉じる操作が呼ばれる', () => {
    const dismissed = []
    const requestRecords = new Map([['a', { id: 'a', sessionId: 's1', status: 'timeout', summary: '質問: 色', at: 1 }]])
    render(h(Detail, detailProps(sess('s1', { state: 'working' }), { requestRecords, onDismissRequest: (id) => dismissed.push(id) })))
    assert.ok(screen.getByText('時間切れ'))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(dismissed, ['a'])
  })

  it('会話の中の許可要求の「許可」「拒否」から応答が送られる', async () => {
    const { calls, fn } = recorder()
    render(h(Detail, detailProps(sess('s1', { requests: [permissionRequest()] }), { onRespond: fn })))
    fireEvent.click(screen.getByRole('button', { name: '拒否' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'abcde', { behavior: 'deny' }])
  })

  it('AC-UI-25: Enter で送られ、送れたら入力欄が空になる。送信ボタンはない', async () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('メッセージ')
    assert.equal(screen.queryByRole('button'), null)
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'こんにちは'])
    await waitFor(() => assert.equal(input.value, ''))
  })

  it('AC-UI-25: Shift+Enter では送らない（改行）。日本語の変換中の Enter でも送らない。空では送らない', async () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('メッセージ')
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(calls.length, 0, '空では送らない')
    fireEvent.change(input, { target: { value: 'やって' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    assert.equal(calls.length, 0)
  })

  it('AC-002-4: 上限を超えた指示は送らず、理由が出る', () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('メッセージ')
    fireEvent.change(input, { target: { value: 'あ'.repeat(10_001) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(calls.length, 0)
    assert.match(document.querySelector('[data-hint="invalid"]').textContent, /10000/)
  })

  it('送れなかったときは入力を残す', async () => {
    const { calls, fn } = recorder([{ ok: false, reason: 'x' }])
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('メッセージ')
    fireEvent.change(input, { target: { value: '残す' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => assert.equal(calls.length, 1))
    await waitFor(() => assert.equal(input.disabled, false))
    assert.equal(input.value, '残す')
  })

  it('AC-UI-26: 操作できないセッションの入力欄は無効で、送れない', () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { controllable: false }), onSend: fn }))
    const input = screen.getByLabelText('メッセージ')
    assert.equal(input.disabled, true)
    assert.equal(input.getAttribute('placeholder'), '閲覧のみ')
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(calls.length, 0)
  })

  it('保留中の指示の「取り消し」と、結果の「×」が呼ばれる', () => {
    const cancelled = []
    const dismissed = []
    render(h('div', null,
      h(PendingMessage, { sessionId: 's1', pending: { id: 'p1', preview: 'あとで' }, onCancel: (s, id) => cancelled.push([s, id]) }),
      h(SentMessage, { record: { id: 'r1', sessionId: 's1', status: 'failed', preview: '済み' }, onDismiss: (id) => dismissed.push(id) })))
    fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(cancelled, [['s1', 'p1']])
    assert.deepEqual(dismissed, ['r1'])
  })
})

describe('スクロール（AC-UI-23, 24）', () => {
  // jsdom にはレイアウトがないので、スクロールの値を差し替えて、書き込みを記録する
  const fakeScroll = (el, { scrollHeight = 2000, clientHeight = 500, scrollTop = 0 } = {}) => {
    const log = { top: scrollTop, scrolledTo: [] }
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight })
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => log.top, set: (v) => { log.top = v } })
    el.scrollTo = (opts) => log.scrolledTo.push(opts)
    return { log, set: (v) => { log.top = v } }
  }
  const props = (session, extra = {}) => ({ session, now: 10_000, instructions: new Map(), requestRecords: new Map(), onBack() {}, ...extra })

  it('AC-UI-23: 新しい内容が増えたときは一番下へ。増えていない再描画（経過時間の更新など）では動かさない', () => {
    const { container, rerender } = render(h(Detail, props(sess('s1', { state: 'working', requests: [] }))))
    const el = container.querySelector('.detail')
    const sc = fakeScroll(el)
    sc.set(300) // 利用者が上を読んでいる
    rerender(h(Detail, { ...props(sess('s1', { state: 'working', requests: [] })), now: 20_000 }))
    assert.equal(sc.log.top, 300, '時間が進んだだけでは動かない')
    rerender(h(Detail, props(sess('s1', { state: 'permission', requests: [permissionRequest()] }))))
    assert.equal(sc.log.top, 2000, '許可要求が増えたので一番下へ')
  })

  it('AC-UI-24: 一番下から離れているときだけ「一番下へ」が出て、押すと一番下へスクロールする', () => {
    const { container } = render(h(Detail, props(sess('s1', { state: 'working' }))))
    const el = container.querySelector('.detail')
    const button = container.querySelector('.to-bottom')
    assert.equal(button.hidden, true)
    const sc = fakeScroll(el)
    sc.set(100)
    fireEvent.scroll(el)
    assert.equal(button.hidden, false)
    fireEvent.click(button)
    assert.equal(sc.log.scrolledTo[0].top, 2000)
    sc.set(1500)
    fireEvent.scroll(el)
    assert.equal(button.hidden, true)
  })
})
