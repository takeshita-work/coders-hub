// 接続部品（hook / channel）の単体テスト
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvent } from '../src/hook/payload.mjs'
import { startHubProcess, HUB_ENTRY } from '../src/shared/hub-client.mjs'
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

describe('startHubProcess（Hub の起動。start だけが使う。ADR 0020）', () => {
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
