// 会話ログ（JSONL）から、画面に出す会話を読む（機能 004、ADR 0016）。
// 要求のたびに、必要な分だけをファイルの末尾から読んで返す。読んだ内容は、関数の外に残さない（NFR-009: キャッシュ・モジュール変数を持たない）。
// 会話ログは内部フォーマットなので、想定外のレコードは無視する（NFR-008）。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const MAX_TEXT = 4_000
export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100
// 1 回に読むブロックの大きさ、1 回の取得で読む量の上限、ツールの結果の突き合わせに先読みする量
const CHUNK_BYTES = 256 * 1024
const MAX_READ_BYTES = 8 * 1024 * 1024
const LOOKAHEAD_BYTES = 256 * 1024

export const realFiles = {
  stat: async (file) => {
    const s = await fs.stat(file)
    return { size: s.size, mtimeMs: s.mtimeMs, isFile: s.isFile() }
  },
  async read(file, start, end) {
    const handle = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(Math.max(0, end - start))
      const { bytesRead } = await handle.read(buf, 0, buf.length, start)
      return buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
  readdir: (dir) => fs.readdir(dir),
}

// ---- 会話ログの場所 ----

const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/
const segments = (p) => String(p).split(/[\\/]+/).filter(Boolean)

// フックで受け取った transcript_path を使ってよいか。内部 API は認証がないので、任意のファイルを読ませない:
// ファイル名が <sessionId>.jsonl で、親の親のフォルダ名が projects のものだけ（AC-007-15）
export const isTranscriptPath = (sessionId, p) => {
  if (!SESSION_ID.test(String(sessionId)) || typeof p !== 'string') return false
  const parts = segments(p)
  return parts.length >= 3 && parts.at(-1) === `${sessionId}.jsonl` && parts.at(-3) === 'projects'
}

// 会話ログの場所を決める。transcript_path が使えなければ、<アカウント>/projects/*/<sessionId>.jsonl を探す（AC-007-16）。なければ null
export const locateTranscript = async ({ sessionId, account = null, transcriptPath = null, files = realFiles, home = os.homedir() }) => {
  if (!SESSION_ID.test(String(sessionId))) return null
  if (isTranscriptPath(sessionId, transcriptPath)) {
    try {
      if ((await files.stat(transcriptPath)).isFile) return transcriptPath
    } catch { /* 探しに行く */ }
  }
  const projects = path.join(account || path.join(home, '.claude'), 'projects')
  let dirs
  try { dirs = await files.readdir(projects) } catch { return null }
  for (const dir of dirs) {
    const candidate = path.join(projects, dir, `${sessionId}.jsonl`)
    try {
      if ((await files.stat(candidate)).isFile) return candidate
    } catch { /* 次へ */ }
  }
  return null
}

// ---- レコード → メッセージ ----

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}

