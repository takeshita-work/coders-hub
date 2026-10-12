import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { configFilePath, loadConfig } from '../src/shared/config.mjs'

const enoent = () => Object.assign(new Error('no such file'), { code: 'ENOENT' })
// 配布版（exe）として、C:\Apps\coders-hub.exe の隣の config.json を読む想定（ADR 0021）
const EXE = { sea: true, execPath: 'C:\\Apps\\coders-hub.exe' }
const withFile = (text) => ({ ...EXE, readFile: () => text })

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

// AC-011-15〜19（機能 007 の追補、REQ-011、ADR 0019・0021）
describe('loadConfig: 設定ファイル（config.json）', () => {
  const file = 'C:\\Apps\\config.json'

  it('AC-011-15: 設定ファイルのポートを使う', () => {
    const c = loadConfig({}, withFile('{ "internalPort": 40001, "uiPort": 40002 }'))
    assert.equal(c.internalPort, 40001)
    assert.equal(c.uiPort, 40002)
  })

  it('AC-011-15: キーは省略できる。省略したほうは既定値。他のキーは無視する', () => {
    const c = loadConfig({}, withFile('{ "uiPort": 40002, "other": 1 }'))
    assert.equal(c.internalPort, 47765)
    assert.equal(c.uiPort, 40002)
  })

  it('AC-011-16: 環境変数は、設定ファイルより優先する', () => {
    const c = loadConfig({ CODERS_HUB_UI_PORT: '9000' }, withFile('{ "uiPort": 40002, "internalPort": 40001 }'))
    assert.equal(c.uiPort, 9000)
    assert.equal(c.internalPort, 40001)
  })

  it('AC-011-17: ファイルがなければ、既定値を使う', () => {
    const c = loadConfig({}, { ...EXE, readFile: () => { throw enoent() } })
    assert.equal(c.uiPort, 47766)
  })

  it('AC-011-18: 壊れた JSON・不正なポート・オブジェクトでない内容は、ファイルのパスを入れたエラーにする', () => {
    assert.throws(() => loadConfig({}, withFile('{ broken')), (e) => e.message.includes(file))
    assert.throws(() => loadConfig({}, withFile('{ "uiPort": "abc" }')), (e) => e.message.includes(file))
    assert.throws(() => loadConfig({}, withFile('{ "uiPort": 70000 }')), (e) => e.message.includes('uiPort'))
    assert.throws(() => loadConfig({}, withFile('[1]')), (e) => e.message.includes(file))
  })

  it('読めないファイル（権限など）は、エラーにする', () => {
    assert.throws(() => loadConfig({}, { ...EXE, readFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) } }), /設定ファイルを読めません/)
  })

  it('AC-011-19: 設定ファイルのパス: CODERS_HUB_CONFIG > exe と同じフォルダの config.json（配布版）。開発時（node）は CODERS_HUB_CONFIG のときだけ', () => {
    assert.equal(configFilePath({ CODERS_HUB_CONFIG: 'D:\\x\\c.json' }, EXE), 'D:\\x\\c.json')
    assert.equal(configFilePath({}, EXE), file)
    assert.equal(configFilePath({}, { sea: false, execPath: 'C:\\node\\node.exe' }), null)
    assert.equal(configFilePath({ CODERS_HUB_CONFIG: 'D:\\x\\c.json' }, { sea: false, execPath: 'node' }), 'D:\\x\\c.json')
  })

  it('AC-011-19: 開発時（node）は、既定ではファイルを読まない', () => {
    let read = false
    loadConfig({}, { sea: false, readFile: () => { read = true; return '{}' } })
    assert.equal(read, false)
  })
})
