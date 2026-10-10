// 許可要求・質問の待ち行列（機能 003、ADR 0002・0014）。
// AC-004-2〜004-4, 004-8〜004-12, 005-5, 005-6, 005-8
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/hub/sessions.mjs'
import { createRequests, RequestError, MAX_ANSWER_CHARS } from '../src/hub/requests.mjs'

let clock, store, req, changes, verdictCalls

const hook = (event, extra = {}, session = 's1') =>
  store.applyHookEvent({ event, account: 'A', input: { session_id: session, cwd: 'D:\\p', ...extra } })

// 操作モードのチャネルサーバーが接続しているセッションを用意する
const setup = (session = 's1', { channel = true } = {}) => {
  store.registerChannel({ sessionId: session, account: 'A', cwd: 'D:\\p', channel })
  hook('UserPromptSubmit', { prompt: 'やって' }, session)
}

const colorQuestion = {
  question: '好きな色は？',
  header: '色',
  options: [{ label: '赤', description: '情熱' }, { label: '青', description: '落ち着き' }],
  multiSelect: false,
}
const fruitQuestion = {
  question: '好きな果物は？',
  header: '果物',
  options: [{ label: 'りんご', description: '' }, { label: 'みかん', description: '' }],
  multiSelect: true,
}

const permission = (id = 'abcde', extra = {}) =>
  req.addPermission('s1', { requestId: id, toolName: 'Bash', description: 'List files', inputPreview: '{ "command": "ls" }', ...extra })

const statuses = () => changes.map((c) => `${c.id}:${c.status}`)

beforeEach(() => {
  clock = { t: 1_000_000 }
  const now = () => clock.t
  let n = 0
  store = createStore({ now })
  verdictCalls = []
  req = createRequests({ store, now, newId: () => `q${++n}`, keepMs: 60_000, onVerdict: (s) => verdictCalls.push(s) })
  changes = []
  req.subscribe((c) => changes.push(c))
  setup()
})

describe('許可要求の受け付け', () => {
  it('許可要求が行の requests に載る（AC-004-1 の元データ）', () => {
    permission()
    const [r] = store.get('s1').requests
    assert.deepEqual({ ...r, createdAt: undefined }, {
      id: 'abcde', kind: 'permission', createdAt: undefined,
      toolName: 'Bash', description: 'List files', inputPreview: '{ "command": "ls" }',
    })
    assert.deepEqual(statuses(), ['abcde:open'])
  })

  it('同じ request_id が応答待ちなら、二重には載せない', () => {
    permission()
    permission()
    assert.equal(store.get('s1').requests.length, 1)
  })

  it('request_id・tool_name がなければ受け付けない', () => {
    assert.throws(() => req.addPermission('s1', { toolName: 'Bash' }), (e) => e instanceof RequestError && e.code === 'invalid')
    assert.throws(() => req.addPermission('s1', { requestId: 'x' }), (e) => e.code === 'invalid')
  })

  it('AC-004-5: 存在しないセッション・操作モードでないセッションには載せない', () => {
    assert.throws(() => req.addPermission('nope', { requestId: 'x', toolName: 'Bash' }), (e) => e.code === 'not-found')
    setup('plain', { channel: false })
    assert.throws(() => req.addPermission('plain', { requestId: 'x', toolName: 'Bash' }), (e) => e.code === 'not-controllable')
  })
})

