// 会話ログから、渡した指示の扱いを判定する（機能 002）。実機の記録（2026-10-09）に基づく形で確認する。
// AC-002-6, AC-002-7, AC-005-3
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findDelivery } from '../src/hub/delivery.mjs'
import { createInstructionMonitor } from '../src/hub/instruction-monitor.mjs'
import { createStore } from '../src/hub/sessions.mjs'
import { createInstructions } from '../src/hub/instructions.mjs'

const tag = (id, body) => `<channel source="coders-hub" id="${id}">\n${body}\n</channel>`
const line = (o) => JSON.stringify(o) + '\n'

// 実機の記録の形: 返答待ちで届いた場合
const confirmedLog = (id) =>
  line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-09T13:10:06.773Z', content: tag(id, '本文') }) +
  line({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-10-09T13:10:06.781Z' }) +
  line({ type: 'user', origin: { kind: 'channel', server: 'coders-hub' }, message: { role: 'user', content: tag(id, '本文') } })

// 実機の記録の形: ツールを使う作業の途中に届いた場合（注意書きになる）
const missedLog = (id) =>
  line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-09T13:16:52.687Z', content: tag(id, '本文') }) +
  line({ type: 'queue-operation', operation: 'remove', timestamp: '2026-10-09T13:17:11.177Z', content: tag(id, '本文') }) +
  line({ type: 'attachment', attachment: { type: 'queued_command', prompt: tag(id, '本文'), origin: { kind: 'channel' } } })

describe('findDelivery', () => {
  it('AC-002-6: チャネルからのユーザー入力として記録されていたら confirmed', () => {
    assert.equal(findDelivery(confirmedLog('abc123'), 'abc123'), 'confirmed')
  })

  it('AC-005-3: enqueue のあと remove／queued_command なら missed', () => {
    assert.equal(findDelivery(missedLog('abc123'), 'abc123'), 'missed')
  })

  it('enqueue だけ（まだ処理されていない）なら null', () => {
    const text = line({ type: 'queue-operation', operation: 'enqueue', content: tag('abc123', '本文') })
    assert.equal(findDelivery(text, 'abc123'), null)
  })

  it('別の指示の記録は見ない', () => {
    assert.equal(findDelivery(confirmedLog('other1'), 'abc123'), null)
    assert.equal(findDelivery(missedLog('other1'), 'abc123'), null)
  })

  it('人が入力した記録（origin.kind: human）は、同じ文字列が入っていても confirmed にしない', () => {
    const text = line({ type: 'user', origin: { kind: 'human' }, message: { content: tag('abc123', '貼り付け') } })
    assert.equal(findDelivery(text, 'abc123'), null)
  })

  it('壊れた行・途中で切れた行・空の入力は無視する', () => {
    const text = '{"type":"user","origin":{"kind":"channel"},"message":{"content":"id=\\"abc123\\"' + '\n' + confirmedLog('abc123')
    assert.equal(findDelivery(text, 'abc123'), 'confirmed')
    assert.equal(findDelivery('', 'abc123'), null)
    assert.equal(findDelivery(undefined, 'abc123'), null)
  })

  it('処理された記録があれば、注意書きの記録より優先する', () => {
    assert.equal(findDelivery(missedLog('abc123') + confirmedLog('abc123'), 'abc123'), 'confirmed')
  })
})

describe('createInstructionMonitor', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-instr-'))
    const file = path.join(dir, 's1.jsonl')
    fs.writeFileSync(file, line({ type: 'user', message: { content: '前の記録' } }))
    let t = 1_000_000
    const store = createStore({ now: () => t })
    const ins = createInstructions({ store, now: () => t, newId: () => 'abc123', confirmMs: 15_000, onReady: () => {} })
    store.registerChannel({ sessionId: 's1', account: 'A', channel: true })
    store.applyHookEvent({ event: 'Stop', input: { session_id: 's1', transcript_path: file } })
    const monitor = createInstructionMonitor({ instructions: ins })
    const events = []
    ins.subscribe((c) => events.push(`${c.id}:${c.status}`))
    return { dir, file, ins, monitor, events, advance: (ms) => { t += ms } }
  }

  it('AC-002-7: 会話ログに処理された記録が出たら confirmed になる', async () => {
    const { dir, file, ins, monitor, events } = setup()
    try {
      ins.submit('s1', '本文')
      ins.take('s1')
      await monitor.tick()
      assert.equal(events.at(-1), 'abc123:delivering', 'まだ記録がない')
      fs.appendFileSync(file, confirmedLog('abc123'))
      await monitor.tick()
      assert.equal(events.at(-1), 'abc123:confirmed')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-005-3: 注意書きとして記録されたら missed になる', async () => {
    const { dir, file, ins, monitor, events } = setup()
    try {
      ins.submit('s1', '本文')
      ins.take('s1')
      fs.appendFileSync(file, missedLog('abc123'))
      await monitor.tick()
      assert.equal(events.at(-1), 'abc123:missed')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-002-8: 記録が見つからないまま 15 秒たつと unconfirmed になる。ログが読めなくても同じ', async () => {
    const { dir, file, ins, monitor, events, advance } = setup()
    try {
      ins.submit('s1', '本文')
      ins.take('s1')
      fs.rmSync(file) // 読めない
      advance(15_001)
      await monitor.tick()
      assert.equal(events.at(-1), 'abc123:unconfirmed')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
