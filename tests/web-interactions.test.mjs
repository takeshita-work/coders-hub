// 画面の部品の操作（jsdom）。ボタンの押下・選択・入力が、応答の送信・折りたたみなどにつながることを確認する。
// 静的な描画では動かせない onClick／onChange を確かめる（機能 002・003）
// AC-004-1, 004-2, 004-3, 004-7〜004-10, 005-5, 005-6, 002-1, 003-3
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
const { App, Composer, Group, Instructions, PermissionCard, QuestionCard, RequestInput, Requests, Row, Summary } = await import('../src/web/components.mjs')

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
    const records = [{ id: 'a', sessionId: 's1', status: 'terminal', summary: 'Bash: List files' }]
    render(h(Requests, { sessionId: 's1', requests: [], records, onDismiss: (id) => dismissed.push(id) }))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(dismissed, ['a'])
  })
})

describe('一覧の中の操作', () => {
  const state = (sessions, extra = {}) => ({
    sessions: new Map(sessions.map((s) => [s.sessionId, s])), connected: true, ready: true, offset: 0,
    instructions: new Map(), requestRecords: new Map(), requestSummaries: new Map(), ...extra,
  })

  it('行に出た許可要求の「許可」から、セッション ID と要求 ID で応答が送られる', async () => {
    const { calls, fn } = recorder()
    render(h(App, { state: state([sess('s1', { requests: [permissionRequest()] })]), now: 10_000, filter: 'all', onRespond: fn }))
    fireEvent.click(screen.getByRole('button', { name: '許可' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'abcde', { behavior: 'allow' }])
  })

  it('要求の結果が行に出て、閉じる操作が呼ばれる', () => {
    const dismissed = []
    const requestRecords = new Map([['a', { id: 'a', sessionId: 's1', status: 'timeout', summary: '質問: 色' }]])
    render(h(App, { state: state([sess('s1', { state: 'working' })], { requestRecords }), now: 10_000, filter: 'all', onDismissRequest: (id) => dismissed.push(id) }))
    assert.ok(screen.getByText('時間切れ'))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(dismissed, ['a'])
  })

  it('絞り込みと、グループの折りたたみが呼ばれる', () => {
    const filters = []
    const toggles = []
    const sessions = [sess('s1', { state: 'working' })]
    render(h(App, { state: state(sessions), now: 10_000, filter: 'all', onFilter: (v) => filters.push(v), onToggle: (k) => toggles.push(k) }))
    fireEvent.click(screen.getByRole('button', { name: '要対応のみ' }))
    assert.deepEqual(filters, ['attention'])
    fireEvent.click(screen.getByRole('button', { name: /claude-a/ }))
    assert.deepEqual(toggles, ['C:\\x\\.claude-a'])
  })

  it('Summary の絞り込みボタンは、押されている方が分かる', () => {
    render(h(Summary, { counts: { permission: 1, question: 0, waiting: 0, working: 0, total: 1 }, filter: 'attention' }))
    assert.equal(screen.getByRole('button', { name: '要対応のみ' }).getAttribute('aria-pressed'), 'true')
    assert.equal(screen.getByRole('button', { name: 'すべて' }).getAttribute('aria-pressed'), 'false')
  })
})

describe('指示の入力の操作（AC-002-1, 002-4, 003-3）', () => {
  it('入力して「送信」を押すと送られ、送れたら入力欄が空になる', async () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('指示')
    assert.equal(screen.getByRole('button', { name: '送信' }).disabled, true, '空では送れない')
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => assert.equal(calls.length, 1))
    assert.deepEqual(calls[0], ['s1', 'こんにちは'])
    await waitFor(() => assert.equal(input.value, ''))
  })

  it('Ctrl+Enter でも送れる。Enter だけでは送らない', async () => {
    const { calls, fn } = recorder()
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('指示')
    fireEvent.change(input, { target: { value: 'やって' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(calls.length, 0)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => assert.equal(calls.length, 1))
  })

  it('送れなかったときは入力を残す', async () => {
    const { fn } = recorder([{ ok: false, reason: 'x' }])
    render(h(Composer, { session: sess('s1', { state: 'waiting' }), onSend: fn }))
    const input = screen.getByLabelText('指示')
    fireEvent.change(input, { target: { value: '残す' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => assert.equal(screen.getByRole('button', { name: '送信' }).disabled, false))
    assert.equal(input.value, '残す')
  })

  it('保留中の指示の「取り消し」と、結果の「×」が呼ばれる', () => {
    const cancelled = []
    const dismissed = []
    render(h(Instructions, {
      sessionId: 's1', pending: [{ id: 'p1', preview: 'あとで' }], records: [{ id: 'r1', sessionId: 's1', status: 'confirmed', preview: '済み' }],
      onCancel: (s, id) => cancelled.push([s, id]), onDismiss: (id) => dismissed.push(id),
    }))
    fireEvent.click(screen.getByRole('button', { name: '取り消し' }))
    fireEvent.click(screen.getByRole('button', { name: '結果を閉じる' }))
    assert.deepEqual(cancelled, [['s1', 'p1']])
    assert.deepEqual(dismissed, ['r1'])
  })

  it('行の「指示を送る」で入力欄が開閉する', () => {
    const { container } = render(h('ul', null, h(Row, { session: sess('s1', { state: 'waiting' }), elapsedMs: 1000 })))
    assert.equal(container.querySelector('textarea'), null)
    fireEvent.click(screen.getByRole('button', { name: '指示を送る' }))
    assert.ok(container.querySelector('textarea'))
    fireEvent.click(screen.getByRole('button', { name: '指示を送る' }))
    assert.equal(container.querySelector('textarea'), null)
  })

  it('Group: 折りたたむと行が隠れ、件数の表示は残る', () => {
    const group = { key: 'k', name: 'acct', counts: { permission: 1, question: 0, waiting: 0, working: 0, total: 1 }, sessions: [sess('s1')] }
    const { container, rerender } = render(h(Group, { group, collapsed: false, now: 10_000 }))
    assert.ok(container.querySelector('[data-session-id="s1"]'))
    rerender(h(Group, { group, collapsed: true, now: 10_000 }))
    assert.equal(container.querySelector('[data-session-id="s1"]'), null)
    assert.ok(within(container).getByText('許可待ち 1'))
  })
})
