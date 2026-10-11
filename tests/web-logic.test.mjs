import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHORT_LABEL, accountName, applyUiPatch, buildTree, countStates, formatElapsed, formatPrompt, isAttention, projectName,
  reduceMessage, shortId, sidebarAllowRequest, titleFor,
} from '../src/web/logic.mjs'

const s = (id, state, since, extra = {}) => ({
  sessionId: id, account: 'C:\\Users\\yuya\\.claude-a', cwd: 'D:\\work\\proj', state, stateSince: since, lastPrompt: null, channelAlive: true, ...extra,
})

describe('reduceMessage', () => {
  it('snapshot で置き換え、added / updated / removed で差分を適用する（元の Map は変えない）', () => {
    const empty = new Map()
    const a = reduceMessage(empty, { type: 'snapshot', sessions: [s('1', 'working', 1)] })
    assert.equal(a.size, 1)
    const b = reduceMessage(a, { type: 'added', session: s('2', 'waiting', 2) })
    assert.equal(b.size, 2)
    assert.equal(a.size, 1)
    const c = reduceMessage(b, { type: 'updated', session: s('1', 'permission', 3) })
    assert.equal(c.get('1').state, 'permission')
    assert.equal(b.get('1').state, 'working')
    const d = reduceMessage(c, { type: 'removed', sessionId: '1' })
    assert.deepEqual([...d.keys()], ['2'])
  })

  it('再接続のスナップショットは古い一覧を残さない', () => {
    const old = reduceMessage(new Map(), { type: 'snapshot', sessions: [s('1', 'working', 1)] })
    const next = reduceMessage(old, { type: 'snapshot', sessions: [s('2', 'working', 1)] })
    assert.deepEqual([...next.keys()], ['2'])
  })

  it('未知のメッセージは無視する', () => {
    const m = new Map([['1', s('1', 'working', 1)]])
    assert.equal(reduceMessage(m, { type: 'hello' }), m)
  })
})

