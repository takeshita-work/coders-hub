// 会話ログの読み取り（機能 004）。形式は、実機の会話ログで確認したもの（user／assistant／tool_use／tool_result／origin: channel）
// AC-007-1〜9, 13, 15〜19
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MAX_TEXT, buildMessages, isTranscriptPath, locateTranscript, readConversation, realFiles } from '../src/hub/conversation.mjs'

// ---- 会話ログのレコードを作る ----
let seq = 0
const ts = () => new Date(Date.UTC(2026, 9, 11, 12, 0, seq++)).toISOString()
const userText = (text, extra = {}) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: text }, ...extra })
const assistantText = (text) => ({ type: 'assistant', timestamp: ts(), message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text }] } })
const toolUse = (id, name, input = {}) => ({ type: 'assistant', timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
const toolResult = (id, content, extra = {}, entryExtra = {}) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] }, ...entryExtra })
const channel = (id, text) => ({
  type: 'user', timestamp: ts(), isMeta: true, origin: { kind: 'channel', server: 'coders-hub' },
  message: { role: 'user', content: `<channel source="coders-hub" id="${id}">\n${text}\n</channel>` },
})
const lines = (records) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n'
const parse = (records) => buildMessages(records.map((entry, i) => ({ offset: i * 100, entry })))

describe('レコード → メッセージ（AC-007-2〜5, 9）', () => {
  it('AC-007-2: 利用者の発言と Claude の応答が、古い順に取り出される（時刻つき）', () => {
    const m = parse([userText('こんにちは'), assistantText('はい')])
    assert.deepEqual(m.map((x) => [x.role, x.text]), [['user', 'こんにちは'], ['assistant', 'はい']])
    assert.equal(typeof m[0].at, 'number')
  })

  it('AC-007-3: ダッシュボードから送った指示は、isMeta でも出る。ID と本文を取り出す', () => {
    const m = parse([channel('9ru6yx', '終わったら「完了」と答えて')])
    assert.deepEqual([m[0].role, m[0].source, m[0].instructionId, m[0].text], ['user', 'dashboard', '9ru6yx', '終わったら「完了」と答えて'])
  })

  it('他の isMeta の注入・他のチャネルの記録は出ない', () => {
    const m = parse([userText('注入', { isMeta: true }), { ...channel('x', 'y'), origin: { kind: 'channel', server: 'other' } }])
    assert.deepEqual(m, [])
  })

  it('AC-007-4: ツールの使用は 1 行（名前・要点・結果）。成功・拒否・エラーを区別する。出力の内容は含まない（入力の要点は含む。ADR 0029）', () => {
    const m = parse([
      toolUse('t1', 'Bash', { command: 'ひみつのコマンド' }), toolResult('t1', 'ひみつの出力'),
      toolUse('t2', 'Edit', {}), toolResult('t2', "The user doesn't want to proceed with this tool use. The tool use was rejected", { is_error: true }),
      toolUse('t3', 'Read', {}), toolResult('t3', 'ENOENT', { is_error: true }),
      toolUse('t4', 'Write', {}),
    ])
    assert.deepEqual(m.map((x) => [x.role, x.tool.name, x.tool.result]), [['tool', 'Bash', 'ok'], ['tool', 'Edit', 'rejected'], ['tool', 'Read', 'error'], ['tool', 'Write', null]])
    assert.doesNotMatch(JSON.stringify(m), /ひみつの出力|ENOENT/, '出力は、含まない')
    assert.deepEqual([m[0].tool.summary, m[0].tool.detail], ['ひみつのコマンド', 'ひみつのコマンド'], 'コマンドは、要点と全文になる')
    assert.deepEqual(Object.keys(m[1].tool).sort(), ['name', 'result'], '入力が取れなければ、要点・全文はなし')
  })

  it('AC-007-5: AskUserQuestion は、質問文と選ばれた答えが出る', () => {
    const m = parse([
      toolUse('q1', 'AskUserQuestion', { questions: [{ question: '好きな色は？', options: [] }, { question: '果物は？', options: [] }] }),
      toolResult('q1', 'Your questions have been answered', {}, { toolUseResult: { answers: { '好きな色は？': '赤', '果物は？': 'りんご,みかん' } } }),
    ])
    assert.equal(m[0].role, 'question')
    assert.deepEqual(m[0].answers, [{ question: '好きな色は？', answer: '赤' }, { question: '果物は？', answer: 'りんご,みかん' }])
  })

  it('AC-007-9: 思考・サブエージェント・スラッシュコマンド・中断・システムの記録は出ない', () => {
    const m = parse([
      { type: 'assistant', timestamp: ts(), message: { content: [{ type: 'thinking', thinking: '内心' }] } },
      assistantText('サブ', { isSidechain: true }) && { ...assistantText('サブ'), isSidechain: true },
      userText('<command-name>/clear</command-name>'), userText('<local-command-stdout>x</local-command-stdout>'),
      userText('[Request interrupted by user]'), userText('<system-reminder>x</system-reminder>'),
      { type: 'system', timestamp: ts(), content: 'フック' }, { type: 'attachment', timestamp: ts() }, { type: 'last-prompt' }, { type: 'unknown-type' },
      userText('本物の発言'),
    ])
    assert.deepEqual(m.map((x) => x.text), ['本物の発言'])
  })

  it('AC-007-6: 文章は、書式を解釈せずそのまま持つ（HTML のタグも文字のまま。画面は React が文字として出す）', () => {
    const m = parse([assistantText('<script>alert(1)</script>\n**太字**')])
    assert.equal(m[0].text, '<script>alert(1)</script>\n**太字**')
  })

  it('AC-007-7: 4,000 文字を超える発言は省略される', () => {
    const m = parse([assistantText('あ'.repeat(MAX_TEXT + 500)), assistantText('い'.repeat(MAX_TEXT))])
    assert.equal(Array.from(m[0].text).length, MAX_TEXT)
    assert.equal(m[0].truncated, true)
    assert.equal(m[1].truncated, undefined)
  })

  it('content が文字列でなく text ブロックの配列でも、利用者の発言として出る', () => {
    const m = parse([{ type: 'user', timestamp: ts(), message: { content: [{ type: 'text', text: 'ブロックの発言' }] } }])
    assert.equal(m[0].text, 'ブロックの発言')
  })
})

