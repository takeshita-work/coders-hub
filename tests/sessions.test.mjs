import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/hub/sessions.mjs'

const ACCOUNT = 'C:\\Users\\yuya\\.claude-a'
const hook = (event, extra = {}, session = 's1') => ({
  event,
  account: ACCOUNT,
  input: { session_id: session, cwd: 'D:\\proj', transcript_path: 'D:\\t.jsonl', ...extra },
})

let clock, store, changes
beforeEach(() => {
  clock = 1_000
  store = createStore({ now: () => clock, expireMs: 50_000 })
  changes = []
  store.subscribe((c) => changes.push(c))
})
const tick = (ms) => { clock += ms }

describe('状態遷移（plan.md の遷移表）', () => {
  it('AC-001-1: SessionStart で返答待ちとして登録される', () => {
    store.applyHookEvent(hook('SessionStart'))
    const s = store.get('s1')
    assert.equal(s.state, 'waiting')
    assert.equal(s.account, ACCOUNT)
    assert.equal(s.cwd, 'D:\\proj')
    assert.equal(changes[0].type, 'added')
  })

  it('UserPromptSubmit で作業中になり、直近の発言が入る', () => {
    store.applyHookEvent(hook('SessionStart'))
    tick(10)
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'こんにちは' }))
    const s = store.get('s1')
    assert.equal(s.state, 'working')
    assert.equal(s.lastPrompt, 'こんにちは')
    assert.equal(s.stateSince, 1_010)
  })

  it('PermissionRequest で許可待ち、PostToolUse で作業中へ戻る', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    store.applyHookEvent(hook('PermissionRequest'))
    assert.equal(store.get('s1').state, 'permission')
    store.applyHookEvent(hook('PostToolUse'))
    assert.equal(store.get('s1').state, 'working')
  })

  it('Stop で返答待ちになる', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    store.applyHookEvent(hook('Stop'))
    assert.equal(store.get('s1').state, 'waiting')
  })

  it('許可待ちの間の PreToolUse は状態を動かさない', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    store.applyHookEvent(hook('PermissionRequest'))
    store.applyHookEvent(hook('PreToolUse'))
    assert.equal(store.get('s1').state, 'permission')
  })

  it('作業中の PostToolUse は状態も stateSince も動かさない', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    tick(500)
    store.applyHookEvent(hook('PostToolUse'))
    assert.equal(store.get('s1').stateSince, 1_000)
  })

  it('Notification（idle_prompt）は状態を変えない', () => {
    store.applyHookEvent(hook('Stop'))
    const since = store.get('s1').stateSince
    tick(60_000)
    store.applyHookEvent(hook('Notification', { notification_type: 'idle_prompt' }))
    assert.equal(store.get('s1').state, 'waiting')
    assert.equal(store.get('s1').stateSince, since)
  })

  it('同じ状態への遷移は stateSince を更新しない', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'a' }))
    tick(100)
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'b' }))
    const s = store.get('s1')
    assert.equal(s.stateSince, 1_000)
    assert.equal(s.lastPrompt, 'b')
  })

  it('AC-008-2: 同じアカウント・同じ cwd でも sessionId ごとに別の行になる', () => {
    store.applyHookEvent(hook('SessionStart', {}, 's1'))
    store.applyHookEvent(hook('SessionStart', {}, 's2'))
    assert.equal(store.list().length, 2)
  })
})

describe('登録前後のイベントの順序', () => {
  it('SessionStart より先に PermissionRequest が届いても登録される', () => {
    store.applyHookEvent(hook('PermissionRequest'))
    assert.equal(store.get('s1').state, 'permission')
    store.applyHookEvent(hook('SessionStart'))
    assert.equal(store.get('s1').state, 'permission') // 既存の状態を上書きしない
  })

  it('未登録で PreToolUse／PostToolUse を受けたら作業中として登録する', () => {
    store.applyHookEvent(hook('PreToolUse', {}, 'a'))
    store.applyHookEvent(hook('PostToolUse', {}, 'b'))
    assert.equal(store.get('a').state, 'working')
    assert.equal(store.get('b').state, 'working')
  })

  it('session_id のないイベントは無視する', () => {
    store.applyHookEvent({ event: 'Stop', input: {} })
    assert.equal(store.list().length, 0)
  })

  it('未知のイベントは状態を動かさない', () => {
    store.applyHookEvent(hook('SessionStart'))
    store.applyHookEvent(hook('SomethingNew'))
    assert.equal(store.get('s1').state, 'waiting')
  })
})

