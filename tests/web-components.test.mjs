// 画面の部品。react-dom/server で描画した HTML を確認する（AC-001-2, 7, 8, 9、AC-008-*、AC-010-*）
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../src/web/components.mjs'

const NOW = 1_000_000_000
const s = (id, state, secondsAgo, extra = {}) => ({
  sessionId: id, account: 'C:\\x\\.claude-a', cwd: 'D:\\work\\proj', state, stateSince: NOW - secondsAgo * 1000,
  lastPrompt: 'テストして', channelAlive: true, ...extra,
})
const stateOf = (sessions, patch = {}) => ({
  sessions: new Map(sessions.map((x) => [x.sessionId, x])), connected: true, ready: true, offset: 0, ...patch,
})
const render = (state, props = {}) =>
  renderToStaticMarkup(h(App, { state, now: NOW, filter: 'all', collapsed: new Set(), ...props }))
const rowIds = (html) => [...html.matchAll(/data-session-id="([^"]+)"/g)].map((m) => m[1])
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('一覧の行', () => {
  const html = render(stateOf([s('d96bc4ce-88c8-4500', 'waiting', 5 * 60, { lastPrompt: 'READMEを直して' })]))

  it('AC-001-2: 状態・経過時間・プロジェクト・直近の発言・短縮 ID が 1 行に出る', () => {
    assert.match(html, /<li[^>]*data-state="waiting"/)
    assert.match(text(html), /返答待ち/)
    assert.match(text(html), /5分/)
    assert.match(text(html), /proj/)
    assert.match(text(html), /READMEを直して/)
    assert.match(html, />d96bc4ce</)
  })

  it('直近の発言がないときは「（発言なし）」', () => {
    assert.match(text(render(stateOf([s('a', 'working', 1, { lastPrompt: null })]))), /（発言なし）/)
  })

  it('AC-001-8: 経過時間は now から計算される（now が進めば表示が変わる）', () => {
    const state = stateOf([s('a', 'working', 59)])
    assert.match(text(renderToStaticMarkup(h(App, { state, now: NOW, filter: 'all' }))), /59秒/)
    assert.match(text(renderToStaticMarkup(h(App, { state, now: NOW + 2000, filter: 'all' }))), /1分/)
  })
})

describe('グループと並び', () => {
  const state = stateOf([
    s('a-work', 'working', 10), s('a-perm', 'permission', 20), s('a-wait', 'waiting', 30),
    s('b-wait', 'waiting', 40, { account: 'C:\\x\\.claude-b' }),
  ])

  it('AC-008-1: アカウントごとのグループに分かれる', () => {
    const html = render(state)
    assert.equal((html.match(/class="group"/g) ?? []).length, 2)
    assert.match(text(html), /\.claude-a/)
    assert.match(text(html), /\.claude-b/)
  })

  it('AC-001-9: グループ内は許可待ち → 返答待ち → 作業中', () => {
    assert.deepEqual(rowIds(render(state)).slice(0, 3), ['a-perm', 'a-wait', 'a-work'])
  })

  it('AC-008-2: 同じアカウント・同じ cwd の複数セッションが別の行になる', () => {
    assert.equal(rowIds(render(stateOf([s('x1', 'working', 1), s('x2', 'working', 2)]))).length, 2)
  })
})

describe('要対応の強調とサマリー', () => {
  const state = stateOf([s('p', 'permission', 1), s('w1', 'waiting', 1), s('w2', 'waiting', 1), s('k', 'working', 1)])

  it('AC-010-1/2: 許可待ち・返答待ち・作業中が行のクラスと文言で区別できる', () => {
    const html = render(state)
    assert.match(html, /class="row state-permission"/)
    assert.match(html, /class="row state-waiting"/)
    assert.match(html, /class="row state-working"/)
    assert.match(text(html), /許可待ち/)
    assert.match(text(html), /返答待ち/)
  })

  it('AC-010-3: 上部に状態ごとの件数サマリー', () => {
    const html = render(state)
    assert.match(html, /data-count="permission">許可待ち 1</)
    assert.match(html, /data-count="waiting">返答待ち 2</)
    assert.match(html, /data-count="working">作業中 1</)
  })

  it('AC-010-5: 「要対応のみ」では作業中の行が出ない', () => {
    assert.deepEqual(rowIds(render(state, { filter: 'attention' })).sort(), ['p', 'w1', 'w2'])
    assert.match(render(state, { filter: 'attention' }), /aria-pressed="true">要対応のみ</)
  })

  it('AC-010-6: 通知・音の仕組みを含まない', () => {
    const html = render(state)
    assert.doesNotMatch(html, /<audio|Notification/)
  })
})

describe('折りたたみ', () => {
  const state = stateOf([s('p', 'permission', 1), s('w', 'waiting', 1), s('k', 'working', 1)])

  it('AC-008-4: 折りたたむと行が消え、要対応の件数は残る', () => {
    const html = render(state, { collapsed: new Set(['C:\\x\\.claude-a']) })
    assert.deepEqual(rowIds(html), [])
    assert.match(html, /aria-expanded="false"/)
    assert.match(html, /chip-permission">許可待ち 1</)
    assert.match(html, /chip-waiting">返答待ち 1</)
  })

  it('展開していれば行が出る', () => {
    const html = render(state)
    assert.equal(rowIds(html).length, 3)
    assert.match(html, /aria-expanded="true"/)
  })
})

describe('空の状態と接続', () => {
  it('AC-001-7: セッションが 0 件なら「セッションがありません」', () => {
    assert.match(text(render(stateOf([]))), /セッションがありません/)
  })

  it('要対応のみで該当がなければ、その旨を出す', () => {
    assert.match(text(render(stateOf([s('k', 'working', 1)]), { filter: 'attention' })), /要対応のセッションはありません/)
  })

  it('最初のスナップショットを受け取るまでは「セッションがありません」を出さない', () => {
    const html = render(stateOf([], { ready: false, connected: false }))
    assert.doesNotMatch(text(html), /セッションがありません/)
    assert.match(text(html), /接続しています/)
  })

  it('切断中は警告を出し、最後の一覧を薄く表示し続ける', () => {
    const html = render(stateOf([s('a', 'waiting', 1)], { connected: false }))
    assert.match(html, /role="alert"/)
    assert.match(text(html), /接続が切れました/)
    assert.match(html, /class="groups stale"/)
    assert.deepEqual(rowIds(html), ['a'])
  })

  it('接続中は警告を出さない', () => {
    assert.doesNotMatch(render(stateOf([s('a', 'working', 1)])), /role="alert"/)
  })
})
