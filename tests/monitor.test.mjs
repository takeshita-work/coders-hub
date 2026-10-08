// 会話ログの定期確認（ADR 0007）。実際のファイルに追記して、検知と非検知を確認する
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStore } from '../src/hub/sessions.mjs'
import { createTranscriptMonitor } from '../src/hub/monitor.mjs'

let dir, file, clock, store, monitor
before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-mon-')) })
after(() => fs.rmSync(dir, { recursive: true, force: true }))

const line = (text, timestamp) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, timestamp }) + '\n'
const interrupt = (at) => line('[Request interrupted by user for tool use]', new Date(at).toISOString())

beforeEach(() => {
  file = path.join(dir, `t-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(file, line('最初の発言', '2026-10-08T00:00:00Z'))
  clock = Date.parse('2026-10-08T01:00:00Z')
  store = createStore({ now: () => clock })
  monitor = createTranscriptMonitor({ store })
})

const start = (event, extra = {}) =>
  store.applyHookEvent({ event, input: { session_id: 's1', transcript_path: file, ...extra } })

describe('createTranscriptMonitor', () => {
  it('許可待ちのセッションの拒否を検知し、返答待ちへ戻す', async () => {
    start('PermissionRequest')
    await monitor.tick() // 起点を決める
    clock += 1_800
    fs.appendFileSync(file, interrupt(clock))
    await monitor.tick()
    const s = store.get('s1')
    assert.equal(s.state, 'waiting')
    assert.equal(s.stateSince, clock)
  })

  it('確認を始める前から会話ログにあった記録は見ない', async () => {
    fs.appendFileSync(file, interrupt(Date.parse('2026-10-08T00:30:00Z')))
    start('UserPromptSubmit', { prompt: 'x' })
    await monitor.tick()
    await monitor.tick()
    assert.equal(store.get('s1').state, 'working')
  })

  it('途中まで書かれた行は、書き終わってから判定する', async () => {
    start('UserPromptSubmit', { prompt: 'x' })
    await monitor.tick()
    const full = interrupt(clock + 100)
    fs.appendFileSync(file, full.slice(0, 30))
    await monitor.tick()
    assert.equal(store.get('s1').state, 'working')
    clock += 100
    fs.appendFileSync(file, full.slice(30))
    await monitor.tick()
    assert.equal(store.get('s1').state, 'waiting')
  })

  it('返答待ちのセッションは確認しない（記録があっても状態は変わらない）', async () => {
    start('Stop')
    await monitor.tick()
    fs.appendFileSync(file, interrupt(clock + 10))
    await monitor.tick()
    assert.equal(store.get('s1').state, 'waiting')
    assert.equal(store.get('s1').stateSince, clock)
  })

  it('ファイルが読めなくても例外にならず、状態も変えない', async () => {
    store.applyHookEvent({ event: 'PermissionRequest', input: { session_id: 's1', transcript_path: path.join(dir, 'none.jsonl') } })
    await monitor.tick()
    assert.equal(store.get('s1').state, 'permission')
  })

  it('許可待ち → 作業中 → 許可待ちの間も、確認を続けて検知できる', async () => {
    start('PermissionRequest')
    await monitor.tick()
    start('PostToolUse')
    start('PermissionRequest')
    clock += 2_000
    fs.appendFileSync(file, interrupt(clock))
    await monitor.tick()
    assert.equal(store.get('s1').state, 'waiting')
  })
})
