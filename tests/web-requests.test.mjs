// 画面側の許可・質問への応答（機能 003）: 表示ロジック・クライアント・部品
// AC-004-1, 004-5, 004-7〜004-10, 005-5, 005-6
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MAX_ANSWER, PREVIEW_COLLAPSE_CHARS, REQUEST_LABEL, answerFor, buildAnswers, collapsePreview, collectSummaries, emptyDraft, parsePreview,
  previewLength, reduceRequest, requestRecordsFor, setOther, summarizeRequest, toggleOption, validateAnswers,
} from '../src/web/logic.mjs'
import { createClient } from '../src/web/client.mjs'
import { App, PermissionCard, QuestionCard, RequestInput, Requests } from '../src/web/components.mjs'

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

const permissionRequest = (extra = {}) => ({
  id: 'abcde', kind: 'permission', createdAt: 1, toolName: 'Bash', description: 'List files', inputPreview: '{ "command": "ls" }', ...extra,
})
const colorQuestion = {
  question: '好きな色は？', header: '色', multiSelect: false,
  options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
}
const fruitQuestion = {
  question: '好きな果物は？', header: '果物', multiSelect: true,
  options: [{ label: 'りんご', description: '甘酸っぱい' }, { label: 'みかん', description: '' }],
}
const questionRequest = (questions = [colorQuestion], extra = {}) => ({ id: 'q1', kind: 'question', createdAt: 1, questions, ...extra })
const sess = (id, extra = {}) => ({
  sessionId: id, state: 'permission', stateSince: 1, account: 'C:\\x\\.claude-a', cwd: 'D:\\p', lastPrompt: null, channelAlive: true,
  controllable: true, pending: [], requests: [], ...extra,
})

describe('入力の表示ロジック（AC-004-1）', () => {
  it('省略がなければそのまま。省略があれば、前半・後半・省略した文字数に分ける', () => {
    assert.deepEqual(parsePreview('{ "command": "ls" }'), { head: '{ "command": "ls" }', omitted: 0, tail: '' })
    const elided = 'AAAA\n⋯ 8509 code points elided ⋯\nBBBB'
    assert.deepEqual(parsePreview(elided), { head: 'AAAA', omitted: 8509, tail: 'BBBB' })
    assert.deepEqual(parsePreview(undefined), { head: '', omitted: 0, tail: '' })
  })

  it('折りたたむと、先頭の一定文字数だけになる。短ければそのまま', () => {
    const long = 'あ'.repeat(PREVIEW_COLLAPSE_CHARS + 50)
    assert.equal(Array.from(collapsePreview(long)).length, PREVIEW_COLLAPSE_CHARS + 1)
    assert.ok(collapsePreview(long).endsWith('…'))
    assert.equal(collapsePreview('短い'), '短い')
    assert.equal(previewLength('あいう'), 3)
  })
})

describe('質問の答えの組み立て（AC-004-8, 004-9）', () => {
  it('単一選択は 1 つだけ選べる。自由入力をすると選択が外れ、選択すると自由入力が消える', () => {
    let d = emptyDraft([colorQuestion])
    d = toggleOption(d, 0, colorQuestion, '赤')
    d = toggleOption(d, 0, colorQuestion, '青')
    assert.deepEqual(d[0].selected, ['青'])
    d = setOther(d, 0, colorQuestion, '紫')
    assert.deepEqual(d[0], { selected: [], other: '紫' })
    assert.equal(answerFor(colorQuestion, d[0]), '紫')
    d = toggleOption(d, 0, colorQuestion, '赤')
    assert.deepEqual(d[0], { selected: ['赤'], other: '' })
  })

  it('複数選択は選んだ順に集まり、もう一度押すと外れる。自由入力は選択に足される', () => {
    let d = emptyDraft([fruitQuestion])
    d = toggleOption(d, 0, fruitQuestion, 'りんご')
    d = toggleOption(d, 0, fruitQuestion, 'みかん')
    d = toggleOption(d, 0, fruitQuestion, 'りんご')
    assert.deepEqual(answerFor(fruitQuestion, d[0]), ['みかん'])
    d = setOther(d, 0, fruitQuestion, ' バナナ ')
    assert.deepEqual(answerFor(fruitQuestion, d[0]), ['みかん', 'バナナ'])
  })

  it('複数の質問をまとめて、質問文 → 答えにする', () => {
    const questions = [colorQuestion, fruitQuestion]
    let d = emptyDraft(questions)
    d = toggleOption(d, 0, colorQuestion, '青')
    d = toggleOption(d, 1, fruitQuestion, 'りんご')
    assert.deepEqual(buildAnswers(questions, d), { '好きな色は？': '青', '好きな果物は？': ['りんご'] })
  })

  it('すべての質問に答えるまで送れない（空・空白だけは答えにならない）', () => {
    const questions = [colorQuestion, fruitQuestion]
    let d = emptyDraft(questions)
    assert.equal(validateAnswers(questions, d).ok, false)
    d = toggleOption(d, 0, colorQuestion, '青')
    assert.equal(validateAnswers(questions, d).ok, false, '2 問目が未回答')
    d = setOther(d, 1, fruitQuestion, '   ')
    assert.equal(validateAnswers(questions, d).ok, false, '空白だけ')
    d = toggleOption(d, 1, fruitQuestion, 'みかん')
    assert.equal(validateAnswers(questions, d).ok, true)
  })

  it('答えは 2,000 文字まで', () => {
    let d = emptyDraft([colorQuestion])
    d = setOther(d, 0, colorQuestion, 'あ'.repeat(MAX_ANSWER))
    assert.equal(validateAnswers([colorQuestion], d).ok, true)
    d = setOther(d, 0, colorQuestion, 'あ'.repeat(MAX_ANSWER + 1))
    const result = validateAnswers([colorQuestion], d)
    assert.equal(result.ok, false)
    assert.match(result.reason, /2000/)
  })
})

