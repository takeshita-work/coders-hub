// 指示の待ち行列（機能 002、ADR 0013）。AC-002-4, 002-6, 002-8〜002-10, 003-1〜003-4
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/hub/sessions.mjs'
import { createInstructions, InstructionError, MAX_TEXT } from '../src/hub/instructions.mjs'

let clock, store, ins, ready, changes

const hook = (event, extra = {}, session = 's1') =>
  store.applyHookEvent({ event, account: 'A', input: { session_id: session, cwd: 'D:\\p', ...extra } })

// 操作モードのチャネルサーバーが接続している返答待ちのセッションを用意する
const setup = (session = 's1', { channel = true } = {}) => {
  store.registerChannel({ sessionId: session, account: 'A', cwd: 'D:\\p', channel })
  hook('Stop', {}, session)
}

beforeEach(() => {
  clock = { t: 1_000_000 }
  const now = () => clock.t
  let n = 0
  store = createStore({ now })
  ready = []
  ins = createInstructions({ store, now, newId: () => `id${++n}`, confirmMs: 15_000, keepMs: 60_000, onReady: (s) => ready.push(s) })
  changes = []
  ins.subscribe((c) => changes.push(c))
  setup()
})

const statuses = () => changes.map((c) => `${c.id}:${c.status}`)

describe('送信の受け付け（AC-002-4, AC-002-9）', () => {
  it('AC-002-4: 空・空白だけの指示は受け付けない', () => {
    for (const text of ['', '   \n  ', undefined, 5]) {
      assert.throws(() => ins.submit('s1', text), (e) => e instanceof InstructionError && e.code === 'invalid')
    }
  })

  it('AC-002-4: 10,000 文字までは受け付け、超えたら受け付けない', () => {
    assert.doesNotThrow(() => ins.submit('s1', 'あ'.repeat(MAX_TEXT)))
    assert.throws(() => ins.submit('s1', 'あ'.repeat(MAX_TEXT + 1)), (e) => e.code === 'too-long')
  })

  it('AC-002-9: 存在しないセッションには送れない', () => {
    assert.throws(() => ins.submit('nope', 'こんにちは'), (e) => e.code === 'not-found')
  })

  it('AC-002-5: 操作モードでないセッションには送れない', () => {
    setup('plain', { channel: false })
    assert.equal(store.get('plain').controllable, false)
    assert.throws(() => ins.submit('plain', 'こんにちは'), (e) => e.code === 'not-controllable')
  })
})

describe('返答待ちのセッション（AC-002-2, AC-002-10）', () => {
  it('AC-002-2: 返答待ちなら、すぐ渡せる状態になり、take で本文を取り出せる', () => {
    const r = ins.submit('s1', 'テストを実行して')
    assert.ok(ready.includes('s1'), '渡せる指示ができたことを知らせる')
    assert.deepEqual(ins.take('s1'), { id: r.id, text: 'テストを実行して' })
    assert.deepEqual(statuses(), ['id1:held', 'id1:delivering'])
  })

  it('AC-002-10: 渡したあとは本文を保持しない（保留中の一覧にも、記録にも残らない）', () => {
    ins.submit('s1', '秘密の本文')
    ins.take('s1')
    assert.deepEqual(store.get('s1').pending, [])
    assert.ok(!JSON.stringify(changes).includes('秘密の本文'))
    assert.ok(!JSON.stringify(store.list()).includes('秘密の本文'))
  })

  it('渡す前の take は null。同じ指示を二度は渡さない', () => {
    assert.equal(ins.take('s1'), null)
    ins.submit('s1', 'a')
    assert.ok(ins.take('s1'))
    assert.equal(ins.take('s1'), null)
  })
})

describe('保留（AC-003-1〜003-4）', () => {
  for (const [name, setBlocked] of [
    ['作業中', () => hook('UserPromptSubmit', { prompt: 'x' })],
    ['許可待ち', () => { hook('UserPromptSubmit', { prompt: 'x' }); hook('PermissionRequest', { tool_name: 'Bash' }) }],
    ['質問待ち', () => { hook('UserPromptSubmit', { prompt: 'x' }); hook('PermissionRequest', { tool_name: 'AskUserQuestion' }) }],
  ]) {
    it(`AC-003-1: ${name}のセッション宛の指示は保留され、返答待ちになったときに渡される`, () => {
      setBlocked()
      ready.length = 0
      const r = ins.submit('s1', '次にこれをして')
      assert.equal(r.status, 'held')
      assert.equal(ins.take('s1'), null)
      assert.equal(ready.length, 0)
      hook('Stop')
      assert.ok(ready.includes('s1'))
      assert.deepEqual(ins.take('s1'), { id: r.id, text: '次にこれをして' })
    })
  }

  it('AC-003-3: 保留中の指示は、セッションの pending に出て、取り消せる', () => {
    hook('UserPromptSubmit', { prompt: 'x' })
    const r = ins.submit('s1', '長い指示\n2 行目')
    assert.deepEqual(store.get('s1').pending.map((p) => ({ id: p.id, preview: p.preview })), [{ id: r.id, preview: '長い指示' }])
    ins.cancel('s1', r.id)
    assert.deepEqual(store.get('s1').pending, [])
    hook('Stop')
    assert.equal(ins.take('s1'), null)
    assert.equal(statuses().at(-1), `${r.id}:cancelled`)
  })

  it('AC-003-3: 渡した指示・存在しない指示は取り消せない', () => {
    const r = ins.submit('s1', 'a')
    ins.take('s1')
    assert.throws(() => ins.cancel('s1', r.id), (e) => e.code === 'not-held')
    assert.throws(() => ins.cancel('s1', 'zzz'), (e) => e.code === 'not-found')
  })

  it('AC-003-2: 複数の指示は、送った順に 1 件ずつ渡される。前の指示のターンが終わるまで次は渡さない', () => {
    hook('UserPromptSubmit', { prompt: 'x' })
    const a = ins.submit('s1', '一つ目')
    const b = ins.submit('s1', '二つ目')
    hook('Stop')
    assert.equal(ins.take('s1').id, a.id)
    assert.equal(ins.take('s1'), null, '1 件目が済むまで 2 件目は渡さない')
    // 1 件目が届き、セッションが作業を始めて、終わって返答待ちに戻る
    clock.t += 100
    assert.ok(ins.observe('s1', a.id, 'confirmed'))
    assert.equal(ins.take('s1'), null, 'ターンが終わるまでは渡さない')
    clock.t += 100
    hook('UserPromptSubmit', { prompt: '一つ目' })
    clock.t += 1000
    ready.length = 0
    hook('Stop')
    assert.ok(ready.includes('s1'))
    assert.equal(ins.take('s1').id, b.id)
  })

  it('AC-003-4: セッションが閉じられたら、保留中の指示は破棄され「失われました」になる', () => {
    hook('UserPromptSubmit', { prompt: 'x' })
    const a = ins.submit('s1', '一つ目')
    hook('SessionEnd')
    assert.equal(ins.take('s1'), null)
    assert.equal(statuses().at(-1), `${a.id}:lost`)
    assert.equal(changes.at(-1).reason, 'セッションが終了しました')
  })
})

