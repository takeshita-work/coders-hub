import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/shared/config.mjs'

describe('loadConfig', () => {
  it('既定値を返す', () => {
    const c = loadConfig({})
    assert.equal(c.internalPort, 8765)
    assert.equal(c.uiPort, 8766)
    assert.equal(c.pollTimeoutMs, 30_000)
    assert.equal(c.expireMs, 50_000) // NFR-006: 30 秒の周期を超え、1 分以内
  })

  it('環境変数で上書きできる', () => {
    assert.equal(loadConfig({ CODERS_HUB_UI_PORT: '9000' }).uiPort, 9000)
  })

  it('不正な値は拒否する', () => {
    assert.throws(() => loadConfig({ CODERS_HUB_UI_PORT: 'abc' }))
    assert.throws(() => loadConfig({ CODERS_HUB_UI_PORT: '0' }))
  })
})