describe('結果の記録（AC-005-5, 005-6）', () => {
  it('要求の説明は、応答待ちの間に集める。すでにあるものは作り直さない', () => {
    const sessions = new Map([['s1', sess('s1', { requests: [permissionRequest(), questionRequest()] })]])
    const summaries = collectSummaries(new Map(), sessions)
    assert.equal(summaries.get('abcde'), 'Bash: List files')
    assert.equal(summaries.get('q1'), '質問: 色')
    assert.equal(collectSummaries(summaries, sessions), summaries)
  })

  it('説明は本文（入力や選択肢）を含めず、長いときは切る', () => {
    const s = summarizeRequest(permissionRequest({ description: 'あ'.repeat(200), inputPreview: 'ひみつ' }))
    assert.ok(!s.includes('ひみつ'))
    assert.ok(Array.from(s).length <= 61)
  })

  it('request メッセージで閉じた結果が記録される。応答待ち（open）は記録しない', () => {
    const summaries = new Map([['abcde', 'Bash: List files']])
    let records = reduceRequest(new Map(), { type: 'request', sessionId: 's1', id: 'abcde', status: 'open' }, summaries)
    assert.equal(records.size, 0)
    records = reduceRequest(records, { type: 'request', sessionId: 's1', id: 'abcde', status: 'terminal' }, summaries)
    assert.deepEqual(records.get('abcde'), { id: 'abcde', sessionId: 's1', status: 'terminal', summary: 'Bash: List files' })
    records = reduceRequest(records, { type: 'request', sessionId: 's1', id: 'zzz', status: 'failed', reason: 'セッションが終了しました' })
    assert.equal(records.get('zzz').reason, 'セッションが終了しました')
    assert.equal(records.get('zzz').summary, undefined)
  })

  it('requestRecordsFor は、そのセッションの記録を最大件数まで返す', () => {
    let records = new Map()
    for (let i = 0; i < 7; i++) records = reduceRequest(records, { type: 'request', sessionId: i % 2 ? 's2' : 's1', id: `r${i}`, status: 'allowed' })
    assert.deepEqual(requestRecordsFor(records, 's1', 3).map((r) => r.id), ['r2', 'r4', 'r6'])
  })
})

describe('createClient（応答の送信と結果の記録）', () => {
  const setup = (fetchImpl) => {
    const sockets = []
    class FakeWebSocket {
      constructor(url) { this.url = url; sockets.push(this) }
      close() { this.onclose?.() }
      receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
    }
    const states = []
    const client = createClient({ url: 'ws://hub/ws', onChange: (st) => states.push(st), WebSocketImpl: FakeWebSocket, fetchImpl, now: () => 10_000, setTimer: () => 1, clearTimer: () => {} })
    return { client, sockets, last: () => states.at(-1) }
  }

  it('AC-004-2: 許可の応答は、独自ヘッダーと JSON を付けて、決まった経路に POST する', async () => {
    const calls = []
    const { client } = setup(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 } })
    const result = await client.respondRequest('s 1', 'abcde', { behavior: 'allow' })
    assert.deepEqual(result, { ok: true })
    assert.equal(calls[0].url, '/api/sessions/s%201/requests/abcde/response')
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers['X-Coders-Hub'], '1')
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(calls[0].init.body), { behavior: 'allow' })
  })

  it('エラーの理由を返す（すでに閉じている／接続できない）', async () => {
    const closed = setup(async () => ({ ok: false, status: 409, json: async () => ({ error: 'not-open', message: 'すでに閉じています' }) }))
    assert.deepEqual(await closed.client.respondRequest('s1', 'a', { behavior: 'allow' }), { ok: false, reason: 'すでに閉じています' })
    const down = setup(async () => { throw new Error('refused') })
    assert.deepEqual(await down.client.respondRequest('s1', 'a', { behavior: 'allow' }), { ok: false, reason: 'Hub に接続できません' })
  })

  it('AC-005-5: ターミナルで先に応答されると、行の要求が消え、結果（説明つき）が残る。閉じる操作で消せる', () => {
    const { client, sockets, last } = setup(async () => ({ ok: true }))
    client.start()
    const ws = sockets[0]
    ws.receive({ type: 'snapshot', now: 10_000, sessions: [sess('s1', { requests: [permissionRequest()] })] })
    assert.equal(last().sessions.get('s1').requests.length, 1)
    // Hub は、セッションの更新（要求が消える）を先に、request メッセージを後に送る
    ws.receive({ type: 'updated', session: sess('s1', { state: 'working', requests: [] }) })
    ws.receive({ type: 'request', sessionId: 's1', id: 'abcde', status: 'terminal' })
    assert.deepEqual(last().requestRecords.get('abcde'), { id: 'abcde', sessionId: 's1', status: 'terminal', summary: 'Bash: List files' })
    client.dismissRequest('abcde')
    assert.equal(last().requestRecords.size, 0)
  })
})

