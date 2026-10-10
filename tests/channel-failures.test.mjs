// チャネルサーバーの失敗時の振る舞い（機能 003）。偽の Hub を相手に、本物の channel.mjs（--channel）を起動する。
//  - Hub への転送に失敗しても、チャネルサーバーは止まらない（ターミナルで応答できる）
//  - /poll が切れても、Hub が動いていれば再接続して続ける
//  - 不正な応答（allow／deny 以外）は claude へ送らない
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const until = async (fn, timeout = 6000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (fn()) return true
    await sleep(25)
  }
  return false
}

let fake, port
const log = { polls: 0, permissions: [], health: 0 }

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      if (req.url === '/health') { log.health += 1; res.writeHead(200); return res.end('ok') }
      if (req.url === '/poll') {
        log.polls += 1
        // 1 回目: 接続を切る（Hub に届かない状態）。2 回目: 不正なものを含む応答を返す。以降: しばらく待って 204
        if (log.polls === 1) return req.socket.destroy()
        if (log.polls === 2) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ verdicts: [
            { request_id: 'aaaaa', behavior: 'allow' },
            { request_id: 'bbbbb', behavior: 'maybe' },
            { request_id: 'ccccc' },
            null,
            { request_id: 'ddddd', behavior: 'deny' },
          ] }))
        }
        return setTimeout(() => { res.writeHead(204); res.end() }, 300)
      }
      if (req.url === '/permission') {
        log.permissions.push(body)
        // 1 件目は失敗させる
        res.writeHead(log.permissions.length === 1 ? 500 : 204)
        return res.end()
      }
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  port = fake.address().port
})
after(() => new Promise((resolve) => { fake.closeAllConnections(); fake.close(resolve) }))

describe('channel.mjs --channel の失敗時', () => {
  it('Hub への転送に失敗しても止まらず、不正な応答は送らず、/poll が切れても再接続して応答を返す', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['src/channel/channel.mjs', '--channel'],
      cwd: root,
      env: { ...process.env, CODERS_HUB_INTERNAL_PORT: String(port), CLAUDE_CODE_SESSION_ID: 'f1', CLAUDE_CONFIG_DIR: 'C:\\x\\.claude-f' },
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

      // 許可要求を 2 回転送する。1 回目は Hub が 500 を返すが、チャネルサーバーは止まらず、2 回目も転送できる
      for (const id of ['first', 'second']) {
        await client.notification({
          method: 'notifications/claude/channel/permission_request',
          params: { request_id: id, tool_name: 'Bash', input_preview: '{}' },
        })
      }
      assert.ok(await until(() => log.permissions.length === 2), '転送されない')
      assert.deepEqual(log.permissions.map((p) => p.request_id), ['first', 'second'])
      // 省略された項目は空文字で送る。セッションは環境変数のものを使う
      assert.deepEqual(log.permissions[1], { session: 'f1', request_id: 'second', tool_name: 'Bash', description: '', input_preview: '{}' })

      // /poll の切断 → Hub の生存確認 → 再接続 → verdicts の受信
      assert.ok(await until(() => verdicts.length >= 2), '応答が claude に返らない')
      await sleep(100)
      assert.deepEqual(verdicts, [{ request_id: 'aaaaa', behavior: 'allow' }, { request_id: 'ddddd', behavior: 'deny' }])
      assert.ok(log.health >= 1, '切断のあと、Hub の生存確認をしていない')
      assert.ok(log.polls >= 3, '再接続して /poll を続けている')
    } finally {
      await client.close().catch(() => {})
    }
  })
})
