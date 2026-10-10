// 導入用の設定の生成（機能 002 の操作モード、ADR 0011）
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildMcpConfig, CHANNEL_FLAG, SERVER_NAME } from '../src/setup/mcp-config.mjs'
import { buildHooksConfig, HOOK_EVENTS } from '../src/setup/hooks-config.mjs'

describe('buildMcpConfig', () => {
  const p = 'D:\\organization\\works\\#tools\\coders-hub\\src\\channel\\channel.mjs'

  it('一覧だけのモードは、引数なし。パスの区切りは / にそろえる', () => {
    const entry = buildMcpConfig(p).mcpServers[SERVER_NAME]
    assert.equal(entry.command, 'node')
    assert.deepEqual(entry.args, ['D:/organization/works/#tools/coders-hub/src/channel/channel.mjs'])
  })

  it('操作モードは、--channel が付く。サーバーの名前は同じ（開発用フラグの server: と一致する）', () => {
    const config = buildMcpConfig(p, { channel: true })
    assert.deepEqual(Object.keys(config.mcpServers), [SERVER_NAME])
    assert.equal(config.mcpServers[SERVER_NAME].args.at(-1), '--channel')
    assert.equal(CHANNEL_FLAG, `--dangerously-load-development-channels server:${SERVER_NAME}`)
  })
})

describe('buildHooksConfig', () => {
  it('状態を動かす 6 つのフックを、非同期で登録する', () => {
    const { hooks } = buildHooksConfig('D:\\x\\hook.mjs')
    assert.deepEqual(Object.keys(hooks), HOOK_EVENTS)
    for (const event of HOOK_EVENTS) assert.equal(hooks[event][0].hooks[0].async, true)
  })
})
