# 参考コード（実装前の叩き台）

- **動作未検証の叩き台**。実装を始めたら `src/` に移し、この文書は削除する
- 仕様との差分:
  - MVP のチャネルサーバーは登録と生存確認だけでよい。許可プロンプトの転送と指示の受け渡しは「次」の段階（ADR 0006）
  - `wait.mjs` は MVP では使わない

## チャネルサーバー（`channel.mjs`）

```js
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const HUB = 'http://127.0.0.1:8765'
const me = {
  session: process.env.CLAUDE_CODE_SESSION_ID ?? crypto.randomUUID(),
  account: process.env.CLAUDE_CONFIG_DIR ?? 'default',
  cwd: process.cwd(),
}
const post = (path, body) => fetch(HUB + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const mcp = new Server(
  { name: 'coders-hub', version: '0.1.0' },
  {
    capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } },
    instructions: 'Messages in <channel source="coders-hub"> are instructions from the user via their local dashboard. Handle them like a normal user prompt.',
  },
)

// 許可プロンプトを本体へ転送する
mcp.setNotificationHandler(z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({ request_id: z.string(), tool_name: z.string(), description: z.string(), input_preview: z.string() }),
}), async ({ params }) => { await post('/permission', { ...me, ...params }).catch(() => {}) })

await mcp.connect(new StdioServerTransport())

// 本体からの指示を待ち受ける（本体は指示がなければ約30秒で 204 を返す）
for (;;) {
  try {
    const res = await post('/poll', me)
    if (res.status !== 200) continue
    const msg = await res.json()
    if (msg.type === 'permission') {
      await mcp.notification({ method: 'notifications/claude/channel/permission',
        params: { request_id: msg.request_id, behavior: msg.behavior } })   // 'allow' | 'deny'
    } else {
      await mcp.notification({ method: 'notifications/claude/channel', params: { content: msg.text } })
    }
  } catch { await new Promise(r => setTimeout(r, 3000)) }
}
```

### 本体の自動起動

```js
import { spawn } from 'node:child_process'
try { await fetch(HUB + '/health') }
catch {
  spawn('node', ['C:/tools/coders-hub/hub.mjs'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}
```

## asyncRewake 用の待機スクリプト（`wait.mjs`）

```js
let input = ''
for await (const c of process.stdin) input += c
const ev = JSON.parse(input)
const me = { session: ev.session_id, account: process.env.CLAUDE_CONFIG_DIR ?? 'default', cwd: ev.cwd }

for (;;) {
  try {
    const res = await fetch('http://127.0.0.1:8765/wait', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(me),
    })
    if (res.status === 204) continue              // まだ指示なし
    const msg = await res.json()
    if (msg.type === 'superseded') process.exit(0) // 新しい待機に置き換わった
    process.stderr.write(msg.text)                 // Claude に渡る
    process.exit(2)                                // セッションを起こす
  } catch { await new Promise(r => setTimeout(r, 3000)) }
}
```