// 利用者の発言ではない、システムの記録（スラッシュコマンド・中断・注入）
const NOISE = [/^<command-/, /^<local-command/, /^<system-reminder/, /^\[Request interrupted by user/, /^Caveat: /]
const isNoise = (text) => NOISE.some((re) => re.test(text.trimStart()))

// ダッシュボードから送った指示: <channel source="coders-hub" id="…">\n本文\n</channel>
const CHANNEL = /^\s*<channel\b([^>]*)>\n?([\s\S]*?)\n?<\/channel>\s*$/
const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null

const clip = (text) => {
  if (text.length <= MAX_TEXT) return { text }
  const chars = Array.from(text)
  return chars.length > MAX_TEXT ? { text: chars.slice(0, MAX_TEXT).join(''), truncated: true } : { text }
}

const resultOf = (block) => {
  if (!block.is_error) return 'ok'
  const t = textOf(block.content)
  return /doesn't want to proceed|User rejected tool use/.test(t) ? 'rejected' : 'error'
}

// ---- ツールの要点と全文（ADR 0029）----
// 閉じた行に出す要点（summary）と、開いたときに出す全文（detail）を、ツールの入力から取り出す。出力（結果の中身）は、扱わない
const SUMMARY_MAX = 300
const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)
const slashes = (p) => p.replace(/\\/g, '/')
// 作業フォルダの中のパスは、そこからの相対にする（外は、そのまま）
const relative = (p, cwd) => {
  if (!str(cwd)) return p
  const a = slashes(p)
  const base = slashes(cwd).replace(/\/+$/, '')
  return a.toLowerCase().startsWith(base.toLowerCase() + '/') ? a.slice(base.length + 1) : p
}
const firstLine = (text) => {
  const chars = Array.from((text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').trim())
  return chars.length > SUMMARY_MAX ? chars.slice(0, SUMMARY_MAX).join('') + '…' : chars.join('')
}
export const toolTarget = (name, input, cwd = null) => {
  if (!input || typeof input !== 'object') return null
  switch (name) {
    case 'Bash': {
      const command = str(input.command)
      return command ? { summary: firstLine(command), detail: command } : null
    }
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': {
      const p = str(input.file_path) ?? str(input.notebook_path)
      return p ? { summary: relative(p, cwd), detail: p } : null
    }
    case 'Grep': case 'Glob': {
      const pattern = str(input.pattern)
      if (!pattern) return null
      const p = str(input.path)
      const glob = name === 'Grep' ? str(input.glob) : null
      const quoted = name === 'Grep' ? `"${firstLine(pattern)}"` : firstLine(pattern)
      return {
        summary: quoted + (p ? ` in ${relative(p, cwd)}` : ''),
        detail: [`pattern: ${pattern}`, p && `path: ${p}`, glob && `glob: ${glob}`].filter(Boolean).join('\n'),
      }
    }
    case 'WebFetch': {
      const url = str(input.url)
      return url ? { summary: firstLine(url), detail: url } : null
    }
    case 'WebSearch': {
      const query = str(input.query)
      return query ? { summary: firstLine(query), detail: query } : null
    }
    case 'Task': case 'Agent': {
      const description = str(input.description) ?? str(input.prompt)
      return description ? { summary: firstLine(description), detail: description } : null
    }
    default:
      return null
  }
}
// ツールの行の、tool の部分。要点が取れたときだけ、summary・detail（4,000 文字で切る）を付ける
const toolInfo = (name, input, cwd) => {
  const target = toolTarget(name, input, cwd)
  if (!target) return { name, result: null }
  const detail = clip(target.detail)
  return { name, result: null, summary: target.summary, detail: detail.text, ...(detail.truncated ? { truncated: true } : {}) }
}

// entries: [{ offset, entry }]（古い順）。戻り値: メッセージ（古い順）。各メッセージの offset は、そのレコードの行の位置
export const buildMessages = (entries) => {
  const messages = []
  const tools = new Map() // tool_use の id -> メッセージ
  for (const { offset, entry } of entries) {
    if (!entry || entry.isSidechain) continue
    const at = Date.parse(entry.timestamp)
    const base = { offset, at: Number.isNaN(at) ? null : at }
    const content = entry.message?.content
    if (entry.type === 'user') {
      if (entry.origin?.kind === 'channel') {
        // ダッシュボードから送った指示。isMeta だが、利用者の発言として出す
        if (!String(entry.origin.server ?? '').startsWith('coders-hub')) continue
        const m = CHANNEL.exec(textOf(content))
        const body = m ? m[2] : textOf(content)
        if (body.trim() === '') continue
        messages.push({ ...base, id: `${offset}`, role: 'user', source: 'dashboard', instructionId: m ? attr(m[1], 'id') : null, ...clip(body) })
        continue
      }
      if (entry.isMeta) continue
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result') continue
          const target = tools.get(block.tool_use_id)
          if (!target) continue
          target.tool.result = resultOf(block)
          if (target.role === 'question' && entry.toolUseResult?.answers && typeof entry.toolUseResult.answers === 'object') {
            for (const a of target.answers) {
              const answer = entry.toolUseResult.answers[a.question]
              if (answer !== undefined) a.answer = String(answer)
            }
          }
        }
      }
      const text = textOf(content)
      if (text.trim() !== '' && !isNoise(text)) messages.push({ ...base, id: `${offset}`, role: 'user', ...clip(text) })
    } else if (entry.type === 'assistant' && Array.isArray(content)) {
      content.forEach((block, i) => {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          messages.push({ ...base, id: `${offset}:${i}`, role: 'assistant', ...clip(block.text) })
        } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
          const questions = block.name === 'AskUserQuestion' && Array.isArray(block.input?.questions) ? block.input.questions : null
          const m = questions
            ? { ...base, id: `${offset}:${i}`, role: 'question', tool: { name: block.name, result: null }, answers: questions.map((q) => ({ question: String(q?.question ?? ''), answer: null })) }
            : { ...base, id: `${offset}:${i}`, role: 'tool', tool: toolInfo(block.name, block.input, entry.cwd) }
          messages.push(m)
          if (typeof block.id === 'string') tools.set(block.id, m)
        }
      })
    }
  }
  return messages
}

