import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findInterruption } from '../src/hub/transcript.mjs'

// 実機の会話ログ（2026-10-08 取得）の形に合わせたサンプル。不要な項目は省略している
const userText = (text, timestamp) =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, timestamp })
const toolResult = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', content: 'User rejected tool use', is_error: true, tool_use_id: 'x' }] },
  timestamp: '2026-10-08T00:54:53.270Z',
})

describe('findInterruption（ADR 0007）', () => {
  it('Esc による中断を見つけ、ログの時刻を返す', () => {
    const r = findInterruption(userText('[Request interrupted by user]', '2026-10-08T00:54:53.271Z') + '\n')
    assert.deepEqual(r, { at: Date.parse('2026-10-08T00:54:53.271Z') })
  })

  it('許可の拒否（for tool use）も同じ前方一致で見つける', () => {
    const text = [toolResult, userText('[Request interrupted by user for tool use]', '2026-10-08T00:39:16.680Z')].join('\n')
    assert.deepEqual(findInterruption(text), { at: Date.parse('2026-10-08T00:39:16.680Z') })
  })

  it('tool_result だけ（User rejected tool use）では判定しない', () => {
    assert.equal(findInterruption(toolResult), null)
  })

  it('通常の発言や、文中に含むだけの発言は判定しない', () => {
    assert.equal(findInterruption(userText('こんにちは', '2026-10-08T00:00:00Z')), null)
    assert.equal(findInterruption(userText('「[Request interrupted by user]」とは？', '2026-10-08T00:00:00Z')), null)
  })

  it('assistant の記録は判定しない', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
    assert.equal(findInterruption(line), null)
  })

  it('content が文字列の形式でも判定できる', () => {
    const line = JSON.stringify({ type: 'user', message: { content: '[Request interrupted by user]' }, timestamp: '2026-10-08T00:00:00Z' })
    assert.notEqual(findInterruption(line), null)
  })

  it('壊れた行・途中で切れた行・空は無視して null を返す', () => {
    assert.equal(findInterruption('{"type":"user","mess'), null)
    assert.equal(findInterruption('not json\n\n'), null)
    assert.equal(findInterruption(''), null)
    assert.equal(findInterruption(undefined), null)
  })

  it('壊れた行が混じっていても、他の行の記録は見つける', () => {
    const text = ['garbage', userText('[Request interrupted by user]', '2026-10-08T00:00:01Z')].join('\n')
    assert.notEqual(findInterruption(text), null)
  })

  it('時刻がないときは at を null にする。複数あれば最後のものを返す', () => {
    assert.deepEqual(findInterruption(userText('[Request interrupted by user]', undefined)), { at: null })
    const text = [
      userText('[Request interrupted by user]', '2026-10-08T00:00:01Z'),
      userText('[Request interrupted by user for tool use]', '2026-10-08T00:00:09Z'),
    ].join('\n')
    assert.equal(findInterruption(text).at, Date.parse('2026-10-08T00:00:09Z'))
  })
})