describe('ファイルの読み取り（AC-007-1, 8, 13, 17〜19）', () => {
  let dir
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-conv-')) })
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const write = (name, content) => { const f = path.join(dir, name); fs.writeFileSync(f, content); return f }
  const conversation = (n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? userText(`発言 ${i}`) : assistantText(`応答 ${i}`)))
  const texts = (page) => page.messages.map((m) => m.text)

  it('AC-007-1: 直近の 20 件が、古い順で返る', async () => {
    const f = write('a.jsonl', lines(conversation(50)))
    const page = await readConversation(f)
    assert.equal(page.messages.length, 20)
    assert.equal(texts(page)[0], '発言 30')
    assert.equal(texts(page).at(-1), '応答 49')
    assert.notEqual(page.cursor, null)
    assert.match(page.etag, /^W\/"\d+-\d+"$/)
  })

  it('AC-007-8: cursor でさかのぼると、全体が重複も欠けもなく、先頭まで読める（上限なし）', async () => {
    const f = write('b.jsonl', lines(conversation(257)))
    const all = []
    let cursor = null
    let pages = 0
    do {
      const page = await readConversation(f, { before: cursor })
      all.unshift(...texts(page))
      cursor = page.cursor
      pages++
    } while (cursor !== null)
    assert.equal(all.length, 257)
    assert.deepEqual(all, conversation(257).map((r) => r.message.content?.[0]?.text ?? r.message.content))
    assert.equal(pages, 13)
  })

  it('小さな limit や、大きなレコードでも、同じレコードのメッセージが分かれない', async () => {
    const f = write('c.jsonl', lines([userText('a'), { type: 'assistant', timestamp: ts(), message: { content: [{ type: 'text', text: 'b1' }, { type: 'text', text: 'b2' }] } }, userText('c')]))
    const first = await readConversation(f, { limit: 2 })
    assert.deepEqual(texts(first), ['b1', 'b2', 'c'], '同じレコードは分けない')
    const second = await readConversation(f, { limit: 2, before: first.cursor })
    assert.deepEqual(texts(second), ['a'])
    assert.equal(second.cursor, null)
  })

  it('ツールの使用と結果が、ページの境目で離れていても、結果が付く（先読み）', async () => {
    const records = [userText('依頼'), toolUse('t1', 'Bash'), toolResult('t1', 'x'), assistantText('終わり')]
    const f = write('d.jsonl', lines(records))
    const newest = await readConversation(f, { limit: 1 })
    assert.deepEqual(texts(newest), ['終わり'])
    const older = await readConversation(f, { limit: 1, before: newest.cursor })
    const tool = older.messages.find((m) => m.role === 'tool')
    assert.equal(tool.tool.result, 'ok', '結果は、ページの外（後ろ）にあっても突き合わせる')
  })

  it('AC-007-1: 件数は、発言・応答・質問の数。ツールの行は数えず、その間に含まれる', async () => {
    const records = []
    for (let i = 0; i < 10; i++) {
      records.push(userText(`発言 ${i}`))
      for (let t = 0; t < 4; t++) { records.push(toolUse(`t${i}-${t}`, 'Bash'), toolResult(`t${i}-${t}`, 'x')) }
    }
    const f = write('tools.jsonl', lines(records))
    const page = await readConversation(f, { limit: 3 })
    const speech = page.messages.filter((m) => m.role !== 'tool')
    assert.deepEqual(speech.map((m) => m.text), ['発言 7', '発言 8', '発言 9'])
    assert.equal(page.messages.filter((m) => m.role === 'tool').length, 12, '発言 7・8・9 のあとのツールの行（4 つずつ）は、件数に数えず、含まれる')
    const older = await readConversation(f, { limit: 3, before: page.cursor })
    assert.deepEqual(older.messages.filter((m) => m.role !== 'tool').map((m) => m.text), ['発言 4', '発言 5', '発言 6'])
  })

  it('AC-007-18: 壊れた行と、書き込み途中の末尾の行は、飛ばして読める分を返す', async () => {
    const f = write('e.jsonl', `${lines([userText('一つ目')])}壊れた行\n${lines([assistantText('二つ目')])}{"type":"user","timestamp":"x","message":{"content":"途中で切`)
    assert.deepEqual(texts(await readConversation(f)), ['一つ目', '二つ目'])
  })

  it('空のファイル・メッセージのないファイルは、空で返る', async () => {
    assert.deepEqual((await readConversation(write('f.jsonl', ''))).messages, [])
    const page = await readConversation(write('g.jsonl', lines([{ type: 'system' }, { type: 'last-prompt' }])))
    assert.deepEqual([page.messages.length, page.cursor], [0, null])
  })

  it('AC-007-13: 読んだ内容を残さない。ファイルが変わったら、次の取得は新しい内容を返す', async () => {
    const f = write('h.jsonl', lines([userText('古い')]))
    const before = await readConversation(f)
    fs.appendFileSync(f, lines([assistantText('新しい')]))
    const after2 = await readConversation(f)
    assert.deepEqual(texts(before), ['古い'])
    assert.deepEqual(texts(after2), ['古い', '新しい'])
    assert.notEqual(before.etag, after2.etag)
  })

  it('AC-007-19: 10 MB を超えるログでも、最新の 20 件は一部だけを読み、1 秒以内に返る。さかのぼってもログ全体は読まない', async () => {
    const filler = { type: 'attachment', timestamp: '2026-10-11T00:00:00Z', attachment: { text: 'x'.repeat(1000) } }
    const records = []
    for (let i = 0; i < 12_000; i++) {
      records.push(filler)
      if (i % 40 === 0) records.push(i % 80 === 0 ? userText(`発言 ${i}`) : assistantText(`応答 ${i}`))
    }
    const f = write('big.jsonl', lines(records))
    assert.ok(fs.statSync(f).size > 10 * 1024 * 1024)
    let bytes = 0
    const counting = { ...realFiles, read: async (file, start, end) => { const b = await realFiles.read(file, start, end); bytes += b.length; return b } }
    const t0 = performance.now()
    const page = await readConversation(f, { files: counting })
    const ms = performance.now() - t0
    console.log(`  10MB 超のログの最新 ${page.messages.length} 件: ${ms.toFixed(0)}ms、読んだ量 ${(bytes / 1024).toFixed(0)}KB`)
    assert.equal(page.messages.length, 20)
    assert.ok(ms < 1000, `${ms}ms`)
    assert.ok(bytes < 8 * 1024 * 1024, '1 回の取得は、ログ全体を読まない')
    // さらに前も、読める
    bytes = 0
    const older = await readConversation(f, { before: page.cursor, files: counting })
    assert.equal(older.messages.length, 20)
    assert.ok(bytes < 8 * 1024 * 1024 + 256 * 1024)
  })

  it('マルチバイト文字が、ブロックの境目で壊れない', async () => {
    const records = Array.from({ length: 400 }, (_, i) => userText(`日本語の発言 ${i} ${'あ'.repeat(500)}`))
    const f = write('mb.jsonl', lines(records))
    let cursor = null
    let n = 0
    do {
      const page = await readConversation(f, { before: cursor, limit: 100 })
      for (const m of page.messages) { assert.match(m.text, /^日本語の発言 \d+ あ{500}$/); n++ }
      cursor = page.cursor
    } while (cursor !== null)
    assert.equal(n, 400)
  })
})

