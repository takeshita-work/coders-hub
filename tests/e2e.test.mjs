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
  hub = createHub({ statusMonitor: null, requestGraceMs: 50, config: { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 2000, expireMs: 5000 } })
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

// 操作モード（--channel）: 本物の channel.mjs を MCP クライアントとして起動し、通知を受ける（機能 002）
describe('channel.mjs --channel（操作モード）', () => {
  it('AC-002-3: チャネル機能を宣言し、Hub の指示を id つきの通知として送る。本文は変わらず、結果が Hub に返る', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const { z } = await import('zod')

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/channel/channel.mjs', '--channel'],
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: 'm1' },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'test-claude', version: '0' }, { capabilities: {} })
    const received = []
    client.setNotificationHandler(
      z.object({ method: z.literal('notifications/claude/channel'), params: z.object({ content: z.string(), meta: z.record(z.string(), z.string()) }) }),
      (n) => received.push(n.params),
    )
    try {
      await client.connect(transport)
      assert.deepEqual(Object.keys(client.getServerCapabilities().experimental ?? {}), ['claude/channel', 'claude/channel/permission'])

      assert.ok(await until(() => hub.store.get('m1')?.controllable), '操作モードとして登録されない')
      hub.store.applyHookEvent({ event: 'Stop', input: { session_id: 'm1' } })

      const text = '1 行目 "引用符" C:\Users\yuya\n2 行目 <tag> & `x` $HOME 日本語'
      const seen = []
      const unsubscribe = hub.instructions.subscribe((c) => c.sessionId === 'm1' && seen.push(c.status))
      const { id } = hub.instructions.submit('m1', text)
      assert.ok(await until(() => received.length === 1), '通知が届かない')
      assert.deepEqual(received[0], { content: text, meta: { id } })

      // 通知の結果が次の /poll で Hub に返り、渡した指示が sent になる
      assert.ok(await until(() => seen.includes('sent')), '結果が Hub に返らない')
      unsubscribe()
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('AC-004-2, 004-3: 許可要求を Hub へ転送し、Hub の応答（許可・拒否）を許可中継の通知として返す', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const { z } = await import('zod')

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/channel/channel.mjs', '--channel'],
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: 'p1' },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'test-claude', version: '0' }, { capabilities: {} })
    const verdicts = []
    client.setNotificationHandler(
      z.object({ method: z.literal('notifications/claude/channel/permission'), params: z.object({ request_id: z.string(), behavior: z.string() }) }),
      (n) => verdicts.push(n.params),
    )
    try {
      await client.connect(transport)
      assert.ok(await until(() => hub.store.get('p1')?.controllable), '操作モードとして登録されない')
      hub.store.applyHookEvent({ event: 'UserPromptSubmit', input: { session_id: 'p1' } })

      // claude が許可画面を出したときの通知
      for (const [id, preview] of [['abcde', '{ "command": "ls" }'], ['fghij', '{ "file_path": "a.txt", "content": "hello\n" }']]) {
        await client.notification({
          method: 'notifications/claude/channel/permission_request',
          params: { request_id: id, tool_name: id === 'abcde' ? 'Bash' : 'Write', description: 'List files', input_preview: preview },
        })
      }
      assert.ok(await until(() => hub.store.get('p1').requests.length === 2), '許可要求が Hub に届かない')
      const [first, second] = hub.store.get('p1').requests
      assert.deepEqual([first.id, first.toolName, first.inputPreview], ['abcde', 'Bash', '{ "command": "ls" }'])
      assert.equal(second.toolName, 'Write')

      // 別々の応答が、ID つきで claude へ返る
      const t0 = Date.now()
      hub.requests.respond('p1', 'abcde', { behavior: 'allow' })
      assert.ok(await until(() => verdicts.length === 1, 3000), '許可の応答が返らない')
      assert.ok(Date.now() - t0 < 3000, '3 秒以内（NFR-003）')
      hub.requests.respond('p1', 'fghij', { behavior: 'deny' })
      assert.ok(await until(() => verdicts.length === 2, 3000), '拒否の応答が返らない')
      assert.deepEqual(verdicts, [{ request_id: 'abcde', behavior: 'allow' }, { request_id: 'fghij', behavior: 'deny' }])
      assert.deepEqual(hub.store.get('p1').requests, [])
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('AC-002-5: 引数なしのチャネルサーバーはチャネル機能を宣言せず、操作できないセッションとして登録される', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/channel/channel.mjs'],
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: 'm2' },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'test-claude', version: '0' }, { capabilities: {} })
    try {
      await client.connect(transport)
      assert.equal(client.getServerCapabilities().experimental, undefined)
      assert.ok(await until(() => hub.store.get('m2')?.channelAlive), '登録されない')
      assert.equal(hub.store.get('m2').controllable, false)
      assert.throws(() => hub.instructions.submit('m2', 'x'), (e) => e.code === 'not-controllable')
    } finally {
      await client.close().catch(() => {})
    }
  })
})

