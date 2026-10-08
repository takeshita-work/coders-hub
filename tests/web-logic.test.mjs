import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountName, countStates, formatElapsed, formatPrompt, groupByAccount, projectName,
  reduceMessage, shortId, sortSessions, titleFor,
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

describe('sortSessions', () => {
  it('AC-001-9: 許可待ち → 返答待ち → 作業中、同じ状態の中は新しい順', () => {
    const sorted = sortSessions([
      s('w-old', 'working', 100), s('p-old', 'permission', 100), s('r-new', 'waiting', 500),
      s('w-new', 'working', 900), s('r-old', 'waiting', 200), s('p-new', 'permission', 300),
    ])
    assert.deepEqual(sorted.map((x) => x.sessionId), ['p-new', 'p-old', 'r-new', 'r-old', 'w-new', 'w-old'])
  })

  it('時刻が同じなら sessionId で安定した順になる', () => {
    assert.deepEqual(sortSessions([s('b', 'working', 1), s('a', 'working', 1)]).map((x) => x.sessionId), ['a', 'b'])
  })
})

describe('質問待ち（ADR 0010）', () => {
  it('AC-001-10: 許可待ち → 質問待ち → 返答待ち → 作業中の順に並ぶ', () => {
    const sorted = sortSessions([s('w', 'working', 9), s('r', 'waiting', 9), s('q', 'question', 1), s('p', 'permission', 1)])
    assert.deepEqual(sorted.map((x) => x.sessionId), ['p', 'q', 'r', 'w'])
  })

  it('要対応に含まれ、「要対応のみ」に残る（AC-010-5）', () => {
    const groups = groupByAccount([s('q', 'question', 1), s('w', 'working', 1)], 'attention')
    assert.deepEqual(groups[0].sessions.map((x) => x.sessionId), ['q'])
    assert.equal(groups[0].counts.question, 1)
  })
})

describe('groupByAccount', () => {
  const list = [
    s('a1', 'working', 1, { account: 'C:\\x\\.claude-a' }),
    s('a2', 'permission', 2, { account: 'C:\\x\\.claude-a' }),
    s('b1', 'waiting', 3, { account: 'C:\\x\\.claude-b' }),
    s('b2', 'working', 4, { account: 'C:\\x\\.claude-b' }),
    s('n1', 'working', 5, { account: null }),
  ]

  it('AC-008-1: アカウントごとのグループに分かれ、グループ内が並んでいる', () => {
    const groups = groupByAccount(list)
    assert.equal(groups.length, 3)
    const a = groups.find((g) => g.name === '.claude-a')
    assert.deepEqual(a.sessions.map((x) => x.sessionId), ['a2', 'a1'])
    assert.equal(groups.find((g) => g.key === '').name, '（既定のアカウント）')
  })

  it('AC-008-2, AC-008-3: 同じアカウント・同じ cwd の複数セッションは別々に残る', () => {
    const g = groupByAccount([s('x1', 'working', 1), s('x2', 'working', 2)])
    assert.equal(g[0].sessions.length, 2)
  })

  it('グループの件数は要対応を含めて数える', () => {
    const b = groupByAccount(list).find((g) => g.name === '.claude-b')
    assert.deepEqual([b.counts.waiting, b.counts.working, b.counts.total], [1, 1, 2])
  })

  it('AC-010-5: 要対応のみ、では返答待ち・許可待ちだけが残り、空になったグループは消える', () => {
    const groups = groupByAccount(list, 'attention')
    assert.deepEqual(groups.flatMap((g) => g.sessions.map((x) => x.sessionId)).sort(), ['a2', 'b1'])
    assert.equal(groups.some((g) => g.key === ''), false)
  })

  it('AC-008-4: 絞り込んでも、グループの件数は絞り込み前の全体', () => {
    const b = groupByAccount(list, 'attention').find((g) => g.name === '.claude-b')
    assert.equal(b.counts.total, 2)
  })
})

describe('countStates / titleFor', () => {
  it('AC-010-3: 状態ごとの件数', () => {
    const c = countStates([s('1', 'permission', 1), s('2', 'waiting', 1), s('3', 'waiting', 1), s('4', 'working', 1)])
    assert.deepEqual(c, { permission: 1, question: 0, waiting: 2, working: 1, total: 4 })
    assert.equal(countStates([s('1', 'question', 1)]).question, 1)
  })

  it('AC-010-4: 要対応があればタイトルに件数、0 件なら件数なし', () => {
    assert.equal(titleFor({ permission: 2, question: 1, waiting: 3, working: 1, total: 7 }), '(6) Coders Hub')
    assert.equal(titleFor({ permission: 0, question: 0, waiting: 0, working: 4, total: 4 }), 'Coders Hub')
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
