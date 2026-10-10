// チャネルサーバー。claude がセッションごとに起動する MCP サーバー（stdio）。
// 引数なし: 登録と生存確認だけ（ADR 0006）。チャネル機能は宣言しないので、開発用フラグは要らない（T0-5）。
// 引数 --channel（操作モード。ADR 0011）: チャネル機能を宣言し、Hub から受けた指示を通知としてセッションへ送る。
//   あわせて許可中継（claude/channel/permission。ADR 0002）も宣言し、許可要求を Hub へ転送し、Hub が返した応答を claude へ返す（機能 003）。
//   claude 側に --dangerously-load-development-channels server:coders-hub が必要（なければ通知は黙って捨てられる）。
//  - Hub 本体へ /poll（ロングポーリング）で自己登録し、生存を知らせる
//  - claude が終了して stdin が閉じたら /bye で知らせて終了する
//  - Hub が動いていなければ、起動する（ADR 0004）
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadConfig } from '../shared/config.mjs'
import { ensureHub, postJson } from '../shared/hub-client.mjs'

const config = loadConfig()
const channelMode = process.argv.slice(2).includes('--channel')
const me = {
  session: process.env.CLAUDE_CODE_SESSION_ID ?? null,
  account: process.env.CLAUDE_CONFIG_DIR ?? null,
  cwd: process.cwd(),
  pid: process.pid,
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  if (me.session) await postJson(config, '/bye', me, { timeoutMs: 500 }).catch(() => {})
  process.exit(0)
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown)

// 通常の MCP サーバーとして接続する（ツールなし）。先に接続して、claude の起動を待たせない
// 操作モードのときだけ、チャネル機能（claude/channel）を宣言する
const mcp = channelMode
  ? new Server(
      { name: 'coders-hub', version: '0.2.0' },
      {
        capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } },
        instructions:
          'Messages from this server arrive as <channel source="coders-hub" id="..."> tags. They are instructions the user typed in the Coders Hub dashboard. Treat them like a normal user prompt and do what they say.',
      },
    )
  : new Server({ name: 'coders-hub', version: '0.1.0' }, { capabilities: {} })
await mcp.connect(new StdioServerTransport())

// Hub から受けた指示を、チャネルの通知としてセッションへ送る。id は会話ログでの確認に使う（機能 002）
const notify = async ({ id, text }) => {
  try {
    await mcp.notification({ method: 'notifications/claude/channel', params: { content: String(text), meta: { id: String(id) } } })
    return { id, ok: true }
  } catch (e) {
    return { id, ok: false, error: String(e?.message ?? e) }
  }
}

// 許可要求（機能 003、ADR 0002）。claude が許可画面を出すと届く。Hub へ転送するだけで、応答は /poll の verdicts で受ける。
// 転送に失敗しても何もしない（ターミナルの許可画面で応答できる）
const PermissionRequest = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string().optional(),
    input_preview: z.string().optional(),
  }),
})
if (channelMode) {
  mcp.setNotificationHandler(PermissionRequest, async ({ params }) => {
    if (!me.session) return
    try {
      await postJson(config, '/permission', {
        session: me.session, request_id: params.request_id, tool_name: params.tool_name,
        description: params.description ?? '', input_preview: params.input_preview ?? '',
      })
    } catch {
      // Hub に届かない: ターミナルで応答できる
    }
  })
}

// Hub が返した許可の応答を、claude へ返す
const sendVerdict = async ({ request_id, behavior }) => {
  try {
    await mcp.notification({ method: 'notifications/claude/channel/permission', params: { request_id: String(request_id), behavior } })
  } catch {
    // 送れなかった応答は捨てる（要求はターミナルで応答できる）
  }
}

// セッション ID が分からなければ登録できない。MCP サーバーとして待機するだけにする
if (me.session) {
  // 前回の応答で受けた指示の、通知の結果。次の /poll で Hub へ返す（届かなかったときは持ち越す）
  let results = []
  for (;;) {
    if (stopping) break
    try {
      const res = await postJson(config, '/poll', { ...me, channel: channelMode, results }, { timeoutMs: config.pollTimeoutMs + 10_000 })
      results = []
      if (res.status === 200 && channelMode) {
        const body = await res.json().catch(() => ({}))
        for (const item of Array.isArray(body.instructions) ? body.instructions : []) results.push(await notify(item))
        for (const v of Array.isArray(body.verdicts) ? body.verdicts : []) {
          if (v && (v.behavior === 'allow' || v.behavior === 'deny')) await sendVerdict(v)
        }
        continue
      }
      if (res.status !== 204) await sleep(res.ok ? 0 : 3000)
    } catch {
      // Hub に届かない: 起動を試みて、少し待って再接続する（再起動後の復元も同じ経路）
      await ensureHub(config)
      await sleep(1000)
    }
  }
}