// 通し: 本物の hook.mjs・ask-hook.mjs・channel.mjs（--channel）と Hub を起動し、模擬の claude（MCP クライアント）で
// 許可要求と質問を通す（機能 003、AC-004-2, 004-3, 004-9, 005-5, 005-6）
describe('許可・質問への応答（結合）', () => {
  const connectChannel = async (session) => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const { z } = await import('zod')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/channel/channel.mjs', '--channel'],
      cwd: root,
      env: { ...env, CLAUDE_CODE_SESSION_ID: session },
      stderr: 'inherit',
    })
    const client = new Client({ name: 'test-claude', version: '0' }, { capabilities: {} })
    const verdicts = []
    client.setNotificationHandler(
      z.object({ method: z.literal('notifications/claude/channel/permission'), params: z.object({ request_id: z.string(), behavior: z.string() }) }),
      (n) => verdicts.push(n.params),
    )
    await client.connect(transport)
    assert.ok(await until(() => hub.store.get(session)?.controllable), '操作モードとして登録されない')
    return { client, verdicts }
  }

  const runAsk = (input, extraEnv = {}) => {
    const child = spawn(process.execPath, ['src/hook/ask-hook.mjs'], { cwd: root, env: { ...env, CODERS_HUB_ASK_WAIT_MS: '10000', ...extraEnv } })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout })))
    child.stdin.end(JSON.stringify(input))
    return done
  }

  const colorQuestion = {
    question: '好きな色は？', header: '色', multiSelect: false,
    options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
  }

  it('許可: フックで許可待ちになり、許可要求が届き、画面の応答が claude に返り、PostToolUse で作業中に戻る', async () => {
    const { client, verdicts } = await connectChannel('r1')
    try {
      await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'r1', cwd: 'D:\\p', prompt: 'ls して' })
      await runHook({ hook_event_name: 'PermissionRequest', session_id: 'r1', tool_name: 'Bash' })
      assert.equal(hub.store.get('r1').state, 'permission')
      await client.notification({
        method: 'notifications/claude/channel/permission_request',
        params: { request_id: 'abcde', tool_name: 'Bash', description: 'List files', input_preview: '{ "command": "ls" }' },
      })
      assert.ok(await until(() => hub.store.get('r1').requests.length === 1), '許可要求が Hub に届かない')

      hub.requests.respond('r1', 'abcde', { behavior: 'allow' })
      assert.ok(await until(() => verdicts.length === 1, 3000), '応答が claude に返らない')
      assert.deepEqual(verdicts[0], { request_id: 'abcde', behavior: 'allow' })

      await runHook({ hook_event_name: 'PostToolUse', session_id: 'r1', tool_name: 'Bash' })
      assert.equal(hub.store.get('r1').state, 'working')
      assert.deepEqual(hub.store.get('r1').requests, [])
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('許可: ターミナルで先に許可されたら（PostToolUse）、画面の要求が閉じる', async () => {
    const { client, verdicts } = await connectChannel('r2')
    try {
      await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'r2', cwd: 'D:\\p', prompt: 'x' })
      await runHook({ hook_event_name: 'PermissionRequest', session_id: 'r2', tool_name: 'Bash' })
      await client.notification({
        method: 'notifications/claude/channel/permission_request',
        params: { request_id: 'zzzzz', tool_name: 'Bash', description: 'd', input_preview: '{}' },
      })
      assert.ok(await until(() => hub.store.get('r2').requests.length === 1))
      await sleep(80)
      await runHook({ hook_event_name: 'PostToolUse', session_id: 'r2', tool_name: 'Bash' })
      assert.ok(await until(() => hub.store.get('r2').requests.length === 0), '要求が閉じない')
      assert.throws(() => hub.requests.respond('r2', 'zzzzz', { behavior: 'allow' }), (e) => e.code === 'not-open')
      assert.deepEqual(verdicts, [])
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('質問: ask-hook.mjs が質問を Hub へ送り、画面の答えが標準出力の allow ＋ answers になり、PostToolUse で作業中に戻る', async () => {
    const { client } = await connectChannel('r3')
    try {
      await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'r3', cwd: 'D:\\p', prompt: '質問して' })
      const input = { hook_event_name: 'PermissionRequest', session_id: 'r3', tool_name: 'AskUserQuestion', tool_input: { questions: [colorQuestion] } }
      await runHook(input) // 状態用の非同期フック（質問待ちにする）
      assert.equal(hub.store.get('r3').state, 'question')
      const running = runAsk(input)
      assert.ok(await until(() => hub.store.get('r3').requests.length === 1), '質問が Hub に届かない')
      const [request] = hub.store.get('r3').requests
      assert.equal(request.kind, 'question')

      hub.requests.respond('r3', request.id, { answers: { '好きな色は？': '青' } })
      const result = await running
      assert.equal(result.code, 0)
      assert.deepEqual(JSON.parse(result.stdout).hookSpecificOutput.decision, {
        behavior: 'allow',
        updatedInput: { questions: [colorQuestion], answers: { '好きな色は？': '青' } },
      })

      await runHook({ hook_event_name: 'PostToolUse', session_id: 'r3', tool_name: 'AskUserQuestion' })
      assert.equal(hub.store.get('r3').state, 'working')
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('質問: ターミナルで先に答えられたら（PostToolUse）、ask-hook.mjs は何も出力せずに終わり、画面の質問が閉じる', async () => {
    const { client } = await connectChannel('r4')
    try {
      await runHook({ hook_event_name: 'UserPromptSubmit', session_id: 'r4', cwd: 'D:\\p', prompt: 'x' })
      const input = { hook_event_name: 'PermissionRequest', session_id: 'r4', tool_name: 'AskUserQuestion', tool_input: { questions: [colorQuestion] } }
      await runHook(input)
      const running = runAsk(input)
      assert.ok(await until(() => hub.store.get('r4').requests.length === 1))
      await sleep(80)
      await runHook({ hook_event_name: 'PostToolUse', session_id: 'r4', tool_name: 'AskUserQuestion' })
      const result = await running
      assert.equal(result.stdout, '')
      assert.equal(result.code, 0)
      assert.deepEqual(hub.store.get('r4').requests, [])
    } finally {
      await client.close().catch(() => {})
    }
  })
})