describe('部品の表示', () => {
  it('AC-004-1: 許可要求に、ツール名・説明・入力の内容・「許可」「拒否」が出る', () => {
    const t = text(renderToStaticMarkup(h(PermissionCard, { sessionId: 's1', request: permissionRequest() })))
    for (const word of ['Bash', 'List files', '&quot;command&quot;: &quot;ls&quot;', '許可', '拒否']) assert.ok(t.includes(word), word)
    assert.ok(!t.includes('すべて表示'), '短い入力は折りたたまない')
  })

  it('AC-004-1: 長い入力は折りたたまれ、「すべて表示」がある', () => {
    const preview = 'x'.repeat(PREVIEW_COLLAPSE_CHARS + 500)
    const html = renderToStaticMarkup(h(RequestInput, { preview }))
    assert.match(html, /data-collapsed="true"/)
    assert.ok(text(html).includes('すべて表示'))
    assert.ok(!html.includes('x'.repeat(PREVIEW_COLLAPSE_CHARS + 100)), '折りたたんだ分は出ない')
  })

  it('AC-004-1: claude が省略して渡した入力には、省略があることと文字数が出る', () => {
    const preview = `${'a'.repeat(100)}\n⋯ 8509 code points elided ⋯\n${'b'.repeat(100)}`
    const html = renderToStaticMarkup(h(RequestInput, { preview }))
    assert.match(html, /data-hint="elided"/)
    assert.ok(text(html).includes('省略: 8509 文字'))
    assert.ok(text(html).includes('全文は確認できません'), '全文を見られる場所があるとは書かない')
    assert.ok(text(html).includes('拒否してください'))
    assert.equal(text(html).includes('ターミナルで確認'), false)
    assert.equal(renderToStaticMarkup(h(RequestInput, { preview: '{ "command": "ls" }' })).includes('data-hint="elided"'), false)
  })

  it('AC-004-7: 質問に、質問文・選択肢のラベルと説明・複数選択の表示・自由入力・回答ボタンが出る。未回答の間は送れない', () => {
    const html = renderToStaticMarkup(h(QuestionCard, { sessionId: 's1', request: questionRequest([colorQuestion, fruitQuestion]) }))
    const t = text(html)
    for (const word of ['好きな色は？', '赤', '情熱', '青', '落ち着き', '好きな果物は？', 'りんご', '甘酸っぱい', '（複数選択）', 'その他', '回答する']) {
      assert.ok(t.includes(word), word)
    }
    assert.match(html, /type="radio"/)
    assert.match(html, /type="checkbox"/)
    assert.match(html, /<button[^>]*class="send"[^>]*disabled=""/)
    assert.ok(t.includes('すべての質問に答えてください'))
  })

  it('結果が出る（ターミナルで応答済み／時間切れなど）。説明と閉じる操作つき', () => {
    const records = [
      { id: 'a', sessionId: 's1', status: 'terminal', summary: 'Bash: List files' },
      { id: 'b', sessionId: 's1', status: 'timeout', summary: '質問: 色' },
    ]
    const html = renderToStaticMarkup(h(Requests, { sessionId: 's1', requests: [], records }))
    const t = text(html)
    assert.ok(t.includes(REQUEST_LABEL.terminal) && t.includes('Bash: List files'))
    assert.ok(t.includes(REQUEST_LABEL.timeout))
    assert.match(html, /data-request-status="terminal"/)
    assert.match(html, /aria-label="結果を閉じる"/)
  })

  it('AC-004-5: 行に応答待ちの要求があれば出る。なければ出ない', () => {
    const withRequest = new Map([['s1', sess('s1', { requests: [permissionRequest(), questionRequest()] })]])
    const state = (sessions) => ({ sessions, connected: true, ready: true, offset: 0, instructions: new Map(), requestRecords: new Map(), requestSummaries: new Map() })
    const html = renderToStaticMarkup(h(App, { state: state(withRequest), now: 10_000, filter: 'all' }))
    assert.match(html, /data-request-kind="permission"/)
    assert.match(html, /data-request-kind="question"/)
    const none = renderToStaticMarkup(h(App, { state: state(new Map([['s1', sess('s1')]])), now: 10_000, filter: 'all' }))
    assert.doesNotMatch(none, /data-request-kind/)
  })
})