describe('許可・拒否の応答（AC-004-2〜004-4）', () => {
  it('AC-004-2: 許可すると、チャネルサーバーへ返す応答（allow）がたまり、要求が閉じる', () => {
    permission('abcde')
    req.respond('s1', 'abcde', { behavior: 'allow' })
    assert.deepEqual(verdictCalls, ['s1'])
    assert.deepEqual(req.takeVerdicts('s1'), [{ request_id: 'abcde', behavior: 'allow' }])
    assert.deepEqual(req.takeVerdicts('s1'), [], '取り出したら空になる')
    assert.equal(store.get('s1').requests.length, 0)
    assert.deepEqual(statuses(), ['abcde:open', 'abcde:allowed'])
  })

  it('AC-004-3: 拒否すると deny の応答がたまる', () => {
    permission('abcde')
    req.respond('s1', 'abcde', { behavior: 'deny' })
    assert.deepEqual(req.takeVerdicts('s1'), [{ request_id: 'abcde', behavior: 'deny' }])
    assert.deepEqual(statuses(), ['abcde:open', 'abcde:denied'])
  })

  it('AC-004-4: 要求が続けて出ても、ID ごとに別々の応答を返せる', () => {
    permission('aaaaa')
    permission('bbbbb')
    req.respond('s1', 'aaaaa', { behavior: 'allow' })
    req.respond('s1', 'bbbbb', { behavior: 'deny' })
    assert.deepEqual(req.takeVerdicts('s1'), [
      { request_id: 'aaaaa', behavior: 'allow' },
      { request_id: 'bbbbb', behavior: 'deny' },
    ])
  })

  it('behavior が allow／deny 以外なら受け付けず、要求は応答待ちのまま', () => {
    permission('abcde')
    for (const behavior of ['maybe', undefined, 1]) {
      assert.throws(() => req.respond('s1', 'abcde', { behavior }), (e) => e.code === 'invalid')
    }
    assert.equal(store.get('s1').requests.length, 1)
    assert.deepEqual(req.takeVerdicts('s1'), [])
  })

  it('存在しない要求・別のセッションの要求には応答できない', () => {
    permission('abcde')
    assert.throws(() => req.respond('s1', 'zzzzz', { behavior: 'allow' }), (e) => e.code === 'not-found')
    setup('s2')
    assert.throws(() => req.respond('s2', 'abcde', { behavior: 'allow' }), (e) => e.code === 'not-found')
  })
})

describe('質問への回答（AC-004-8〜004-10）', () => {
  it('質問が行の requests に載る。選択肢のラベルと説明、複数選択かどうかが分かる（AC-004-7 の元データ）', () => {
    req.addQuestion('s1', { questions: [colorQuestion, fruitQuestion] })
    const [r] = store.get('s1').requests
    assert.equal(r.kind, 'question')
    assert.equal(r.id, 'q1')
    assert.deepEqual(r.questions[0], colorQuestion)
    assert.equal(r.questions[1].multiSelect, true)
  })

  it('AC-004-8: 単一選択に答えると、待っているフックへ答えが渡り、要求が閉じる', async () => {
    const { id, result } = req.addQuestion('s1', { questions: [colorQuestion] })
    req.respond('s1', id, { answers: { '好きな色は？': '青' } })
    assert.deepEqual(await result, { '好きな色は？': '青' })
    assert.equal(store.get('s1').requests.length, 0)
    assert.deepEqual(statuses(), ['q1:open', 'q1:answered'])
  })

  it('AC-004-9: 複数の質問・複数選択（配列）・自由入力をまとめて答えられる。配列はカンマ区切りになる', async () => {
    const { id, result } = req.addQuestion('s1', { questions: [colorQuestion, fruitQuestion] })
    req.respond('s1', id, { answers: { '好きな色は？': '紫', '好きな果物は？': ['りんご', 'バナナ'] } })
    assert.deepEqual(await result, { '好きな色は？': '紫', '好きな果物は？': 'りんご,バナナ' })
  })

  it('答えがない質問があれば受け付けず、要求は応答待ちのまま', () => {
    const { id } = req.addQuestion('s1', { questions: [colorQuestion, fruitQuestion] })
    assert.throws(() => req.respond('s1', id, { answers: { '好きな色は？': '赤' } }), (e) => e.code === 'invalid')
    assert.equal(store.get('s1').requests.length, 1)
  })

  it('空・空白だけ・空の配列・文字列でない答えは受け付けない（モデルに「回答なし」と伝わるため）', () => {
    const { id } = req.addQuestion('s1', { questions: [colorQuestion] })
    for (const v of ['', '  ', [], [''], 5, null, ['赤', ' ']]) {
      assert.throws(() => req.respond('s1', id, { answers: { '好きな色は？': v } }), (e) => e.code === 'invalid', JSON.stringify(v))
    }
    assert.throws(() => req.respond('s1', id, { answers: 'x' }), (e) => e.code === 'invalid')
    assert.throws(() => req.respond('s1', id, {}), (e) => e.code === 'invalid')
  })

  it('答えは 2,000 文字まで。選択肢にない文字列は受け付ける（自由入力）', () => {
    const { id } = req.addQuestion('s1', { questions: [colorQuestion] })
    assert.throws(() => req.respond('s1', id, { answers: { '好きな色は？': 'あ'.repeat(MAX_ANSWER_CHARS + 1) } }), (e) => e.code === 'invalid')
    assert.doesNotThrow(() => req.respond('s1', id, { answers: { '好きな色は？': 'あ'.repeat(MAX_ANSWER_CHARS) } }))
  })

  it('questions が不正なら受け付けない', () => {
    for (const questions of [undefined, [], [{}], [{ question: '' }], 'x']) {
      assert.throws(() => req.addQuestion('s1', { questions }), (e) => e.code === 'invalid')
    }
  })
})

