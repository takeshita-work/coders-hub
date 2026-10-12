// 導入用の設定の生成（ADR 0026・0027）。文面そのものは、setup-flow.test.mjs が、setup-flow.md との一致で確かめる
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildMcpAddCommand, CHANNEL_FLAG, MCP_REMOVE_COMMAND, SERVER_NAME } from '../src/setup/mcp-config.mjs'
import { buildHooksConfig, HOOK_EVENTS } from '../src/setup/hooks-config.mjs'
import { buildSetupSteps, renderSteps } from '../src/setup/steps.mjs'

describe('buildMcpAddCommand（ADR 0026）', () => {
  it('配布版: exe を channel --channel で登録する。パスは二重引用符で囲む（スペースを含んでもそのまま貼れる）', () => {
    const cmd = buildMcpAddCommand('', { exePath: 'C:\\Program Files\\Coders Hub\\coders-hub.exe' })
    assert.equal(cmd, 'claude mcp add --scope user coders-hub -- "C:\\Program Files\\Coders Hub\\coders-hub.exe" channel --channel')
  })

  it('開発時: node で channel.mjs を --channel つきで登録する', () => {
    assert.equal(buildMcpAddCommand('D:\\work\\channel.mjs'), 'claude mcp add --scope user coders-hub -- node "D:\\work\\channel.mjs" --channel')
  })

  it('名前は coders-hub 固定（開発用フラグの server: と一致する）。解除のコマンドも同じ名前・スコープ', () => {
    assert.equal(SERVER_NAME, 'coders-hub')
    assert.equal(CHANNEL_FLAG, `--dangerously-load-development-channels server:${SERVER_NAME}`)
    assert.equal(MCP_REMOVE_COMMAND, 'claude mcp remove --scope user coders-hub')
  })
})

describe('buildHooksConfig', () => {
  it('状態を動かす 6 つのフックを、非同期で登録する', () => {
    const { hooks } = buildHooksConfig('D:\\x\\hook.mjs')
    assert.deepEqual(Object.keys(hooks), HOOK_EVENTS)
    for (const event of HOOK_EVENTS) assert.equal(hooks[event][0].hooks[0].async, true)
  })
})

describe('セットアップの手順（buildSetupSteps。ADR 0027）', () => {
  const EXE = 'C:\\Apps\\coders-hub.exe'
  const steps = buildSetupSteps({ exePath: EXE, uiPort: 50000, internalPort: 50001 })
  const byId = (id) => steps.find((s) => s.id === id)

  it('手順の順番: 登録 → フック → 起動と確認。どれも、見出しと本文を持つ', () => {
    assert.deepEqual(steps.map((s) => s.id), ['register', 'hooks', 'use'])
    for (const step of steps) {
      assert.ok(step.title)
      assert.ok(step.body.length > 0)
    }
  })

  it('コピーできる内容があるのは、フックと起動と確認だけ。登録は、項目の下にコマンドを書くので、コピーのブロックはない。困ったときも、なし', () => {
    assert.deepEqual(steps.map((s) => s.copy !== undefined), [false, true, true])
  })

  it('登録: 項目（アカウントの指定・登録・確認）の下に、それぞれのコマンドを書く。解除のコマンドも書く。既定のアカウントなら、アカウントの指定はスキップする', () => {
    const body = byId('register').body
    const commands = body.filter((l) => /^\s+(\$env:|claude )/.test(l)).map((l) => l.trim())
    assert.equal(commands.length, 4)
    assert.match(commands[0], /^\$env:CLAUDE_CONFIG_DIR = "/)
    assert.equal(commands[1], buildMcpAddCommand('', { exePath: EXE }))
    assert.equal(commands[2], 'claude mcp list')
    assert.equal(commands[3], MCP_REMOVE_COMMAND)
    const text = body.join('\n')
    assert.match(text, /既定のアカウントを使うときは、この手順をスキップします/)
    // 各コマンドは、それを説明する項目の直後（空行をはさむ）に並ぶ
    const idx = (prefix) => body.findIndex((l) => l.startsWith(prefix))
    assert.ok(idx('1. アカウントの指定') < idx('   $env:CLAUDE_CONFIG_DIR') && idx('   $env:CLAUDE_CONFIG_DIR') < idx('2. 登録'))
    assert.ok(idx('2. 登録') < idx('   claude mcp add') && idx('   claude mcp add') < idx('3. 確認'))
    assert.ok(idx('3. 確認') < idx('   claude mcp list'))
  })

  it('フック: コピーできる内容は、{ "hooks": { ... } } の枠。1 行が 1 イベントで、exe のパスを指す', () => {
    const frame = JSON.parse(byId('hooks').copy)
    assert.deepEqual(Object.keys(frame.hooks), HOOK_EVENTS)
    assert.equal(frame.hooks.Stop[0].hooks[0].command, '"C:/Apps/coders-hub.exe" hook')
    assert.equal(frame.hooks.PermissionRequest[1].matcher, 'AskUserQuestion')
    assert.equal(byId('hooks').copy.split('\n').length, HOOK_EVENTS.length + 4, '枠の 4 行 + イベントごとの 1 行')
  })

  it('起動と確認: 操作モードの起動コマンド（開発用フラグ）と、画面の URL（ポートは引数）', () => {
    const step = byId('use')
    assert.equal(step.copy, 'claude --dangerously-load-development-channels server:coders-hub')
    assert.match(step.body.join('\n'), /http:\/\/127\.0\.0\.1:50000\//)
  })

  it('開発時（exe なし）は、node で起動するファイルを指す。配布版のみの行は出ない', () => {
    const dev = buildSetupSteps({ paths: { hook: 'D:\\x\\hook.mjs', askHook: 'D:\\x\\ask-hook.mjs', channel: 'D:\\x\\channel.mjs' } })
    assert.ok(dev.find((s) => s.id === 'register').body.some((l) => l.trim() === 'claude mcp add --scope user coders-hub -- node "D:\\x\\channel.mjs" --channel'))
    assert.equal(JSON.parse(dev.find((s) => s.id === 'hooks').copy).hooks.Stop[0].hooks[0].command, 'node "D:/x/hook.mjs"')
    assert.ok(!dev.find((s) => s.id === 'register').body.join('\n').includes('exe を移動'))
  })

  it('テキストにする: 手順ごとに「# 番号. 見出し」と、本文・コピーできる内容を並べる', () => {
    const text = renderSteps(steps)
    assert.match(text, /^# 1\. チャネルサーバーを登録する/m)
    assert.match(text, /^# 2\. フックを追加する/m)
    assert.match(text, /^# 3\. 起動して確認する/m)
    assert.doesNotMatch(text, /困ったとき/)
    assert.ok(text.includes(buildMcpAddCommand('', { exePath: EXE })))
    assert.ok(text.includes(byId('hooks').copy))
  })
})
