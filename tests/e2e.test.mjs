// 実際に hook.mjs / channel.mjs のプロセスを起動し、Hub との間で通ることを確認する
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHub } from '../src/hub/hub.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ACCOUNT = 'C:\\Users\\yuya\\.claude-e2e'

let hub, env
before(async () => {
  hub = createHub({ statusMonitor: null, config: { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 2000, expireMs: 5000 } })
  const ports = await hub.start()
  env = {
    ...process.env,
    CODERS_HUB_INTERNAL_PORT: String(ports.internalPort),
    CODERS_HUB_UI_PORT: String(ports.uiPort),
    CLAUDE_CONFIG_DIR: ACCOUNT,
  }
})
after(() => hub.stop())

const until = async (fn, timeout = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await sleep(25)
  }
  return false
}

const runHook = (input, extraEnv = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/hook/hook.mjs'], { cwd: root, env: { ...env, ...extraEnv } })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    const t0 = Date.now()
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - t0 }))
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
  })

describe('hook.mjs', () => {
  it('AC-001-1: フックの入力が Hub に届き、アカウントつきで登録される', async () => {
    const r = await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'e1', cwd: 'D:\\p', prompt: 'hi', transcript_path: 'D:\\t' })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    const s = hub.store.get('e1')
    assert.equal(s.state, 'working')
    assert.equal(s.account, ACCOUNT)
    assert.equal(s.lastPrompt, 'hi')
  })

  it('Hub が落ちていても、黙って終了コード 0 で終わる', async () => {
    const r = await runHook({ hook_event_name: 'Stop', session_id: 'e2' }, { CODERS_HUB_INTERNAL_PORT: '1' })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.ok(r.ms < 3500)
  })

  it('壊れた入力でも終了コード 0', async () => {
    const r = await runHook('not json')
    assert.equal(r.code, 0)
  })
})

describe('channel.mjs', () => {
  it('AC-001-5: 起動すると登録され、stdin が閉じる（claude の終了）と一覧から外れて終了する', async () => {
    const child = spawn(process.execPath, ['src/channel/channel.mjs'], {
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: 'c1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)))

    assert.ok(await until(() => hub.store.get('c1')?.channelAlive), '登録されない')
    assert.equal(hub.store.get('c1').account, ACCOUNT)

    const t0 = Date.now()
    child.stdin.end() // claude が終了したときと同じ
    assert.equal(await exited, 0)
    assert.ok(await until(() => hub.store.get('c1') === null), '外れない')
    assert.ok(Date.now() - t0 < 2000)
  })

  it('AC-001-5: プロセスを強制終了しても、/poll の切断で外れる', async () => {
    const child = spawn(process.execPath, ['src/channel/channel.mjs'], {
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: 'c2' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    assert.ok(await until(() => hub.store.get('c2')?.channelAlive), '登録されない')
    child.kill('SIGKILL')
    assert.ok(await until(() => hub.store.get('c2') === null, 3000), '外れない')
  })

  it('セッション ID がなければ登録しない（MCP サーバーとして待機するだけ）', async () => {
    const e = { ...env }
    delete e.CLAUDE_CODE_SESSION_ID
    const child = spawn(process.execPath, ['src/channel/channel.mjs'], { cwd: root, env: e, stdio: ['pipe', 'pipe', 'inherit'] })
    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)))
    await sleep(500)
    assert.equal(hub.store.list().filter((s) => s.sessionId === 'undefined' || s.sessionId === 'null').length, 0)
    child.stdin.end()
    assert.equal(await exited, 0)
  })
})