describe('閉じる処理（AC-004-11, AC-005-5〜005-8）', () => {
  it('AC-004-11: 質問が時間切れで閉じられると、待っているフックには答えなし（null）が返る', async () => {
    const { id, result } = req.addQuestion('s1', { questions: [colorQuestion] })
    assert.equal(req.close('s1', id, 'timeout'), true)
    assert.equal(await result, null)
    assert.deepEqual(statuses(), ['q1:open', 'q1:timeout'])
    assert.equal(req.close('s1', id, 'timeout'), false, '二度は閉じられない')
  })

  it('AC-005-5: ツールが終わったら（ターミナルで先に許可）、許可要求が terminal で閉じる', () => {
    permission('abcde')
    hook('PermissionRequest', { tool_name: 'Bash' })
    assert.equal(store.get('s1').state, 'permission')
    assert.equal(store.get('s1').requests.length, 1, '許可待ちの間は閉じない')
    clock.t += 3000
    hook('PostToolUse', { tool_name: 'Bash' })
    assert.equal(store.get('s1').state, 'working')
    assert.equal(store.get('s1').requests.length, 1, '作業中に戻っただけでは閉じない（ツールの終了で閉じる）')
    assert.equal(req.toolDone('s1', 'Bash'), 'abcde')
    assert.equal(store.get('s1').requests.length, 0)
    assert.deepEqual(statuses(), ['abcde:open', 'abcde:terminal'])
  })

  it('AC-005-6: 質問のツールが終わったら、質問が terminal で閉じ、フックには答えなしが返る', async () => {
    const { result } = req.addQuestion('s1', { questions: [colorQuestion] })
    hook('PermissionRequest', { tool_name: 'AskUserQuestion' })
    assert.equal(store.get('s1').state, 'question')
    clock.t += 3000
    assert.equal(req.toolDone('s1', 'AskUserQuestion'), 'q1')
    assert.equal(await result, null)
    assert.deepEqual(statuses(), ['q1:open', 'q1:terminal'])
  })

  it('ツールの終了は、別のツールの要求・別の種類の要求を閉じない。最も古いものから 1 件ずつ閉じる', async () => {
    permission('aaaaa')
    permission('bbbbb')
    req.addQuestion('s1', { questions: [colorQuestion] })
    clock.t += 3000
    assert.equal(req.toolDone('s1', 'Write'), null, '別のツール')
    assert.equal(req.toolDone('s1', 'Bash'), 'aaaaa')
    assert.equal(req.toolDone('s1', 'Bash'), 'bbbbb')
    assert.equal(req.toolDone('s1', 'Bash'), null, '許可要求は残っていない（質問は閉じない）')
    assert.equal(store.get('s1').requests.length, 1)
    assert.equal(req.toolDone('s1', 'AskUserQuestion'), 'q1')
  })

  it('画面から許可した直後に、次の要求が先に届き、前のツールの終了が遅れて届いても、次の要求は閉じない（実機で確認した競合）', () => {
    permission('aaaaa')
    req.respond('s1', 'aaaaa', { behavior: 'allow' }) // 画面から許可
    clock.t += 5
    permission('bbbbb') // 次の要求が、前のツールの PostToolUse より先に届く
    clock.t += 50
    assert.equal(req.toolDone('s1', 'Bash'), null, '前のツールの終了で、届いたばかりの要求を閉じない')
    assert.equal(store.get('s1').requests.length, 1)
    // 本当にターミナルで先に応答されたときは、猶予のあとの終了で閉じる
    clock.t += 3000
    assert.equal(req.toolDone('s1', 'Bash'), 'bbbbb')
  })

  it('AC-005-7: ターミナルでの拒否・中断（返答待ちへの変化）でも閉じる', () => {
    permission('abcde')
    hook('PermissionRequest', { tool_name: 'Bash' })
    clock.t += 3000
    store.applyInterruption('s1', clock.t)
    assert.equal(store.get('s1').state, 'waiting')
    assert.equal(store.get('s1').requests.length, 0)
  })

  it('要求より前の返答待ちへの変化では閉じない（状態の通知が遅れて届いたとき）', () => {
    // 前のターンの Stop が、次のターンの要求より遅れて処理される
    hook('Stop')
    clock.t += 3000
    permission('abcde')
    assert.equal(store.get('s1').state, 'waiting')
    assert.equal(store.get('s1').requests.length, 1)
    clock.t += 100
    hook('PermissionRequest', { tool_name: 'Bash' })
    assert.equal(store.get('s1').state, 'permission')
    assert.equal(store.get('s1').requests.length, 1)
  })

  it('AC-005-8: 閉じた要求への遅れた応答は受け付けない（not-open）。二重の応答にならない', () => {
    permission('abcde')
    hook('PermissionRequest', { tool_name: 'Bash' })
    clock.t += 3000
    req.toolDone('s1', 'Bash')
    assert.throws(() => req.respond('s1', 'abcde', { behavior: 'allow' }), (e) => e.code === 'not-open')
    assert.deepEqual(req.takeVerdicts('s1'), [])
  })

  it('セッションが終了したら、応答待ちの要求は failed で閉じる。質問を待つフックには答えなし', async () => {
    permission('abcde')
    const { result } = req.addQuestion('s1', { questions: [colorQuestion] })
    hook('SessionEnd')
    assert.equal(await result, null)
    assert.deepEqual(statuses(), ['abcde:open', 'q1:open', 'abcde:failed', 'q1:failed'])
    assert.equal(changes.at(-1).reason, 'セッションが終了しました')
  })

  it('AC-004-12: 閉じたあと、要求の本文はどこにも残らない', () => {
    permission('abcde', { inputPreview: 'ひみつの内容' })
    const { id } = req.addQuestion('s1', { questions: [colorQuestion] })
    req.respond('s1', 'abcde', { behavior: 'allow' })
    req.respond('s1', id, { answers: { '好きな色は？': '赤' } })
    assert.deepEqual(store.get('s1').requests, [])
    assert.deepEqual(req.list('s1'), [])
    // 取り出す応答には ID と結果しかない
    assert.deepEqual(req.takeVerdicts('s1'), [{ request_id: 'abcde', behavior: 'allow' }])
    assert.ok(!JSON.stringify(changes).includes('ひみつの内容'))
  })

  it('閉じた要求の記録は 60 秒後に消え、そのあとの応答は not-found になる', () => {
    permission('abcde')
    req.respond('s1', 'abcde', { behavior: 'allow' })
    clock.t += 59_000
    req.tick()
    assert.throws(() => req.respond('s1', 'abcde', { behavior: 'allow' }), (e) => e.code === 'not-open')
    clock.t += 2_000
    req.tick()
    assert.throws(() => req.respond('s1', 'abcde', { behavior: 'allow' }), (e) => e.code === 'not-found')
  })
})