// limit に数えるメッセージ（ツールの行は数えない）
const countable = (messages) => messages.reduce((n, m) => n + (m.role === 'tool' ? 0 : 1), 0)

// ---- ファイルの読み取り ----

const parseLines = (buf, startOffset) => {
  // buf の先頭は、行の先頭であること。戻り値: [{ offset, entry }]。壊れた行・末尾の書き込み途中の行は、JSON として読めなければ使わない
  const out = []
  let lineStart = 0
  const pieces = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      pieces.push({ start: lineStart, end: i, complete: true })
      lineStart = i + 1
    }
  }
  if (lineStart < buf.length) pieces.push({ start: lineStart, end: buf.length, complete: false })
  for (const p of pieces) {
    if (p.end <= p.start) continue
    let entry
    try { entry = JSON.parse(buf.subarray(p.start, p.end).toString('utf8')) } catch { continue }
    out.push({ offset: startOffset + p.start, entry })
  }
  return out
}

// 会話を末尾（または before）から前へ、limit 件ぶん読む。戻り値: { messages, cursor, etag }
//  - messages: 古い順。cursor: さらに前を読むための位置（先頭まで読んだら null）
//  - before: 前回の cursor。そこより前だけを返す
export const readConversation = async (file, { before = null, limit = DEFAULT_LIMIT, files = realFiles } = {}) => {
  const stat = await files.stat(file)
  const size = stat.size
  const etag = `W/"${size}-${Math.floor(stat.mtimeMs)}"`
  const end = before === null ? size : Math.min(before, size)

  // 先読み（ツールの結果の突き合わせにだけ使う。返さない）
  let after = []
  if (end < size) {
    const buf = await files.read(file, end, Math.min(size, end + LOOKAHEAD_BYTES))
    const lastNl = buf.lastIndexOf(0x0a)
    if (lastNl >= 0) after = parseLines(buf.subarray(0, lastNl + 1), end)
  }

  // 末尾から前へ。entries は新しい順のチャンクを前に足していく（古い順に保つ）
  let entries = []
  let pos = end
  let carry = Buffer.alloc(0) // 前のチャンクの先頭の、行の途中から始まる断片
  let readBytes = 0
  let scannedStart = end // 行の先頭として確かな、読み終えた範囲の先頭
  let messages = []
  for (;;) {
    if (pos === 0 || readBytes >= MAX_READ_BYTES) break
    const start = Math.max(0, pos - CHUNK_BYTES)
    const chunk = await files.read(file, start, pos)
    readBytes += chunk.length
    const data = Buffer.concat([chunk, carry])
    let body = data
    let bodyOffset = start
    if (start > 0) {
      // 先頭の行は途中から始まっているので、次のチャンクと合わせる
      const nl = data.indexOf(0x0a)
      if (nl < 0) { carry = data; pos = start; continue }
      carry = data.subarray(0, nl)
      body = data.subarray(nl + 1)
      bodyOffset = start + nl + 1
    } else {
      carry = Buffer.alloc(0)
    }
    entries = parseLines(body, bodyOffset).concat(entries)
    scannedStart = bodyOffset
    pos = start
    messages = buildMessages([...entries, ...after]).filter((m) => m.offset < end)
    if (countable(messages) >= limit) break
  }
  if (pos === 0) scannedStart = 0

  // 新しい limit 件（発言・応答・質問の数。ツールの行は数えず、その間に含める）。同じレコードのメッセージは、分けない
  let page = messages
  let stoppedByLimit = false
  if (countable(messages) >= limit) {
    stoppedByLimit = true
    let counted = 0
    let from = messages.length
    while (from > 0 && counted < limit) {
      from--
      if (messages[from].role !== 'tool') counted++
    }
    // 先頭が、ツールの行のあとに続く、その直前のツールの行から始まらないよう、同じレコードを含める
    while (from > 0 && messages[from - 1].offset === messages[from].offset) from--
    page = messages.slice(from)
  }
  let cursor = null
  if (page.length > 0 && (stoppedByLimit || scannedStart > 0)) {
    const hasEarlier = stoppedByLimit ? (page[0].offset > 0) : scannedStart > 0
    if (hasEarlier) cursor = stoppedByLimit ? page[0].offset : scannedStart
  } else if (page.length === 0 && scannedStart > 0) {
    cursor = scannedStart
  }
  return { messages: page.map(({ offset, ...m }) => m), cursor, etag }
}
