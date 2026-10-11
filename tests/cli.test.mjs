// 配布版（coders-hub.exe）の入口・設定の生成・画面の配信・Hub の自動起動（機能 007、ADR 0018）
// AC-011-5〜11, 13
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createHub } from '../src/hub/hub.mjs'
import { main, USAGE } from '../src/cli/main.mjs'
import { VERSION } from '../src/cli/version.mjs'
import { isDirectRun } from '../src/shared/entry.mjs'
import { startHubProcess } from '../src/shared/hub-client.mjs'
import { buildHooksConfig } from '../src/setup/hooks-config.mjs'
import { buildMcpConfig, CHANNEL_FLAG } from '../src/setup/mcp-config.mjs'
import { renderSetup } from '../src/setup/render.mjs'

const EXE = 'C:\\Program Files\\Coders Hub\\coders-hub.exe'
const collect = () => { const lines = []; return { lines, out: (t) => lines.push(t) } }

describe('サブコマンド（AC-011-5）', () => {
  it('version は、バージョンだけを表示する（package.json と一致する）', async () => {
    const { lines, out } = collect()
    await main(['version'], { out, exePath: EXE, staticAssets: null })
    assert.deepEqual(lines, [VERSION])
    const pkg = JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(VERSION, pkg.version)
  })

  it('help・--help・-h は、使い方を表示する', async () => {
    for (const arg of ['help', '--help', '-h']) {
      const { lines, out } = collect()
      await main([arg], { out, exePath: EXE, staticAssets: null })
      assert.equal(lines[0], USAGE)
    }
    assert.match(USAGE, /hub .*サブコマンドなしでも同じ/)
  })

  it('不明なサブコマンドは、使い方つきで、エラー（終了コード 2）にする', async () => {
    const { lines, out } = collect()
    const before = process.exitCode
    await main(['bogus'], { out, exePath: EXE, staticAssets: null })
    assert.match(lines[0], /不明なサブコマンドです: bogus/)
    assert.equal(process.exitCode, 2)
    process.exitCode = before
  })
})