describe('結果（AC-002-6, AC-002-8）', () => {
  const deliver = () => {
    const r = ins.submit('s1', 'やって')
    ins.take('s1')
    return r.id
  }

  it('AC-002-6: 通知できた → sent、会話ログで確認できた → confirmed', () => {
    const id = deliver()
    ins.report('s1', [{ id, ok: true }])
    assert.equal(statuses().at(-1), `${id}:sent`)
    assert.ok(ins.observe('s1', id, 'confirmed'))
    assert.equal(statuses().at(-1), `${id}:confirmed`)
  })

  it('AC-002-6: 通知より先に会話ログで確認できても confirmed になる（結果の報告は遅れてよい）', () => {
    const id = deliver()
    assert.ok(ins.observe('s1', id, 'confirmed'))
    ins.report('s1', [{ id, ok: true }])
    assert.equal(statuses().at(-1), `${id}:confirmed`)
  })

  it('AC-002-6: 通知に失敗したら failed（理由つき）。次の指示は待たない', () => {
    const id = deliver()
    const next = ins.submit('s1', '次')
    ins.report('s1', [{ id, ok: false, error: 'boom' }])
    const failed = changes.find((c) => c.id === id && c.status === 'failed')
    assert.equal(failed.reason, 'boom')
    assert.equal(ins.take('s1').id, next.id)
  })

  it('AC-005-3: 作業中に重なって扱われなかった指示は missed', () => {
    const id = deliver()
    ins.report('s1', [{ id, ok: true }])
    assert.ok(ins.observe('s1', id, 'missed'))
    assert.equal(statuses().at(-1), `${id}:missed`)
  })

  it('AC-002-8: 渡して 15 秒たっても確認できなければ unconfirmed。それまでは変わらない', () => {
    const id = deliver()
    ins.report('s1', [{ id, ok: true }])
    clock.t += 14_999
    ins.tick()
    assert.equal(statuses().at(-1), `${id}:sent`)
    clock.t += 2
    ins.tick()
    assert.equal(statuses().at(-1), `${id}:unconfirmed`)
    assert.equal(ins.observe('s1', id, 'confirmed'), false, '終わった指示は変わらない')
  })

  it('AC-002-8: 確認できなかった指示のあとも、次の指示は渡せる', () => {
    const id = deliver()
    const next = ins.submit('s1', '次')
    assert.equal(ins.take('s1'), null)
    clock.t += 15_001
    ins.tick()
    assert.ok(ready.includes('s1'))
    assert.equal(ins.take('s1').id, next.id)
    assert.ok(id)
  })

  it('他のセッションの指示の結果は反映しない', () => {
    setup('s2')
    const id = deliver()
    ins.report('s2', [{ id, ok: true }])
    assert.equal(statuses().at(-1), `${id}:delivering`)
    assert.equal(ins.observe('s2', id, 'confirmed'), false)
  })

  it('渡した指示は会話ログの確認対象になる。確認できたら外れる', () => {
    store.applyHookEvent({ event: 'UserPromptSubmit', account: 'A', input: { session_id: 's1', transcript_path: 'T:\\s1.jsonl', prompt: 'x' } })
    hook('Stop')
    const id = deliver()
    assert.deepEqual(ins.watchTargets(), [{ sessionId: 's1', id, transcriptPath: 'T:\\s1.jsonl' }])
    ins.observe('s1', id, 'confirmed')
    assert.deepEqual(ins.watchTargets(), [])
  })

  it('終わった指示の記録は keepMs（60 秒）で消える', () => {
    const id = deliver()
    ins.observe('s1', id, 'confirmed')
    clock.t += 61_000
    ins.tick()
    assert.equal(ins.observe('s1', id, 'missed'), false)
    assert.throws(() => ins.cancel('s1', id), (e) => e.code === 'not-found')
  })
})