describe('buildTree（機能 006: アカウント → プロジェクト → セッション）', () => {
  const A = 'C:\\x\\.claude-a'
  const B = 'C:\\x\\.claude-b'
  const list = [
    s('a-late', 'working', 1, { account: A, cwd: 'D:\\w\\zeta', startedAt: 500 }),
    s('a-early', 'permission', 2, { account: A, cwd: 'D:\\w\\zeta', startedAt: 100 }),
    s('a-alpha', 'waiting', 3, { account: A, cwd: 'D:\\w\\alpha', startedAt: 300 }),
    s('b-1', 'working', 4, { account: B, cwd: 'D:\\w\\proj', startedAt: 50 }),
    s('n-1', 'working', 5, { account: null, cwd: null, startedAt: 700 }),
  ]
  const ids = (tree) => tree.flatMap((a) => a.projects.flatMap((p) => p.sessions.map((x) => x.sessionId)))

  it('AC-UI-4: アカウント → プロジェクト → セッションに分かれる', () => {
    const tree = buildTree(list)
    assert.deepEqual(tree.map((a) => a.name), ['.claude-b', '.claude-a', '（既定のアカウント）'])
    const a = tree.find((x) => x.name === '.claude-a')
    assert.deepEqual(a.projects.map((p) => p.name), ['alpha', 'zeta'])
    assert.equal(tree.find((x) => x.key === '').projects[0].name, '（不明）')
  })

  it('AC-UI-6: アカウントは、起動が最も早いセッションを持つ順', () => {
    // b は 50、a は 100、既定は 700
    assert.deepEqual(buildTree(list).map((a) => a.key), [B, A, ''])
  })

  it('AC-UI-6: プロジェクトは名前の昇順／降順', () => {
    const projects = (dirSort) => buildTree(list, { dirSort }).find((a) => a.key === A).projects.map((p) => p.name)
    assert.deepEqual(projects('asc'), ['alpha', 'zeta'])
    assert.deepEqual(projects('desc'), ['zeta', 'alpha'])
  })

  it('AC-UI-6: セッションは起動の早い順／遅い順', () => {
    const zeta = (sessSort) => buildTree(list, { sessSort }).find((a) => a.key === A).projects.find((p) => p.name === 'zeta').sessions.map((x) => x.sessionId)
    assert.deepEqual(zeta('early'), ['a-early', 'a-late'])
    assert.deepEqual(zeta('late'), ['a-late', 'a-early'])
  })

  it('AC-UI-7: 状態が変わっても、並びは変わらない（状態では並べ替えない）', () => {
    const before = ids(buildTree(list))
    const changed = list.map((x) => (x.sessionId === 'a-late' ? { ...x, state: 'permission' } : x))
    assert.deepEqual(ids(buildTree(changed)), before)
  })

  it('startedAt がない古い形式でも、状態の時刻で並べられる', () => {
    const old = [s('x', 'working', 900), s('y', 'working', 100)]
    assert.deepEqual(ids(buildTree(old)), ['y', 'x'])
  })

  it('AC-UI-8: 同じアカウント・同じプロジェクトのセッションは別々に残る', () => {
    const tree = buildTree([s('x1', 'working', 1), s('x2', 'working', 2)])
    assert.equal(tree[0].projects[0].sessions.length, 2)
  })

  it('AC-UI-5: アカウント・プロジェクトの件数（許可待ち・質問待ち）を数える', () => {
    const tree = buildTree([s('p', 'permission', 1), s('q', 'question', 1), s('w', 'waiting', 1), s('k', 'working', 1)])
    const c = tree[0].counts
    assert.deepEqual([c.permission, c.question, c.total], [1, 1, 4])
    assert.deepEqual([tree[0].projects[0].counts.permission, tree[0].projects[0].counts.question], [1, 1])
  })

  it('AC-UI-9: 「操作できるものだけ」では、操作モードのセッションだけが残り、空になったアカウントは消える', () => {
    const mixed = [s('c1', 'working', 1, { controllable: true }), s('v1', 'working', 2, { controllable: false, account: 'C:\\x\\.claude-v' })]
    const tree = buildTree(mixed, { onlyControl: true })
    assert.deepEqual(ids(tree), ['c1'])
    assert.equal(tree.length, 1)
  })

  it('ノードのキーは、アカウントとプロジェクトで一意', () => {
    const tree = buildTree(list)
    const keys = tree.flatMap((a) => [a.nodeKey, ...a.projects.map((p) => p.key)])
    assert.equal(new Set(keys).size, keys.length)
  })
})

describe('要対応・札・件数・タイトル', () => {
  it('AC-UI-12: 要対応は許可待ち・質問待ち。返答待ち・作業中は含まない', () => {
    assert.deepEqual(['permission', 'question', 'waiting', 'working'].map((st) => isAttention(s('x', st, 1))), [true, true, false, false])
  })

  it('AC-UI-11: 札は許可／質問／作業。返答待ちには札がない', () => {
    assert.deepEqual(SHORT_LABEL, { permission: '許可', question: '質問', working: '作業' })
    assert.equal(SHORT_LABEL.waiting, undefined)
  })

  it('状態ごとの件数', () => {
    const c = countStates([s('1', 'permission', 1), s('2', 'waiting', 1), s('3', 'waiting', 1), s('4', 'working', 1)])
    assert.deepEqual(c, { permission: 1, question: 0, waiting: 2, working: 1, total: 4 })
    assert.equal(countStates([s('1', 'question', 1)]).question, 1)
  })

  it('AC-UI-28: 要対応（許可待ち・質問待ち）があればタイトルに件数、0 件なら件数なし', () => {
    assert.equal(titleFor({ permission: 2, question: 1, waiting: 3, working: 1, total: 7 }), '(3) Coders Hub')
    assert.equal(titleFor({ permission: 0, question: 0, waiting: 5, working: 4, total: 9 }), 'Coders Hub')
  })
})

