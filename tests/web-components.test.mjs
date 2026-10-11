// 画面の部品。react-dom/server で描画した HTML を確認する（機能 006: AC-UI-1〜29、機能 001 の AC-001-7, 8, 10）
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App, defaultUi } from '../src/web/components.mjs'

const NOW = 1_000_000_000
const A = 'C:\\x\\.claude-a'
const B = 'C:\\x\\.claude-b'
const s = (id, state, secondsAgo, extra = {}) => ({
  sessionId: id, account: A, cwd: 'D:\\work\\proj', state, stateSince: NOW - secondsAgo * 1000, startedAt: NOW - 3_600_000,
  lastPrompt: 'テストして', channelAlive: true, controllable: true, pending: [], requests: [], ...extra,
})
const stateOf = (sessions, patch = {}) => ({
  sessions: new Map(sessions.map((x) => [x.sessionId, x])), connected: true, ready: true, offset: 0,
  instructions: new Map(), requestRecords: new Map(), requestSummaries: new Map(), requestKinds: new Map(), ...patch,
})
const render = (state, ui = {}, props = {}) =>
  renderToStaticMarkup(h(App, { state, now: NOW, ui: { ...defaultUi(), ...ui }, ...props }))
const rowIds = (html) => [...html.matchAll(/data-session-id="([^"]+)"/g)].map((m) => m[1])
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('構成（AC-UI-1, 2）', () => {
  it('AC-UI-1: サイドバーとメインがあり、未選択のときはメインに案内が出る', () => {
    const html = render(stateOf([s('a', 'permission', 1), s('b', 'waiting', 1)]))
    assert.match(html, /<aside class="side"/)
    assert.match(html, /<main class="main"/)
    assert.match(text(html), /セッションを選んでください/)
    assert.match(text(html), /要対応: 1 件/, '要対応は許可待ち・質問待ちだけ')
  })

  it('AC-UI-2: 詳細を開いているときは view-detail、そうでなければ view-list（スマホで一覧と詳細を切り替える）', () => {
    const state = stateOf([s('a', 'working', 1)])
    assert.match(render(state), /class="app view-list"/)
    assert.match(render(state, { selected: 'a', view: 'detail' }), /class="app view-detail"/)
    assert.match(render(state, { selected: 'a', view: 'list' }), /class="app view-list"/)
  })

  it('選んでいたセッションが閉じたら、一覧に戻る', () => {
    assert.match(render(stateOf([s('a', 'working', 1)]), { selected: 'gone', view: 'detail' }), /class="app view-list"/)
  })

  it('詳細には「一覧へ」の戻るボタンがある', () => {
    assert.match(render(stateOf([s('a', 'working', 1)]), { selected: 'a', view: 'detail' }), /aria-label="一覧へ"/)
  })
})

describe('セッションの行（AC-UI-11〜15）', () => {
  const html = render(stateOf([s('d96bc4ce-88c8-4500', 'permission', 5 * 60, { lastPrompt: 'READMEを直して' })]))

  it('AC-UI-11: 短縮 ID・経過時間・札・直近の発言が出る', () => {
    assert.match(html, /<li[^>]*data-state="permission"/)
    assert.match(html, />d96bc4ce</)
    assert.match(text(html), /5分/)
    assert.match(html, /class="chip chip-permission">許可</)
    assert.match(text(html), /READMEを直して/)
  })

  it('AC-UI-11: 質問待ち・作業中の札。返答待ちには札がない', () => {
    const rows = render(stateOf([s('q', 'question', 1), s('k', 'working', 1), s('w', 'waiting', 1)]))
    assert.match(rows, /class="chip chip-question">質問</)
    assert.match(rows, /class="chip chip-working">作業</)
    assert.doesNotMatch(rows, /chip-waiting/)
    assert.doesNotMatch(text(rows), /返答/)
  })

  it('直近の発言がないときは「（発言なし）」', () => {
    assert.match(text(render(stateOf([s('a', 'working', 1, { lastPrompt: null })]))), /（発言なし）/)
  })

  it('AC-UI-12: 行のクラスで状態が区別できる（左の線の色）', () => {
    const rows = render(stateOf([s('p', 'permission', 1), s('q', 'question', 1), s('w', 'waiting', 1), s('k', 'working', 1)]))
    for (const st of ['permission', 'question', 'waiting', 'working']) assert.match(rows, new RegExp(`class="sess st-${st}`))
  })

  it('AC-UI-13: 操作できないセッションは nc クラスで、札の代わりに「閲覧のみ」', () => {
    const rows = render(stateOf([s('v', 'working', 1, { controllable: false }), s('c', 'working', 1)]))
    assert.match(rows, /class="sess st-working nc"/)
    assert.equal((rows.match(/class="tag-nc">閲覧のみ</g) ?? []).length, 1)
  })

  it('AC-UI-15: 経過時間は now から計算される（now が進めば表示が変わる）', () => {
    const state = stateOf([s('a', 'working', 59)])
    const at = (now) => text(renderToStaticMarkup(h(App, { state, now, ui: defaultUi() })))
    assert.match(at(NOW), /59秒/)
    assert.match(at(NOW + 2000), /1分/)
  })
})