describe('設定の生成（AC-011-8）', () => {
  it('フック: exe のパスを指す。区切りは / で、スペースを含むパスも引用符で囲む。質問用は ask-hook', () => {
    const { hooks } = buildHooksConfig('', '', { exePath: EXE })
    assert.equal(hooks.SessionStart[0].hooks[0].command, '"C:/Program Files/Coders Hub/coders-hub.exe" hook')
    assert.equal(hooks.SessionStart[0].hooks[0].async, true)
    const ask = hooks.PermissionRequest.find((e) => e.matcher === 'AskUserQuestion')
    assert.equal(ask.hooks[0].command, '"C:/Program Files/Coders Hub/coders-hub.exe" ask-hook')
    assert.equal(ask.hooks[0].async, undefined, '質問用は同期')
  })

  it('MCP: exe を channel で起動する。操作モードは --channel が付く。名前は同じ', () => {
    const list = buildMcpConfig('', { exePath: EXE }).mcpServers['coders-hub']
    assert.deepEqual([list.command, list.args], ['C:/Program Files/Coders Hub/coders-hub.exe', ['channel']])
    const control = buildMcpConfig('', { exePath: EXE, channel: true }).mcpServers['coders-hub']
    assert.deepEqual(control.args, ['channel', '--channel'])
  })

  it('node 版の設定は、これまでどおり（AC-011-13）', () => {
    assert.equal(buildHooksConfig('D:\\x\\hook.mjs').hooks.Stop[0].hooks[0].command, 'node "D:/x/hook.mjs"')
    assert.deepEqual(buildMcpConfig('D:\\x\\channel.mjs').mcpServers['coders-hub'], { command: 'node', args: ['D:/x/channel.mjs'] })
  })

  it('setup は、3 つの設定（フック・一覧だけ・操作モード）と起動フラグの案内を出す', async () => {
    const { lines, out } = collect()
    await main(['setup'], { out, exePath: EXE, staticAssets: null })
    const text = lines.join('\n')
    assert.match(text, /# 1\. settings\.json/)
    assert.match(text, /# 2\. 一覧だけのモード/)
    assert.match(text, /# 3\. 操作モード/)
    assert.ok(text.includes(CHANNEL_FLAG))
    assert.match(text, /coders-hub\.exe\\" hook/)
    assert.equal(text, renderSetup({ exePath: EXE }))
  })

  it('exe でない（開発時の）setup は、node で起動するファイルを指す', async () => {
    const { lines, out } = collect()
    await main(['setup'], { out, exePath: null, staticAssets: null })
    assert.match(lines[0], /node \\"[^"]*src\/hook\/hook\.mjs\\"/)
  })
})

describe('画面の配信（AC-011-6, 7）', () => {
  const assets = new Map([['index.html', Buffer.from('<h1>埋め込み</h1>')], ['app.js', Buffer.from('console.log(1)')], ['styles.css', Buffer.from('a{}')]])
  const staticAssets = { get: (rel) => assets.get(rel) ?? null }
  const withHub = async (fn) => {
    const hub = createHub({ config: { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 }, statusMonitor: null, instructionMonitor: null, staticAssets, staticDir: 'nowhere' })
    const ports = await hub.start()
    try { await fn(`http://127.0.0.1:${ports.uiPort}`) } finally { await hub.stop() }
  }

  it('埋め込んだファイルを、種類つきで返す。/ は index.html', async () => {
    await withHub(async (base) => {
      const root = await fetch(`${base}/`)
      assert.deepEqual([root.status, root.headers.get('content-type'), await root.text()], [200, 'text/html; charset=utf-8', '<h1>埋め込み</h1>'])
      const js = await fetch(`${base}/app.js`)
      assert.deepEqual([js.status, js.headers.get('content-type')], [200, 'text/javascript; charset=utf-8'])
      assert.equal((await fetch(`${base}/styles.css`)).headers.get('content-type'), 'text/css; charset=utf-8')
      assert.equal((await fetch(`${base}/app.js`, { method: 'HEAD' })).status, 200)
    })
  })

  it('リストにないパス・フォルダの外を指すパスは返さない（404）', async () => {
    await withHub(async (base) => {
      for (const p of ['/nope', '/app.js.map', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/styles.css/../x']) {
        assert.equal((await fetch(`${base}${p}`)).status, 404, p)
      }
      assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405)
    })
  })
})

describe('Hub の自動起動（AC-011-11）', () => {
  const call = (opts) => {
    let c
    startHubProcess((cmd, args, o) => { c = { cmd, args, o }; return { unref() {}, on() {} } }, { PATH: 'p', CLAUDE_X: '1' }, opts)
    return c
  }

  it('exe では、自分と同じ exe を hub で起動する（exe のフォルダで。CLAUDE* は引き継がない。切り離す）', () => {
    const c = call({ sea: true, execPath: 'C:\\Apps\\coders-hub.exe' })
    assert.deepEqual([c.cmd, c.args], ['C:\\Apps\\coders-hub.exe', ['hub']])
    assert.equal(c.o.cwd, 'C:\\Apps')
    assert.equal(c.o.detached, true)
    assert.deepEqual(c.o.env, { PATH: 'p' })
  })

  it('開発時（AC-011-13）は、これまでどおり node で src/hub/main.mjs を起動する', () => {
    const c = call({ sea: false, execPath: 'node' })
    assert.equal(c.cmd, 'node')
    assert.match(c.args[0], /src[\\/]hub[\\/]main\.mjs$/)
  })
})

describe('直接実行の判定', () => {
  it('束ねた exe（import.meta.url が実在しない URL）では、false。ほかのファイルを指す URL でも false', () => {
    assert.equal(isDirectRun('file:///C:/__coders_hub_bundle__/main.mjs'), false)
    assert.equal(isDirectRun('file:///C:/other/file.mjs'), false)
    assert.equal(isDirectRun(pathToFileURL(process.argv[1]).href), true, '直接実行したファイルの URL なら true')
  })
})
