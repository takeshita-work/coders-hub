// 結合テスト: 会話の取得 API（機能 004、ADR 0016）
// AC-007-1, 11, 13, 15〜17
import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { createHub } from '../src/hub/hub.mjs'

const config = { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 }
const SESSION = 'sess-1'

let hub, ports, root, file

const record = (type, content, extra = {}) => ({ type, timestamp: new Date().toISOString(), message: { role: type, content }, ...extra })
const write = (records) => fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n')

before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-api-')) })
after(() => fs.rmSync(root, { recursive: true, force: true }))

beforeEach(async () => {
  fs.rmSync(path.join(root, 'projects'), { recursive: true, force: true })
  fs.mkdirSync(path.join(root, 'projects', 'D--proj'), { recursive: true })
  file = path.join(root, 'projects', 'D--proj', `${SESSION}.jsonl`)
  hub = createHub({ config, statusMonitor: null, instructionMonitor: null, staticDir: 'nowhere', sweepIntervalMs: 50 })
  ports = await hub.start()
  // フックで登録する。transcript_path は渡さない（Hub の再起動後と同じ。<アカウント>/projects/*/<id>.jsonl から探す）
  await fetch(`http://127.0.0.1:${ports.internalPort}/event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'SessionStart', account: root, input: { session_id: SESSION, cwd: 'D:\\proj' } }),
  })
})
afterEach(() => hub.stop())

const get = (route, { headers = {}, host } = {}) => {
  const h = host ?? `127.0.0.1:${ports.uiPort}`
  return fetch(`http://127.0.0.1:${ports.uiPort}${route}`, { headers: { Host: h, 'X-Coders-Hub': '1', ...headers } })
}
const conv = (query = '', opts) => get(`/api/sessions/${SESSION}/conversation${query}`, opts)

describe('会話の取得 API', () => {
  it('AC-007-1: 直近の会話が古い順で返り、ETag と Cache-Control: no-store が付く', async () => {
    write([record('user', 'こんにちは'), record('assistant', [{ type: 'text', text: 'はい' }])])
    const res = await conv()
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(res.headers.get('etag'), /^W\//)
    const body = await res.json()
    assert.deepEqual(body.messages.map((m) => [m.role, m.text]), [['user', 'こんにちは'], ['assistant', 'はい']])
    assert.equal(body.cursor, null)
  })

  it('AC-007-11: 変更がなければ 304 で、本文を返さない。変更があれば 200', async () => {
    write([record('user', '一つ目')])
    const etag = (await conv()).headers.get('etag')
    const same = await conv('', { headers: { 'If-None-Match': etag } })
    assert.equal(same.status, 304)
    assert.equal(await same.text(), '')
    await new Promise((r) => setTimeout(r, 20))
    fs.appendFileSync(file, `${JSON.stringify(record('assistant', [{ type: 'text', text: '二つ目' }]))}\n`)
    const changed = await conv('', { headers: { 'If-None-Match': etag } })
    assert.equal(changed.status, 200)
    assert.equal((await changed.json()).messages.length, 2)
  })

  it('limit と before で、さかのぼれる。before のときは 304 にならない', async () => {
    write(Array.from({ length: 30 }, (_, i) => record('user', `発言 ${i}`)))
    const first = await (await conv('?limit=10')).json()
    assert.equal(first.messages.length, 10)
    assert.notEqual(first.cursor, null)
    const older = await conv(`?limit=10&before=${first.cursor}`, { headers: { 'If-None-Match': 'W/"x"' } })
    assert.equal(older.status, 200)
    const body = await older.json()
    assert.deepEqual(body.messages.map((m) => m.text), Array.from({ length: 10 }, (_, i) => `発言 ${10 + i}`))
  })

  it('AC-007-15: 独自ヘッダーがない・Host が違う・別のオリジンからは、403', async () => {
    write([record('user', '秘密の会話')])
    const noHeader = await fetch(`http://127.0.0.1:${ports.uiPort}/api/sessions/${SESSION}/conversation`)
    assert.equal(noHeader.status, 403)
    // fetch は Host を書き換えられないので、http.request で、別のホスト名（DNS rebinding）を名乗る
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: ports.uiPort, path: `/api/sessions/${SESSION}/conversation`, headers: { Host: `evil.example:${ports.uiPort}`, 'X-Coders-Hub': '1' } }, (res) => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403, 'DNS rebinding')
    assert.equal((await conv('', { headers: { Origin: 'https://evil.example' } })).status, 403)
    const body = await noHeader.text()
    assert.doesNotMatch(body, /秘密/)
  })

  it('AC-007-15: クライアントからパスを渡せない（path などの引数は無視する）', async () => {
    write([record('user', '本物')])
    const other = path.join(root, 'other.jsonl')
    fs.writeFileSync(other, `${JSON.stringify(record('user', '別のファイル'))}\n`)
    const body = await (await conv(`?path=${encodeURIComponent(other)}&file=${encodeURIComponent(other)}`)).json()
    assert.deepEqual(body.messages.map((m) => m.text), ['本物'])
  })

  it('AC-007-15: フックが渡した transcript_path が projects の外なら、使わない', async () => {
    const secret = path.join(root, 'secret.jsonl')
    fs.writeFileSync(secret, `${JSON.stringify(record('user', '漏れてはいけない'))}\n`)
    await fetch(`http://127.0.0.1:${ports.internalPort}/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'UserPromptSubmit', account: root, input: { session_id: SESSION, cwd: 'D:\\proj', transcript_path: secret, prompt: 'x' } }),
    })
    // 会話ログ（projects の中）はまだない
    const res = await conv()
    assert.equal(res.status, 404)
    assert.equal((await res.json()).error, 'no-transcript')
  })

  it('AC-007-16: transcript_path が projects の中なら、それを使う', async () => {
    write([record('user', 'パスで見つける')])
    await fetch(`http://127.0.0.1:${ports.internalPort}/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'UserPromptSubmit', account: root, input: { session_id: SESSION, cwd: 'D:\\proj', transcript_path: file, prompt: 'x' } }),
    })
    assert.equal((await (await conv()).json()).messages[0].text, 'パスで見つける')
  })

  it('AC-007-17: セッションがない・会話の記録がない・引数が不正は、それぞれのエラー（ほかの API は動く）', async () => {
    assert.equal((await get('/api/sessions/nope/conversation')).status, 404)
    const none = await conv()
    assert.equal(none.status, 404)
    assert.equal((await none.json()).error, 'no-transcript')
    write([record('user', 'x')])
    for (const q of ['?limit=0', '?limit=abc', '?limit=101', '?before=-1', '?before=x']) {
      assert.equal((await conv(q)).status, 400, q)
    }
    assert.equal((await fetch(`http://127.0.0.1:${ports.uiPort}/`)).status < 500, true)
  })

  it('AC-007-13: Hub の状態（一覧）に、会話の本文が含まれない', async () => {
    write([record('user', '本文に含まれる固有の文字列 XYZZY')])
    await (await conv()).text()
    const session = hub.store.get(SESSION)
    assert.doesNotMatch(JSON.stringify(session), /XYZZY/)
    assert.doesNotMatch(JSON.stringify(hub.store.list()), /XYZZY/)
  })
})
