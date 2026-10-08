// 接続部品（hook / channel）の単体テスト
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvent } from '../src/hook/payload.mjs'
import { ensureHub, startHubProcess, HUB_ENTRY } from '../src/shared/hub-client.mjs'
import { buildHooksConfig, HOOK_EVENTS } from '../src/setup/hooks-config.mjs'

describe('buildEvent（hook.mjs が送る内容）', () => {
  const base = { hook_event_name: 'PostToolUse', session_id: 's1', cwd: 'D:\\p', transcript_path: 'D:\\t.jsonl' }

  it('イベント名・アカウント・必要な項目だけを送る', () => {
    const body = buildEvent(
      { ...base, tool_name: 'Write', tool_input: { content: 'x'.repeat(10_000_000) }, tool_response: 'y' },
      { CLAUDE_CONFIG_DIR: 'C:\\acc' },
    )
    assert.equal(body.event, 'PostToolUse')
    assert.equal(body.account, 'C:\\acc')
    assert.deepEqual(body.input, { session_id: 's1', cwd: 'D:\\p', transcript_path: 'D:\\t.jsonl', tool_name: 'Write' })
    assert.ok(JSON.stringify(body).length < 1000) // Hub の本文上限（1MB）を超えない
  })

  it('長いプロンプトは切り詰める', () => {
    const body = buildEvent({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'あ'.repeat(5000) }, {})
    assert.equal(body.input.prompt.length, 2000)
    assert.equal(body.account, null)
  })

  it('SessionEnd の reason・Notification の種類を引き継ぐ', () => {
    assert.equal(buildEvent({ ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, {}).input.reason, 'prompt_input_exit')
    assert.equal(buildEvent({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }, {}).input.notification_type, 'idle_prompt')
  })

  it('イベント名や session_id がない・壊れた入力は null', () => {
    assert.equal(buildEvent({ session_id: 's' }), null)
    assert.equal(buildEvent({ hook_event_name: 'Stop' }), null)
    assert.equal(buildEvent(null), null)
    assert.equal(buildEvent('x'), null)
  })
})

describe('ensureHub（Hub の自動起動。NFR-005）', () => {
  const config = { host: '127.0.0.1', internalPort: 1 }
  const noWait = async () => {}

  it('すでに動いていれば起動しない', async () => {
    let spawned = 0
    const ok = await ensureHub(config, { up: async () => true, spawnHub: () => spawned++, wait: noWait })
    assert.equal(ok, true)
    assert.equal(spawned, 0)
  })

  it('動いていなければ 1 回起動し、立ち上がるまで待つ', async () => {
    let spawned = 0
    let checks = 0
    const ok = await ensureHub(config, { up: async () => ++checks > 4, spawnHub: () => spawned++, wait: noWait })
    assert.equal(ok, true)
    assert.equal(spawned, 1)
  })

  it('立ち上がらなければ false（待ち続けない）', async () => {
    const ok = await ensureHub(config, { up: async () => false, spawnHub: () => {}, wait: noWait, waitMs: 1000, intervalMs: 100 })
    assert.equal(ok, false)
  })

  it('起動に失敗しても例外にしない', async () => {
    const ok = await ensureHub(config, { up: async () => false, spawnHub: () => { throw new Error('x') }, wait: noWait })
    assert.equal(ok, false)
  })

  it('startHubProcess は main.mjs を切り離して起動し、CLAUDE* の環境変数を引き継がない', () => {
    let call
    startHubProcess((cmd, args, opts) => { call = { cmd, args, opts }; return { unref() {}, on() {} } }, {
      PATH: 'p', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CONFIG_DIR: 'c', CODERS_HUB_UI_PORT: '9',
    })
    assert.deepEqual(call.args, [HUB_ENTRY])
    assert.equal(call.opts.detached, true)
    assert.equal(call.opts.stdio, 'ignore')
    assert.deepEqual(call.opts.env, { PATH: 'p', CODERS_HUB_UI_PORT: '9' })
  })
})

describe('buildHooksConfig（settings.json に追加する設定）', () => {
  it('状態を動かすフックだけを、非同期で hook.mjs につなぐ', () => {
    const { hooks } = buildHooksConfig('D:\\a\\#b\\src\\hook\\hook.mjs')
    assert.deepEqual(Object.keys(hooks), HOOK_EVENTS)
    assert.ok(!('PreToolUse' in hooks) && !('Notification' in hooks))
    const h = hooks.Stop[0].hooks[0]
    assert.equal(h.async, true)
    assert.equal(h.command, 'node "D:/a/#b/src/hook/hook.mjs"')
  })
})
