// 質問用フック（機能 003、ADR 0014）。AC-004-9, 004-11
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHub } from '../src/hub/hub.mjs'
import { answersFromResponse, buildAnswerOutput } from '../src/hook/answer.mjs'
import { buildHooksConfig, ASK_HOOK_TIMEOUT_SEC } from '../src/setup/hooks-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const colorQuestion = {
  question: '好きな色は？',
  header: '色',
  options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
  multiSelect: false,
}
const toolInput = { questions: [colorQuestion] }

describe('buildAnswerOutput / answersFromResponse', () => {
  it('実機で確認した形: allow ＋ 元の入力に answers を足した updatedInput', () => {
    const answers = { '好きな色は？': '青' }
    assert.deepEqual(buildAnswerOutput(toolInput, answers), {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedInput: { questions: [colorQuestion], answers } },
      },
    })
  })

  it('元の入力を書き換えない', () => {
    buildAnswerOutput(toolInput, { a: 'b' })
    assert.equal('answers' in toolInput, false)
  })

  it('答えが取り出せるのは、200 で answers が 1 つ以上のオブジェクトのときだけ', () => {
    assert.deepEqual(answersFromResponse(200, { answers: { q: 'a' } }), { q: 'a' })
    for (const [status, body] of [[204, null], [200, null], [200, {}], [200, { answers: {} }], [200, { answers: [] }], [200, { answers: 'x' }], [400, { answers: { q: 'a' } }]]) {
      assert.equal(answersFromResponse(status, body), null, JSON.stringify([status, body]))
    }
  })
})

describe('buildHooksConfig（質問用フック）', () => {
  it('askHookPath を渡すと、PermissionRequest に AskUserQuestion 用の同期フックが足される。状態用の非同期フックはそのまま残る', () => {
    const { hooks } = buildHooksConfig('D:\\x\\hook.mjs', 'D:\\x\\ask-hook.mjs')
    const entries = hooks.PermissionRequest
    assert.equal(entries.length, 2)
    assert.equal(entries[0].hooks[0].async, true)
    assert.equal(entries[1].matcher, 'AskUserQuestion')
    const ask = entries[1].hooks[0]
    assert.equal(ask.command, 'node "D:/x/ask-hook.mjs"')
    assert.equal(ask.async, undefined, '同期でなければ答えを返せない')
    assert.equal(ask.timeout, ASK_HOOK_TIMEOUT_SEC)
    assert.ok(ASK_HOOK_TIMEOUT_SEC > 85, 'Hub の待ち時間（85 秒）より長い')
  })

  it('askHookPath を渡さなければ、これまでと同じ（質問用フックなし）', () => {
    assert.equal(buildHooksConfig('D:\\x\\hook.mjs').hooks.PermissionRequest.length, 1)
  })
})

// 本物の ask-hook.mjs を起動して、Hub との間で通ることを確認する
describe('ask-hook.mjs', () => {
  let hub, ports, env

  before(async () => {
    hub = createHub({
      statusMonitor: null, instructionMonitor: null, askWaitMs: 400, requestGraceMs: 50,
      config: { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 },
    })
    ports = await hub.start()
    env = { ...process.env, CODERS_HUB_INTERNAL_PORT: String(ports.internalPort), CODERS_HUB_UI_PORT: String(ports.uiPort), CODERS_HUB_ASK_WAIT_MS: '400' }
    // 操作モードのセッションを用意する
    await fetch(`http://127.0.0.1:${ports.internalPort}/poll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'k1', cwd: 'D:\\p', channel: true }),
    })
    hub.store.applyHookEvent({ event: 'UserPromptSubmit', input: { session_id: 'k1' } })
  })
  after(() => hub.stop())

  const run = (input, extraEnv = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['src/hook/ask-hook.mjs'], { cwd: root, env: { ...env, ...extraEnv } })
      let stdout = ''
      child.stdout.on('data', (d) => (stdout += d))
      const t0 = Date.now()
      child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - t0 }))
      child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
    })
  const askInput = (extra = {}) => ({
    hook_event_name: 'PermissionRequest', session_id: 'k1', tool_name: 'AskUserQuestion', tool_input: toolInput, ...extra,
  })
  const until = async (fn, ms = 2000) => {
    for (let w = 0; w < ms; w += 10) { if (fn()) return; await sleep(10) }
    assert.fail('待っても条件を満たしませんでした')
  }

  it('AC-004-9: ダッシュボードで答えが入ると、allow ＋ updatedInput.answers を標準出力に書いて終了コード 0', async () => {
    const running = run(askInput(), { CODERS_HUB_ASK_WAIT_MS: '5000' })
    await until(() => hub.store.get('k1').requests.length === 1)
    hub.requests.respond('k1', hub.store.get('k1').requests[0].id, { answers: { '好きな色は？': '青' } })
    const r = await running
    assert.equal(r.code, 0)
    assert.deepEqual(JSON.parse(r.stdout), buildAnswerOutput(toolInput, { '好きな色は？': '青' }))
  })

  it('AC-004-11: 答えがないまま時間が切れたら、何も出力せず終了コード 0。要求は閉じる', async () => {
    const r = await run(askInput())
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.ok(r.ms >= 350, '待ってから終わる')
    assert.deepEqual(hub.store.get('k1').requests, [])
  })

  it('Hub が動いていなければ、待たずに何も出力せず終了コード 0', async () => {
    const r = await run(askInput(), { CODERS_HUB_INTERNAL_PORT: '1' })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.ok(r.ms < 3000)
  })

  it('操作モードでない・不明なセッションは、待たずに何も出力しない', async () => {
    const r = await run(askInput({ session_id: 'unknown' }), { CODERS_HUB_ASK_WAIT_MS: '5000' })
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.ok(r.ms < 2000)
  })

  it('AskUserQuestion 以外のツールは何もしない（Hub に要求も出さない）', async () => {
    const r = await run(askInput({ tool_name: 'Bash', tool_input: { command: 'ls' } }))
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.ok(r.ms < 2000)
    assert.deepEqual(hub.store.get('k1').requests, [])
  })

  it('壊れた入力でも終了コード 0', async () => {
    const r = await run('not json')
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
  })

  it('AC-005-7: ターミナルで先に答えられた（作業中に戻る）ら、何も出力せず終了する', async () => {
    const running = run(askInput(), { CODERS_HUB_ASK_WAIT_MS: '5000' })
    await until(() => hub.store.get('k1').requests.length === 1)
    hub.store.applyHookEvent({ event: 'PermissionRequest', input: { session_id: 'k1', tool_name: 'AskUserQuestion' } })
    await sleep(80)
    hub.requests.toolDone('k1', 'AskUserQuestion')
    const r = await running
    assert.equal(r.stdout, '')
    assert.equal(r.code, 0)
  })
})
