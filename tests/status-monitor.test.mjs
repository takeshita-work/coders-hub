// claude 自身の状態ファイル（sessions/<pid>.json）の反映（ADR 0009）。ストアの判定と、実ファイルの読み取りを確認する
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/hub/sessions.mjs'
import { createStatusMonitor, sessionsDirOf } from '../src/hub/status-monitor.mjs'

const ACCOUNT = 'C:\\Users\\yuya\\.claude-a'
const hook = (event, extra = {}, session = 's1') => ({
  event, account: ACCOUNT, input: { session_id: session, cwd: 'D:\\proj', transcript_path: 'D:\\t.jsonl', ...extra },
})

describe('applyStatus（ストアの判定）', () => {
  let clock, store, changes
  beforeEach(() => {
    clock = 1_000
    store = createStore({ now: () => clock })
    changes = []
    store.subscribe((c) => changes.push(c))
  })

  it('作業中のまま残った状態を、より新しい idle で返答待ちに直す（通常の作業中の Esc）', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    assert.equal(store.applyStatus('s1', { status: 'idle', at: 5_000 }), true)
    const s = store.get('s1')
    assert.equal(s.state, 'waiting')
    assert.equal(s.stateSince, 5_000)
  })

  it('フックの状態より古い status は採用しない（フックの方が新しい）', () => {
    clock += 1_000
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' })) // stateSince 2000
    assert.equal(store.applyStatus('s1', { status: 'idle', at: 1_500 }), false)
    assert.equal(store.get('s1').state, 'working')
  })

  it('同じ状態・時刻が不明・stateSince と同時刻の status では動かさない', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    assert.equal(store.applyStatus('s1', { status: 'busy', at: 9_999 }), false)
    assert.equal(store.applyStatus('s1', { status: 'idle', at: null }), false)
    assert.equal(store.applyStatus('s1', { status: 'idle', at: 1_000 }), false)
    assert.equal(store.get('s1').state, 'working')
  })

  it('未知の status・未登録のセッションは無視する', () => {
    store.applyHookEvent(hook('Stop'))
    assert.equal(store.applyStatus('s1', { status: 'unknown', at: 9_000 }), false)
    assert.equal(store.applyStatus('nope', { status: 'busy', at: 9_000 }), false)
    assert.equal(store.applyStatus('s1', {}), false)
  })

  it('許可待ち（waiting）は許可待ちとして扱い、busy で作業中に戻す', () => {
    store.applyHookEvent(hook('Stop'))
    store.applyStatus('s1', { status: 'waiting', at: 3_000 })
    assert.equal(store.get('s1').state, 'permission')
    store.applyStatus('s1', { status: 'busy', at: 4_000 })
    assert.equal(store.get('s1').state, 'working')
  })

  it('AC-001-6: 再起動後に仮置きした状態を、実際の状態と「いつから」で置き換える', () => {
    store.registerChannel({ sessionId: 'r1', account: ACCOUNT }) // 返答待ちと仮置き（clock = 1000）
    store.applyStatus('r1', { status: 'busy', at: 400 })
    const s = store.get('r1')
    assert.equal(s.state, 'working')
    assert.equal(s.stateSince, 400)
  })

  it('仮置きと同じ状態でも、いつからかを実際の時刻に直す。確定したら古い status では動かさない', () => {
    store.registerChannel({ sessionId: 'r2' })
    store.applyStatus('r2', { status: 'idle', at: 200 })
    assert.equal(store.get('r2').state, 'waiting')
    assert.equal(store.get('r2').stateSince, 200)
    assert.equal(store.applyStatus('r2', { status: 'busy', at: 100 }), false)
    assert.equal(store.get('r2').state, 'waiting')
  })

  it('フックで状態が確定したセッションは、仮置き扱いにならない', () => {
    store.registerChannel({ sessionId: 's1' })
    store.applyHookEvent(hook('Stop')) // 確定
    assert.equal(store.applyStatus('s1', { status: 'busy', at: 100 }), false)
    assert.equal(store.get('s1').state, 'waiting')
  })

  it('変化は購読者へ通知される', () => {
    store.applyHookEvent(hook('UserPromptSubmit', { prompt: 'x' }))
    changes.length = 0
    store.applyStatus('s1', { status: 'idle', at: 5_000 })
    assert.deepEqual(changes.map((c) => c.type), ['updated'])
  })
})

describe('createStatusMonitor（実ファイルの読み取り）', () => {
  let root, account, store, monitor, clock
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-status-')) })
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  beforeEach(() => {
    account = fs.mkdtempSync(path.join(root, 'acc-'))
    fs.mkdirSync(path.join(account, 'sessions'))
    clock = 10_000
    store = createStore({ now: () => clock })
    monitor = createStatusMonitor({ store, home: root })
  })

  const writeStatus = (pid, sessionId, status, at, extra = {}) =>
    fs.writeFileSync(path.join(account, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, status, statusUpdatedAt: at, updatedAt: at, ...extra }))
  const start = (id, event = 'UserPromptSubmit') =>
    store.applyHookEvent({ event, account, input: { session_id: id, prompt: 'x' } })

  it('作業中のまま残ったセッションを、idle の状態ファイルで返答待ちへ直す（通常の作業中の Esc）', async () => {
    start('s1')
    writeStatus(100, 's1', 'idle', clock + 5_000)
    await monitor.tick()
    assert.equal(store.get('s1').state, 'waiting')
  })

  it('他のセッションの状態ファイルには影響されない', async () => {
    start('s1')
    writeStatus(100, 's1', 'busy', clock + 1_000)
    writeStatus(101, 'other', 'idle', clock + 5_000)
    await monitor.tick()
    assert.equal(store.get('s1').state, 'working')
    assert.equal(store.get('other'), null)
  })

  it('許可待ち（waiting / permission prompt）を反映する', async () => {
    start('s1', 'Stop')
    writeStatus(100, 's1', 'waiting', clock + 1_000, { waitingFor: 'permission prompt' })
    await monitor.tick()
    assert.equal(store.get('s1').state, 'permission')
  })

  it('壊れた JSON・status のないファイル・フォルダがない場合も例外にならず、何も変えない', async () => {
    start('s1')
    fs.writeFileSync(path.join(account, 'sessions', '1.json'), '{"sessionId":"s1","sta')
    fs.writeFileSync(path.join(account, 'sessions', '2.json'), JSON.stringify({ sessionId: 's1' }))
    fs.writeFileSync(path.join(account, 'sessions', 'note.txt'), 'x')
    await monitor.tick()
    assert.equal(store.get('s1').state, 'working')

    store.applyHookEvent({ event: 'UserPromptSubmit', account: path.join(root, 'no-such-dir'), input: { session_id: 's2', prompt: 'y' } })
    await monitor.tick()
    assert.equal(store.get('s2').state, 'working')
  })

  it('アカウント不明のセッションは、既定の <home>/.claude/sessions を見る', () => {
    assert.equal(sessionsDirOf(null, '/h'), path.join('/h', '.claude', 'sessions'))
    assert.equal(sessionsDirOf('C:\\acc', '/h'), path.join('C:\\acc', 'sessions'))
  })

  it('AC-001-6: 再起動後に仮置きしたセッションを、実際の状態で置き換える', async () => {
    store.registerChannel({ sessionId: 'r1', account })
    writeStatus(100, 'r1', 'busy', clock - 3_000)
    await monitor.tick()
    const s = store.get('r1')
    assert.equal(s.state, 'working')
    assert.equal(s.stateSince, clock - 3_000)
  })
})