describe('終了と生存確認', () => {
  it('AC-001-5: SessionEnd で外れ、遅れて届いたフックでは復活しない', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    store.applyHookEvent(hook('SessionEnd', { reason: 'prompt_input_exit' }))
    assert.equal(store.get('s1'), null)
    assert.deepEqual(changes.at(-1), { type: 'removed', sessionId: 's1' })
    store.applyHookEvent(hook('PostToolUse'))
    assert.equal(store.get('s1'), null)
  })

  it('閉じたあとでも SessionStart で再び登録できる', () => {
    store.applyHookEvent(hook('SessionEnd'))
    store.applyHookEvent(hook('SessionStart'))
    assert.equal(store.get('s1').state, 'waiting')
  })

  it('AC-001-5: /poll の切断（強制終了）で即座に外れる', () => {
    store.registerChannel({ sessionId: 's1', account: ACCOUNT, cwd: 'D:\\proj' })
    store.channelGone('s1')
    assert.equal(store.get('s1'), null)
  })

  it('AC-001-5: 最後の /poll から 50 秒を過ぎると外れる（50 秒ちょうどは残る）', () => {
    store.registerChannel({ sessionId: 's1' })
    tick(50_000)
    assert.deepEqual(store.sweep(), [])
    tick(1)
    assert.deepEqual(store.sweep(), ['s1'])
    assert.equal(store.get('s1'), null)
  })

  it('/poll のたびに期限が延びる', () => {
    store.registerChannel({ sessionId: 's1' })
    tick(30_000)
    store.registerChannel({ sessionId: 's1' })
    tick(30_000)
    assert.deepEqual(store.sweep(), [])
  })

  it('チャネルを持たない（/poll の来ない）セッションは期限では外れない', () => {
    store.applyHookEvent(hook('SessionStart'))
    tick(10 * 60_000)
    assert.deepEqual(store.sweep(), [])
    assert.ok(store.get('s1'))
  })

  it('期限で外れたあとでも、/poll が再開すれば一覧に戻る', () => {
    store.registerChannel({ sessionId: 's1' })
    tick(60_000)
    store.sweep()
    store.registerChannel({ sessionId: 's1' })
    assert.ok(store.get('s1'))
  })

  it('AC-001-6: 本体の再起動後、/poll の自己情報から返答待ちとして復元される', () => {
    store.registerChannel({ sessionId: 's9', account: ACCOUNT, cwd: 'D:\\p2' })
    const s = store.get('s9')
    assert.equal(s.state, 'waiting')
    assert.equal(s.account, ACCOUNT)
    assert.equal(s.channelAlive, true)
  })

  it('チャネルの登録が後でも、フックの状態が保たれる', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    store.registerChannel({ sessionId: 's1', account: ACCOUNT })
    assert.equal(store.get('s1').state, 'working')
    assert.equal(store.get('s1').channelAlive, true)
  })
})

describe('変化の通知', () => {
  it('追加・更新・削除を購読者へ渡し、変化がなければ通知しない', () => {
    store.applyHookEvent(hook('SessionStart'))
    store.applyHookEvent(hook('Notification')) // 見える項目は変わらない
    store.registerChannel({ sessionId: 's1' }) // channelAlive が変わる
    store.registerChannel({ sessionId: 's1' }) // 変わらない
    store.applyHookEvent(hook('Stop')) // 同じ状態
    store.applyHookEvent(hook('SessionEnd'))
    assert.deepEqual(changes.map((c) => c.type), ['added', 'updated', 'removed'])
  })

  it('購読を解除できる。購読者が例外を投げても本体は動く', () => {
    const bad = store.subscribe(() => { throw new Error('boom') })
    store.applyHookEvent(hook('SessionStart'))
    assert.equal(changes.length, 1)
    bad()
    store.applyHookEvent(hook('Stop', {}, 's2'))
    assert.equal(changes.length, 2)
  })
})

describe('中断・拒否の反映（ADR 0007）', () => {
  it('許可待ち・作業中のセッションを返答待ちへ戻し、stateSince をログの時刻にする', () => {
    store.applyHookEvent(hook('PermissionRequest'))
    assert.equal(store.applyInterruption('s1', 1_900), true)
    const s = store.get('s1')
    assert.equal(s.state, 'waiting')
    assert.equal(s.stateSince, 1_900)
  })

  it('時刻が不明なら現在時刻を使う', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    tick(5_000)
    store.applyInterruption('s1')
    assert.equal(store.get('s1').stateSince, 6_000)
  })

  it('今の状態になる前の記録は無視する', () => {
    tick(1_000)
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' })) // stateSince 2000
    assert.equal(store.applyInterruption('s1', 1_500), false)
    assert.equal(store.get('s1').state, 'working')
  })

  it('返答待ち・未登録のセッションには何もしない', () => {
    store.applyHookEvent(hook('Stop'))
    assert.equal(store.applyInterruption('s1', 5_000), false)
    assert.equal(store.applyInterruption('nope', 5_000), false)
  })

  it('確認の対象は許可待ち・作業中で、transcript_path があるものだけ', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }, 'w'))
    store.applyHookEvent(hook('Stop', {}, 'idle'))
    store.registerChannel({ sessionId: 'restored' }) // transcript_path 不明・返答待ち
    assert.deepEqual(store.monitorTargets().map((t) => t.sessionId), ['w'])
  })

  it('中断を反映したあとは確認の対象から外れる', () => {
    store.applyHookEvent(hook('PermissionRequest'))
    store.applyInterruption('s1', 1_900)
    assert.deepEqual(store.monitorTargets(), [])
  })
})