describe('ツリー（AC-UI-4, 5, 7, 8）', () => {
  const state = stateOf([
    s('a-work', 'working', 10), s('a-perm', 'permission', 20, { startedAt: NOW - 1_000 }), s('a-wait', 'waiting', 30, { startedAt: NOW - 2_000 }),
    s('b-wait', 'waiting', 40, { account: B, startedAt: NOW - 9_000_000 }),
  ])

  it('AC-UI-4: アカウントの帯の下にプロジェクト、その下にセッション', () => {
    const html = render(state)
    assert.equal((html.match(/data-node="a:/g) ?? []).length, 2)
    assert.equal((html.match(/data-node="d:/g) ?? []).length, 2)
    assert.match(html, /class="node-head band"/)
    assert.match(text(html), /\.claude-a/)
    assert.match(text(html), /proj/)
  })

  it('AC-UI-6, 7: 起動の早い順に並ぶ。状態で並べ替えない', () => {
    // b アカウントが先（起動が最も早い）。a の中は startedAt の早い順: a-work（1 時間前）→ a-wait → a-perm
    assert.deepEqual(rowIds(render(state)), ['b-wait', 'a-work', 'a-wait', 'a-perm'])
    assert.deepEqual(rowIds(render(state, { sessSort: 'late' })), ['b-wait', 'a-perm', 'a-wait', 'a-work'])
  })

  it('AC-UI-8: 同じアカウント・同じプロジェクトの複数セッションが別の行になり、短縮 ID で区別できる', () => {
    const html = render(stateOf([s('aaaaaaaa-1', 'working', 1), s('bbbbbbbb-2', 'working', 2)]))
    assert.equal(rowIds(html).length, 2)
    assert.match(html, />aaaaaaaa</)
    assert.match(html, />bbbbbbbb</)
  })

  it('AC-UI-5: 帯とプロジェクトに、許可待ち・質問待ちの件数のバッジが出る（返答待ち・作業中は出ない）', () => {
    const html = render(stateOf([s('p', 'permission', 1), s('q', 'question', 1), s('w', 'waiting', 1), s('k', 'working', 1)]))
    assert.equal((html.match(/badge-permission"[^>]*>1</g) ?? []).length, 2, '帯とプロジェクト')
    assert.equal((html.match(/badge-question"[^>]*>1</g) ?? []).length, 2)
    assert.doesNotMatch(html, /badge-waiting|badge-working/)
  })

  it('AC-UI-5: 折りたたむと行が消え、件数のバッジは残る', () => {
    const st = stateOf([s('p', 'permission', 1), s('k', 'working', 1)])
    const html = render(st, { collapsed: new Set([`a:${A}`]) })
    assert.deepEqual(rowIds(html), [])
    assert.match(html, /aria-expanded="false"/)
    assert.match(html, /badge-permission"[^>]*>1</)
  })

  it('折りたたんでいなければ行が出る', () => {
    const html = render(stateOf([s('p', 'permission', 1), s('k', 'working', 1)]))
    assert.equal(rowIds(html).length, 2)
    assert.match(html, /aria-expanded="true"/)
  })
})

describe('フィルター・ソートのパネル（AC-UI-9）', () => {
  const state = stateOf([s('c', 'working', 1), s('v', 'working', 1, { controllable: false })])

  it('閉じているときはパネルが出ない。開くと 3 つの設定が出る', () => {
    assert.doesNotMatch(render(state), /class="panel"/)
    const html = render(state, { opts: true })
    assert.match(html, /class="panel"/)
    assert.match(text(html), /操作できるものだけ/)
    assert.match(text(html), /プロジェクト ↑ 昇順/)
    assert.match(text(html), /セッション ↑ 昇順/)
    assert.match(text(render(state, { opts: true, dirSort: 'desc', sessSort: 'late' })), /プロジェクト ↓ 降順 セッション ↓ 降順/)
  })

  it('「操作できるものだけ」では操作モードのセッションだけが出て、ボタンに印が付く', () => {
    const html = render(state, { onlyControl: true })
    assert.deepEqual(rowIds(html), ['c'])
    assert.match(html, /data-filtering/)
    assert.doesNotMatch(render(state), /data-filtering/)
  })

  it('状態の絞り込み・検索・件数サマリーはない（ADR 0015）', () => {
    const html = render(state, { opts: true })
    assert.doesNotMatch(html, /要対応のみ|type="search"|data-count=/)
  })
})

describe('詳細（AC-UI-19〜27）', () => {
  const session = s('d96bc4ce-88c8-4500', 'working', 90, { lastPrompt: 'x' })
  const open = (extra = {}, state = stateOf([{ ...session, ...extra }])) => render(state, { selected: session.sessionId, view: 'detail' })

  it('AC-UI-19: 見出しにプロジェクト名とアカウント名が出る', () => {
    const html = open()
    assert.match(html, /<h2[^>]*>proj</)
    assert.match(html, /class="d-meta1"[^>]*>\.claude-a</)
  })

  it('AC-UI-27: 入力欄の下に、短縮 ID・経過時間・札が出る。返答待ちには札が出ない', () => {
    const html = open()
    assert.match(html, /class="status-line"/)
    assert.match(text(html.slice(html.indexOf('status-line'))), /d96bc4ce 1分 作業/)
    const waiting = open({ state: 'waiting' })
    assert.doesNotMatch(waiting.slice(waiting.indexOf('status-line')), /class="state/)
  })

  it('AC-UI-25: メッセージ入力欄は 1 行で、プレースホルダ付き。送信ボタンはない', () => {
    const html = open()
    assert.match(html, /<textarea[^>]*rows="1"[^>]*placeholder="メッセージを入力"/)
    assert.doesNotMatch(html, /送信</)
  })

  it('AC-UI-26: 操作できないセッションの入力欄は無効で「閲覧のみ」', () => {
    const html = open({ controllable: false })
    assert.match(html, /<textarea[^>]*disabled=""[^>]*placeholder="閲覧のみ"/)
  })

  it('AC-UI-24: 「一番下へ」ボタンがあり、最初は隠れている', () => {
    assert.match(open(), /<button[^>]*class="to-bottom"[^>]*hidden=""/)
  })

  it('AC-UI-22: 保留中の指示は会話の中に出て、取り消しの操作がある', () => {
    const html = open({ pending: [{ id: 'a', createdAt: 1, preview: 'あとで頼む指示' }] })
    assert.match(html, /data-instruction-status="held"/)
    assert.match(text(html), /保留中 あとで頼む指示 取り消し/)
  })

  it('AC-UI-22: 送った指示の結果が会話の中に出る。届きました以外には閉じる操作がある', () => {
    const instructions = new Map([
      ['a', { id: 'a', sessionId: session.sessionId, status: 'confirmed', preview: '一つ目', at: 1 }],
      ['b', { id: 'b', sessionId: session.sessionId, status: 'failed', preview: '二つ目', reason: 'ぼん', at: 2 }],
    ])
    const html = open({}, stateOf([session], { instructions }))
    assert.match(text(html), /届きました 一つ目/)
    assert.match(text(html), /送れませんでした.*二つ目.*ぼん/)
    assert.equal((html.match(/aria-label="結果を閉じる"/g) ?? []).length, 1)
  })

  it('AC-UI-21: 結果の行は、種類の色で、ツール名つきの結果だけ（入力や答えの内容は含めない）', () => {
    const requestRecords = new Map([
      ['p', { id: 'p', sessionId: session.sessionId, status: 'allowed', summary: 'Bash: List files', kind: 'permission', at: 1 }],
      ['q', { id: 'q', sessionId: session.sessionId, status: 'answered', summary: '質問: 色', at: 2 }],
      ['t', { id: 't', sessionId: session.sessionId, status: 'timeout', summary: '質問: 果物', at: 3 }],
    ])
    const html = open({}, stateOf([session], { requestRecords }))
    assert.match(html, /class="msg res res-permission"/)
    assert.match(html, /class="msg res res-question"/, '種類がなくても、答えた結果は質問として色分けする')
    assert.match(html, /class="msg res" data-request-status="timeout"/, '時間切れは種類が分からないので色なし')
    assert.match(text(html), /許可しました × Bash: List files/)
  })

  it('AC-UI-20: 応答待ちの許可要求・質問が、会話の中にカードで出る', () => {
    const requests = [
      { id: 'r1', kind: 'permission', createdAt: 1, toolName: 'Bash', description: 'List files', inputPreview: '{ "command": "ls" }' },
      { id: 'q1', kind: 'question', createdAt: 2, questions: [{ question: '色は？', header: '色', multiSelect: false, options: [{ label: '赤', description: '' }] }] },
    ]
    const html = open({ state: 'permission', requests })
    assert.match(html, /<section class="card c-permission"[^>]*data-request-kind="permission"/)
    assert.match(html, /<section class="card c-question"[^>]*data-request-kind="question"/)
    assert.ok(html.indexOf('class="talk"') < html.indexOf('c-permission'), 'カードは会話の領域の中')
  })
})

describe('空の状態と接続', () => {
  it('AC-UI-10, AC-001-7: セッションが 0 件なら「セッションがありません」', () => {
    assert.match(text(render(stateOf([]))), /セッションがありません/)
  })

  it('絞り込みで該当がなければ、その旨を出す', () => {
    assert.match(text(render(stateOf([s('v', 'working', 1, { controllable: false })]), { onlyControl: true })), /該当するセッションがありません/)
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
    assert.match(html, /class="app view-list stale"/)
    assert.deepEqual(rowIds(html), ['a'])
  })

  it('接続中は警告を出さない', () => {
    assert.doesNotMatch(render(stateOf([s('a', 'working', 1)])), /role="alert"/)
  })
})

describe('通知（AC-UI-29）', () => {
  it('通知・音の仕組みを含まない', () => {
    assert.doesNotMatch(render(stateOf([s('p', 'permission', 1)])), /<audio|Notification/)
  })
})