describe('会話ログの場所（AC-007-15, 16）', () => {
  const id = '8db71eb1-b06c-44b2-995b-9129e7f202c4'

  it('AC-007-15: transcript_path は、<sessionId>.jsonl で、親の親が projects のときだけ使える', () => {
    assert.equal(isTranscriptPath(id, `C:\\Users\\dev\\.claude-a\\projects\\D--proj\\${id}.jsonl`), true)
    assert.equal(isTranscriptPath(id, `/home/u/.claude/projects/p/${id}.jsonl`), true)
    for (const bad of [`C:\\Users\\dev\\secret.txt`, `C:\\Users\\dev\\.claude\\projects\\p\\other.jsonl`, `C:\\x\\${id}.jsonl`, `C:\\a\\notprojects\\p\\${id}.jsonl`, null, undefined, 5]) {
      assert.equal(isTranscriptPath(id, bad), false, String(bad))
    }
    assert.equal(isTranscriptPath('../etc', `C:\\p\\projects\\x\\../etc.jsonl`), false, 'セッション ID に、パスの文字は使えない')
  })

  it('AC-007-16: transcript_path がなくても、<アカウント>/projects/*/<id>.jsonl から見つける', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-loc-'))
    try {
      fs.mkdirSync(path.join(root, 'projects', 'D--one'), { recursive: true })
      fs.mkdirSync(path.join(root, 'projects', 'D--two'), { recursive: true })
      const file = path.join(root, 'projects', 'D--two', `${id}.jsonl`)
      fs.writeFileSync(file, '')
      assert.equal(await locateTranscript({ sessionId: id, account: root }), file)
      assert.equal(await locateTranscript({ sessionId: 'nothing-here', account: root }), null)
      assert.equal(await locateTranscript({ sessionId: id, account: path.join(root, 'none') }), null)
      // 使えない transcript_path は無視して、探す
      assert.equal(await locateTranscript({ sessionId: id, account: root, transcriptPath: path.join(root, 'secret.txt') }), file)
      // 使える transcript_path は、そのまま
      assert.equal(await locateTranscript({ sessionId: id, account: root, transcriptPath: file }), file)
      assert.equal(await locateTranscript({ sessionId: '../x', account: root }), null)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---- ツールの要点と全文（AC-007-24。ADR 0029）----
import { toolTarget } from '../src/hub/conversation.mjs'

describe('ツールの要点と全文（AC-007-24）', () => {
  const CWD = 'D:\\work\\coders-hub'

  it('Bash: 要点はコマンドの 1 行目、全文はコマンド全文', () => {
    assert.deepEqual(toolTarget('Bash', { command: 'npm run build &&\n  npm test\n# 説明' }), { summary: 'npm run build &&', detail: 'npm run build &&\n  npm test\n# 説明' })
    assert.deepEqual(toolTarget('Bash', { command: '\n\n  ls -la  \n' }).summary, 'ls -la', '先頭の空行は飛ばす')
  })

  it('Read・Edit・Write・NotebookEdit: 作業フォルダの中は相対（/ 区切り）、外は絶対。全文は、絶対パス', () => {
    const inside = `${CWD}\\tests\\sessions.test.mjs`
    for (const name of ['Read', 'Edit', 'MultiEdit', 'Write']) {
      assert.deepEqual(toolTarget(name, { file_path: inside }, CWD), { summary: 'tests/sessions.test.mjs', detail: inside }, name)
    }
    assert.deepEqual(toolTarget('NotebookEdit', { notebook_path: `${CWD}/a.ipynb` }, CWD), { summary: 'a.ipynb', detail: `${CWD}/a.ipynb` })
    assert.deepEqual(toolTarget('Read', { file_path: 'C:\\other\\x.txt' }, CWD), { summary: 'C:\\other\\x.txt', detail: 'C:\\other\\x.txt' }, '作業フォルダの外は、そのまま')
    assert.equal(toolTarget('Read', { file_path: `${CWD}-2\\x.txt` }, CWD).summary, `${CWD}-2\\x.txt`, '名前が前方一致するだけの別のフォルダは、相対にしない')
    assert.equal(toolTarget('Read', { file_path: inside.toLowerCase() }, CWD).summary, 'tests/sessions.test.mjs', '大文字・小文字の違いは、同じフォルダとみなす（Windows）')
    assert.equal(toolTarget('Read', { file_path: inside }).summary, inside, '作業フォルダが分からなければ、そのまま')
  })

  it('Grep: "検索語" in パス。全文は、検索語・パス・glob（行ごと）。Glob は、パターン', () => {
    assert.deepEqual(toolTarget('Grep', { pattern: 'asyncRewake', path: `${CWD}\\src`, glob: '*.mjs' }, CWD), {
      summary: '"asyncRewake" in src', detail: `pattern: asyncRewake\npath: ${CWD}\\src\nglob: *.mjs`,
    })
    assert.equal(toolTarget('Grep', { pattern: 'x' }).summary, '"x"')
    assert.deepEqual(toolTarget('Glob', { pattern: 'src/**/*.mjs', path: `${CWD}\\src` }, CWD), { summary: 'src/**/*.mjs in src', detail: `pattern: src/**/*.mjs\npath: ${CWD}\\src` })
  })

  it('WebFetch・WebSearch・Task・Agent: URL・検索語・説明', () => {
    assert.deepEqual(toolTarget('WebFetch', { url: 'https://example.com/a' }), { summary: 'https://example.com/a', detail: 'https://example.com/a' })
    assert.deepEqual(toolTarget('WebSearch', { query: 'node test runner' }), { summary: 'node test runner', detail: 'node test runner' })
    assert.deepEqual(toolTarget('Task', { description: '調査する', prompt: '長い指示' }), { summary: '調査する', detail: '調査する' })
    assert.deepEqual(toolTarget('Agent', { prompt: '指示の 1 行目\n2 行目' }), { summary: '指示の 1 行目', detail: '指示の 1 行目\n2 行目' })
  })

  it('取れないとき（入力がない・形が違う・知らないツール）は、null', () => {
    for (const args of [['Bash', null], ['Bash', {}], ['Bash', { command: '  ' }], ['Read', { file_path: 3 }], ['Grep', { path: 'x' }], ['Unknown', { command: 'x' }], ['AskUserQuestion', { questions: [] }]]) {
      assert.equal(toolTarget(...args), null, JSON.stringify(args))
    }
  })

  it('要点は 300 文字までで切る。全文は 4,000 文字で切り、truncated を付ける', () => {
    const long = 'a'.repeat(5000)
    const m = parse([toolUse('t1', 'Bash', { command: long })])
    assert.equal(Array.from(m[0].tool.summary).length, 301, '300 文字 + …')
    assert.equal(m[0].tool.detail.length, MAX_TEXT)
    assert.equal(m[0].tool.truncated, true)
    const short = parse([toolUse('t2', 'Bash', { command: 'ls' })])
    assert.equal(short[0].tool.truncated, undefined)
  })

  it('メッセージに、作業フォルダ（レコードの cwd）が使われる。AskUserQuestion には、要点・全文を付けない', () => {
    const m = parse([
      { ...toolUse('t1', 'Edit', { file_path: `${CWD}\\a.mjs` }), cwd: CWD },
      toolUse('q1', 'AskUserQuestion', { questions: [{ question: '？', options: [] }] }),
    ])
    assert.equal(m[0].tool.summary, 'a.mjs')
    assert.equal(m[1].role, 'question')
    assert.deepEqual(Object.keys(m[1].tool).sort(), ['name', 'result'])
  })

  it('ツールの出力（結果の中身）は、どのメッセージにも含まれない', () => {
    const m = parse([toolUse('t1', 'Bash', { command: 'cat .env' }), toolResult('t1', 'SECRET=abc123'), toolUse('t2', 'Read', { file_path: '/x' }), toolResult('t2', 'パスワード: xyz')])
    assert.doesNotMatch(JSON.stringify(m), /abc123|xyz|パスワード/)
  })
})