describe('サイドバーの「許可」ボタン（AC-UI-17, 18）', () => {
  const req = (extra = {}) => ({ id: 'r1', kind: 'permission', toolName: 'Bash', inputPreview: '{ "command": "ls" }', ...extra })
  const withReq = (r, extra = {}) => s('x', 'permission', 1, { controllable: true, requests: [r], ...extra })

  it('短い許可要求（200 文字以下・省略なし）には出る', () => {
    assert.equal(sidebarAllowRequest(withReq(req()))?.id, 'r1')
    assert.equal(sidebarAllowRequest(withReq(req({ inputPreview: 'a'.repeat(200) })))?.id, 'r1')
  })

  it('長い入力・省略された入力・質問・操作できないセッションには出ない', () => {
    assert.equal(sidebarAllowRequest(withReq(req({ inputPreview: 'a'.repeat(201) }))), null)
    assert.equal(sidebarAllowRequest(withReq(req({ inputPreview: 'a\n⋯ 5 code points elided ⋯\nb' }))), null)
    assert.equal(sidebarAllowRequest(withReq({ id: 'q1', kind: 'question', questions: [] })), null)
    assert.equal(sidebarAllowRequest(withReq(req(), { controllable: false })), null)
    assert.equal(sidebarAllowRequest(s('x', 'working', 1, { controllable: true })), null)
  })
})

describe('画面の状態の更新', () => {
  const ui = { selected: null, view: 'list', opts: false, collapsed: new Set(['a']) }
  it('patch を重ね、toggle で折りたたみの有無を切り替える（元は変えない）', () => {
    const next = applyUiPatch(ui, { selected: 's1', view: 'detail' })
    assert.deepEqual([next.selected, next.view], ['s1', 'detail'])
    const folded = applyUiPatch(ui, { toggle: 'b' })
    assert.deepEqual([...folded.collapsed].sort(), ['a', 'b'])
    assert.deepEqual([...ui.collapsed], ['a'])
    assert.deepEqual([...applyUiPatch(folded, { toggle: 'a' }).collapsed], ['b'])
  })
})

describe('formatElapsed', () => {
  it('AC-001-8: 秒・分・時間・日の区切り', () => {
    const f = (sec) => formatElapsed(sec * 1000)
    assert.equal(f(0), '0秒')
    assert.equal(f(59), '59秒')
    assert.equal(f(60), '1分')
    assert.equal(f(5 * 60 + 30), '5分')
    assert.equal(f(3600), '1時間')
    assert.equal(f(3600 + 3 * 60), '1時間3分')
    assert.equal(f(24 * 3600), '1日')
    assert.equal(f(25 * 3600), '1日1時間')
  })

  it('負の値（時計のずれ）は 0 秒', () => {
    assert.equal(formatElapsed(-5000), '0秒')
  })
})

describe('表示用の整形', () => {
  it('プロジェクト名・アカウント名はフォルダ名、短縮 ID は先頭 8 文字', () => {
    assert.equal(projectName('D:\\a\\#b\\coders-hub'), 'coders-hub')
    assert.equal(projectName('/home/u/proj/'), 'proj')
    assert.equal(projectName(null), '（不明）')
    assert.equal(accountName('C:\\Users\\yuya\\.claude-takeshita.work'), '.claude-takeshita.work')
    assert.equal(shortId('d96bc4ce-88c8-4500-b5f4-24d54418c340'), 'd96bc4ce')
  })

  it('直近の発言は先頭 1 行を 80 文字まで。空なら null', () => {
    assert.equal(formatPrompt('こんにちは\n2 行目'), 'こんにちは')
    assert.equal(formatPrompt('  \n  '), null)
    assert.equal(formatPrompt(null), null)
    assert.equal(formatPrompt(''), null)
    const long = formatPrompt('あ'.repeat(100))
    assert.equal(Array.from(long).length, 81)
    assert.ok(long.endsWith('…'))
    assert.equal(formatPrompt('a'.repeat(80)), 'a'.repeat(80))
  })
})
