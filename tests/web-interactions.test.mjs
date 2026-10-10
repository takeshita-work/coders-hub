// 画面の部品の操作（jsdom）。ボタンの押下・選択・入力が、応答の送信・折りたたみなどにつながることを確認する。
// 静的な描画では動かせない onClick／onChange を確かめる（機能 002）
// AC-002-1, 002-4, 003-3
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
const { App, Composer, Group, Instructions, Row, Summary } = await import('../src/web/components.mjs')

afterEach(() => cleanup())

const sess = (id, extra = {}) => ({
  sessionId: id, state: 'permission', stateSince: 1, account: 'C:\\x\\.claude-a', cwd: 'D:\\p', lastPrompt: null, channelAlive: true,
  controllable: true, pending: [], ...extra,
})

// onSend の呼び出しを記録する。results は呼び出しごとの戻り値（なければ { ok: true }）
const recorder = (results = []) => {
  const calls = []
  const fn = async (...args) => { calls.push(args); return results[calls.length - 1] ?? { ok: true } }
  return { calls, fn }
}

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
