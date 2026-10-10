// 結合テスト: 許可要求・質問の API・/poll での応答の受け渡し・保護（機能 003、ADR 0002・0012・0014）
// AC-004-2〜004-6, 004-8〜004-11, 004-13, 005-5〜005-8
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createHub } from '../src/hub/hub.mjs'

const ACCOUNT = 'C:\\Users\\yuya\\.claude-a'
const config = { host: '127.0.0.1', internalPort: 0, uiPort: 0, pollTimeoutMs: 400, expireMs: 5000 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let hub, ports

const start = async (opts = {}) => {
  hub = createHub({ config, statusMonitor: null, instructionMonitor: null, staticDir: 'nowhere', sweepIntervalMs: 50, ...opts })
  ports = await hub.start()
}
// ツールの終了で要求を閉じる猶予は、テストでは短くする（標準は 2 秒）
beforeEach(() => start({ requestGraceMs: 50 }))
afterEach(() => hub.stop())

const internal = (route, body, init = {}) =>
  fetch(`http://127.0.0.1:${ports.internalPort}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
const hook = (event, extra = {}, session = 's1') =>
  internal('/event', { event, account: ACCOUNT, input: { session_id: session, cwd: 'D:\\proj', ...extra } })
const poll = (extra = {}, session = 's1') => internal('/poll', { session, account: ACCOUNT, cwd: 'D:\\proj', channel: true, ...extra })
const permission = (extra = {}, session = 's1') =>
  internal('/permission', { session, request_id: 'abcde', tool_name: 'Bash', description: 'List files', input_preview: '{ "command": "ls" }', ...extra })
const ask = (questions, session = 's1', init = {}) => internal('/ask', { session, questions }, init)

const ui = (method, route, { body, headers = {} } = {}) => {
  const host = `127.0.0.1:${ports.uiPort}`
  return fetch(`http://${host}${route}`, {
    method,
    headers: { Host: host, 'X-Coders-Hub': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const respond = (id, body, session = 's1', opts = {}) => ui('POST', `/api/sessions/${session}/requests/${id}/response`, { body, ...opts })

const colorQuestion = {
  question: '好きな色は？',
  header: '色',
  options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
  multiSelect: false,
}

// 操作モードのチャネルが /poll で登録し、作業中になった状態にする
const ready = async () => {
  assert.equal((await poll()).status, 204) // 渡すものがなければ約 pollTimeoutMs 後に 204
  await hook('UserPromptSubmit', { prompt: '作業' })
}

const until = async (check, ms = 1000) => {
  for (let waited = 0; waited < ms; waited += 10) {
    if (check()) return
    await sleep(10)
  }
  assert.fail('待っても条件を満たしませんでした')
}
const openRequests = () => hub.store.get('s1')?.requests ?? []

describe('許可要求の受け付け（POST /permission）', () => {
  beforeEach(async () => { await ready() })

  it('許可要求を受けると、行の requests に載る', async () => {
    assert.equal((await permission()).status, 204)
    const [r] = openRequests()
    assert.equal(r.kind, 'permission')
    assert.equal(r.id, 'abcde')
    assert.equal(r.toolName, 'Bash')
    assert.equal(r.inputPreview, '{ "command": "ls" }')
  })

  it('AC-004-5: 操作モードでないセッションは 409、存在しないセッションは 404、本文が不正なら 400', async () => {
    await poll({ channel: false }, 'plain')
    assert.equal((await permission({}, 'plain')).status, 409)
    assert.equal((await permission({}, 'nope')).status, 404)
    assert.equal((await permission({ request_id: '' })).status, 400)
    assert.equal((await internal('/permission', { request_id: 'x', tool_name: 'Bash' })).status, 400)
  })
})

describe('許可・拒否の応答（AC-004-2〜004-4, 004-6）', () => {
  beforeEach(async () => { await ready() })

  it('AC-004-2, 004-6: 許可すると、待機中の /poll に allow がすぐ 200 で渡る', async () => {
    await permission()
    const waiting = poll()
    await sleep(50)
    const started = Date.now()
    assert.equal((await respond('abcde', { behavior: 'allow' })).status, 204)
    const answered = await waiting
    assert.equal(answered.status, 200)
    assert.deepEqual(await answered.json(), { verdicts: [{ request_id: 'abcde', behavior: 'allow' }] })
    assert.ok(Date.now() - started < 300, '3 秒以内（NFR-003）')
    assert.deepEqual(openRequests(), [])
  })

  it('AC-004-3: 拒否すると deny が渡る', async () => {
    await permission()
    const waiting = poll()
    await sleep(50)
    await respond('abcde', { behavior: 'deny' })
    assert.deepEqual((await (await waiting).json()).verdicts, [{ request_id: 'abcde', behavior: 'deny' }])
  })

  it('AC-004-4: 続けて出た 2 件に、別々の応答を返せる（まとめて渡る）', async () => {
    await permission({ request_id: 'aaaaa' })
    await permission({ request_id: 'bbbbb' })
    await respond('aaaaa', { behavior: 'allow' })
    await respond('bbbbb', { behavior: 'deny' })
    // /poll が待っていなかったので、次の /poll が待たずに 200 を返す
    const res = await poll()
    assert.equal(res.status, 200)
    assert.deepEqual((await res.json()).verdicts, [
      { request_id: 'aaaaa', behavior: 'allow' },
      { request_id: 'bbbbb', behavior: 'deny' },
    ])
    assert.equal((await poll()).status, 204, '渡した応答は二度渡らない')
  })

  it('応答の形が不正なら 400、存在しない要求は 404', async () => {
    await permission()
    assert.equal((await respond('abcde', { behavior: 'maybe' })).status, 400)
    assert.equal((await respond('zzzzz', { behavior: 'allow' })).status, 404)
    assert.equal((await respond('abcde', { behavior: 'allow' }, 'nope')).status, 404)
  })

  it('AC-005-8: 閉じた要求への遅れた応答は 409 で、二重の応答にならない', async () => {
    await permission()
    assert.equal((await respond('abcde', { behavior: 'allow' })).status, 204)
    assert.equal((await respond('abcde', { behavior: 'deny' })).status, 409)
    const res = await poll()
    assert.deepEqual((await res.json()).verdicts, [{ request_id: 'abcde', behavior: 'allow' }])
  })

  it('AC-005-5: ターミナルで先に応答（作業中に戻る）されたら、要求が閉じる。遅れた応答は 409', async () => {
    await permission()
    await hook('PermissionRequest', { tool_name: 'Bash' })
    await sleep(80)
    await hook('PostToolUse', { tool_name: 'Bash' })
    assert.deepEqual(openRequests(), [])
    assert.equal((await respond('abcde', { behavior: 'allow' })).status, 409)
  })

  it('画面から許可した直後に次の要求が届き、前のツールの PostToolUse が遅れて届いても、次の要求は残る（実機で確認した競合）', async () => {
    await permission({ request_id: 'aaaaa' })
    assert.equal((await respond('aaaaa', { behavior: 'allow' })).status, 204)
    await permission({ request_id: 'bbbbb' })
    await hook('PostToolUse', { tool_name: 'Bash' }) // 前のツールの終了。次の要求より遅れて届く
    await hook('PermissionRequest', { tool_name: 'Bash' })
    assert.deepEqual(openRequests().map((r) => r.id), ['bbbbb'])
    assert.equal(hub.store.get('s1').state, 'permission')
    assert.equal((await respond('bbbbb', { behavior: 'deny' })).status, 204)
  })
})

describe('質問への回答（POST /ask）', () => {
  beforeEach(async () => { await ready() })

  it('AC-004-8, 004-10: 答えが入ると、待っていた /ask に 200 { answers } で返る', async () => {
    const pending = ask([colorQuestion])
    await until(() => openRequests().length === 1)
    const [r] = openRequests()
    assert.equal(r.kind, 'question')
    assert.deepEqual(r.questions[0].options.map((o) => o.label), ['赤', '青'])
    assert.equal((await respond(r.id, { answers: { '好きな色は？': '青' } })).status, 204)
    const res = await pending
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { answers: { '好きな色は？': '青' } })
    assert.deepEqual(openRequests(), [])
  })

  it('AC-004-9: 複数選択（配列）はカンマ区切りで返る', async () => {
    const pending = ask([colorQuestion, { ...colorQuestion, question: '果物は？', multiSelect: true }])
    await until(() => openRequests().length === 1)
    await respond(openRequests()[0].id, { answers: { '好きな色は？': '紫', '果物は？': ['りんご', 'バナナ'] } })
    assert.deepEqual((await (await pending).json()).answers, { '好きな色は？': '紫', '果物は？': 'りんご,バナナ' })
  })

  it('答えが不正（空・足りない）なら 400 で、質問は応答待ちのまま', async () => {
    const pending = ask([colorQuestion])
    await until(() => openRequests().length === 1)
    const id = openRequests()[0].id
    assert.equal((await respond(id, { answers: { '好きな色は？': '' } })).status, 400)
    assert.equal((await respond(id, { answers: {} })).status, 400)
    assert.equal(openRequests().length, 1)
    await respond(id, { answers: { '好きな色は？': '赤' } })
    assert.equal((await pending).status, 200)
  })

  it('操作モードでない・不明なセッションの質問は、待たずに 204（ターミナルに任せる）', async () => {
    await poll({ channel: false }, 'plain')
    const started = Date.now()
    assert.equal((await ask([colorQuestion], 'plain')).status, 204)
    assert.equal((await ask([colorQuestion], 'nope')).status, 204)
    assert.ok(Date.now() - started < 300)
  })

  it('questions が不正なら 400', async () => {
    assert.equal((await ask([])).status, 400)
    assert.equal((await ask('x')).status, 400)
  })

  it('AC-005-6: ターミナルで先に答えた（作業中に戻る）ら、待っていた /ask は 204 で終わり、要求が閉じる', async () => {
    const pending = ask([colorQuestion])
    await until(() => openRequests().length === 1)
    const id = openRequests()[0].id
    await hook('PermissionRequest', { tool_name: 'AskUserQuestion' })
    await sleep(80)
    await hook('PostToolUse', { tool_name: 'AskUserQuestion' })
    assert.equal((await pending).status, 204)
    assert.deepEqual(openRequests(), [])
    assert.equal((await respond(id, { answers: { '好きな色は？': '赤' } })).status, 409)
  })

  it('AC-005-7: フックが強制終了されて接続が切れたら、要求が閉じる', async () => {
    const controller = new AbortController()
    const pending = ask([colorQuestion], 's1', { signal: controller.signal }).catch(() => null)
    await until(() => openRequests().length === 1)
    controller.abort()
    await pending
    await until(() => openRequests().length === 0)
  })
})

describe('質問の時間切れ（AC-004-11）', () => {
  it('答えがないまま askWaitMs を過ぎたら 204 を返し、要求を閉じる', async () => {
    await hub.stop()
    await start({ askWaitMs: 150 })
    await ready()
    const statuses = []
    hub.requests.subscribe((c) => statuses.push(c.status))
    const started = Date.now()
    const res = await ask([colorQuestion])
    assert.equal(res.status, 204)
    assert.ok(Date.now() - started >= 140)
    assert.deepEqual(statuses, ['open', 'timeout'])
    assert.deepEqual(openRequests(), [])
  })
})

describe('保護（ADR 0012、AC-004-13）', () => {
  beforeEach(async () => {
    await ready()
    await permission()
  })

  it('AC-004-13: 保護を満たすリクエストは受け付ける', async () => {
    assert.equal((await respond('abcde', { behavior: 'allow' })).status, 204)
  })

  it('AC-004-13: 独自ヘッダーがなければ 403。要求は応答待ちのまま', async () => {
    assert.equal((await respond('abcde', { behavior: 'allow' }, 's1', { headers: { 'X-Coders-Hub': '' } })).status, 403)
    assert.equal(openRequests().length, 1)
  })

  it('AC-004-13: 他のサイトのページ（Origin が違う）からは 403', async () => {
    assert.equal((await respond('abcde', { behavior: 'allow' }, 's1', { headers: { Origin: 'https://evil.example' } })).status, 403)
  })

  it('AC-004-13: Host が違う（DNS リバインディング）と 403', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: ports.uiPort, path: '/api/sessions/s1/requests/abcde/response', method: 'POST',
          headers: { Host: `evil.example:${ports.uiPort}`, 'X-Coders-Hub': '1', 'Content-Type': 'application/json' } },
        (res) => { res.resume(); resolve(res.statusCode) },
      )
      req.on('error', reject)
      req.end(JSON.stringify({ behavior: 'allow' }))
    })
    assert.equal(status, 403)
    assert.equal(openRequests().length, 1)
  })

  it('AC-004-13: Content-Type が JSON でなければ 403', async () => {
    assert.equal((await respond('abcde', { behavior: 'allow' }, 's1', { headers: { 'Content-Type': 'text/plain' } })).status, 403)
  })
})

describe('WebSocket', () => {
  const connect = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${ports.uiPort}/ws`)
      const messages = []
      ws.on('message', (d) => messages.push(JSON.parse(d)))
      ws.on('open', () => resolve({ ws, messages }))
      ws.on('error', reject)
    })

  it('要求の状態の変化が request メッセージで届く。再接続のスナップショットに応答待ちの要求が含まれる', async () => {
    await ready()
    await permission()
    const { ws, messages } = await connect()
    try {
      await sleep(100)
      const snapshot = messages.find((m) => m.type === 'snapshot')
      const session = snapshot.sessions.find((s) => s.sessionId === 's1')
      assert.deepEqual(session.requests.map((r) => r.id), ['abcde'])
      await respond('abcde', { behavior: 'deny' })
      await sleep(100)
      const seen = messages.filter((m) => m.type === 'request' && m.id === 'abcde').map((m) => m.status)
      assert.deepEqual(seen, ['denied'])
    } finally {
      ws.close()
    }
  })
})
