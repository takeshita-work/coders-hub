import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { configFilePath, loadConfig } from '../src/shared/config.mjs'

const enoent = () => Object.assign(new Error('no such file'), { code: 'ENOENT' })
const withFile = (text) => ({ readFile: () => text })

describe('loadConfig', () => {
  it('既定値を返す', () => {
    const c = loadConfig({})
    assert.equal(c.internalPort, 47765)
    assert.equal(c.uiPort, 47766)
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

// AC-011-15〜19（機能 007 の追補、REQ-011、ADR 0019）
describe('loadConfig: 設定ファイル（config.json）', () => {
  const env = { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' }

  it('AC-011-15: 設定ファイルのポートを使う', () => {
    const c = loadConfig(env, withFile('{ "internalPort": 40001, "uiPort": 40002 }'))
    assert.equal(c.internalPort, 40001)
    assert.equal(c.uiPort, 40002)
  })

  it('AC-011-15: キーは省略できる。省略したほうは既定値。他のキーは無視する', () => {
    const c = loadConfig(env, withFile('{ "uiPort": 40002, "other": 1 }'))
    assert.equal(c.internalPort, 47765)
    assert.equal(c.uiPort, 40002)
  })

  it('AC-011-16: 環境変数は、設定ファイルより優先する', () => {
    const c = loadConfig({ ...env, CODERS_HUB_UI_PORT: '9000' }, withFile('{ "uiPort": 40002, "internalPort": 40001 }'))
    assert.equal(c.uiPort, 9000)
    assert.equal(c.internalPort, 40001)
  })

  it('AC-011-17: ファイルがなければ、既定値を使う', () => {
    const c = loadConfig(env, { readFile: () => { throw enoent() } })
    assert.equal(c.uiPort, 47766)
  })

  it('AC-011-18: 壊れた JSON・不正なポート・オブジェクトでない内容は、ファイルのパスを入れたエラーにする', () => {
    const file = 'C:\\Users\\dev\\AppData\\Roaming\\coders-hub\\config.json'
    assert.throws(() => loadConfig(env, withFile('{ broken')), (e) => e.message.includes(file))
    assert.throws(() => loadConfig(env, withFile('{ "uiPort": "abc" }')), (e) => e.message.includes(file))
    assert.throws(() => loadConfig(env, withFile('{ "uiPort": 70000 }')), (e) => e.message.includes('uiPort'))
    assert.throws(() => loadConfig(env, withFile('[1]')), (e) => e.message.includes(file))
  })

  it('読めないファイル（権限など）は、エラーにする', () => {
    assert.throws(() => loadConfig(env, { readFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) } }), /設定ファイルを読めません/)
  })

  it('AC-011-19: 設定ファイルのパス: CODERS_HUB_CONFIG > %APPDATA%\\coders-hub\\config.json。どちらもなければ読まない', () => {
    assert.equal(configFilePath({ CODERS_HUB_CONFIG: 'D:\\x\\c.json', APPDATA: 'C:\\A' }), 'D:\\x\\c.json')
    assert.match(configFilePath({ APPDATA: 'C:\\A' }), /coders-hub[\\/]config\.json$/)
    assert.equal(configFilePath({}), null)
    let read = false
    loadConfig({}, { readFile: () => { read = true; return '{}' } })
    assert.equal(read, false)
  })
})
