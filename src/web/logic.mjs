// 画面の表示ロジック（React に依存しない純粋な関数）。仕様: specs/30-features/006-dashboard-layout/spec.md（ADR 0015）
//  - ツリー・並び・件数・経過時間・タイトル（AC-UI-4〜9, 11, 28）

export const STATE_LABEL = { permission: '許可待ち', question: '質問待ち', waiting: '返答待ち', working: '作業中' }
// 行と状態の行に出す札。返答待ちは何もない状態なので、札を出さない（ADR 0015）
export const SHORT_LABEL = { permission: '許可', question: '質問', working: '作業' }

// 要対応 = 許可待ち・質問待ち（返答待ちは含めない。ADR 0015）
export const isAttention = (session) => session.state === 'permission' || session.state === 'question'

// Hub からのメッセージを一覧（Map: sessionId -> session）に適用する。元の Map は変更しない
export const reduceMessage = (sessions, message) => {
  switch (message.type) {
    case 'snapshot':
      return new Map(message.sessions.map((s) => [s.sessionId, s]))
    case 'added':
    case 'updated':
      return new Map(sessions).set(message.session.sessionId, message.session)
    case 'removed': {
      const next = new Map(sessions)
      next.delete(message.sessionId)
      return next
    }
    default:
      return sessions
  }
}

export const countStates = (sessions) => {
  const counts = { permission: 0, question: 0, waiting: 0, working: 0, total: 0 }
  for (const s of sessions) {
    if (s.state in counts) counts[s.state] += 1
    counts.total += 1
  }
  return counts
}

const lastSegment = (p) => String(p).split(/[\\/]+/).filter(Boolean).pop() ?? String(p)

// アカウントの表示名は、CLAUDE_CONFIG_DIR のフォルダ名
export const accountName = (account) => (account ? lastSegment(account) : '（既定のアカウント）')
export const projectName = (cwd) => (cwd ? lastSegment(cwd) : '（不明）')
export const shortId = (sessionId) => String(sessionId).slice(0, 8)

// 直近の発言: 先頭の 1 行を max 文字まで。空なら null
export const formatPrompt = (prompt, max = 80) => {
  if (typeof prompt !== 'string') return null
  const first = prompt.trim().split(/\r?\n/)[0].trim()
  if (!first) return null
  const chars = Array.from(first)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : first
}

// 経過時間: 秒 → 分 → 時間+分 → 日+時間
export const formatElapsed = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}時間${minutes % 60}分` : `${hours}時間`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}日${hours % 24}時間` : `${days}日`
}

// 起動時刻。Hub が持たない古い形式でも並べられるよう、状態の時刻で代用する
const startedOf = (s) => s.startedAt ?? s.stateSince ?? 0

// サイドバーのツリー: アカウント → プロジェクト → セッション（AC-UI-4〜9）。
//  - アカウント: 起動が最も早いセッションを持つ順
//  - プロジェクト: 名前順。dirSort: 'asc' | 'desc'
//  - セッション: 起動順。sessSort: 'early'（早い順）| 'late'（遅い順）
//  - onlyControl: 操作できるセッションだけ
// 状態では並べ替えない（状態が変わっても位置が動かない。AC-UI-7）。件数は、表示するセッションから数える
export const buildTree = (sessions, { onlyControl = false, dirSort = 'asc', sessSort = 'early' } = {}) => {
  const byAccount = new Map()
  for (const s of sessions) {
    if (onlyControl && !s.controllable) continue
    const account = s.account ?? ''
    if (!byAccount.has(account)) byAccount.set(account, new Map())
    const dirs = byAccount.get(account)
    const cwd = s.cwd ?? ''
    if (!dirs.has(cwd)) dirs.set(cwd, [])
    dirs.get(cwd).push(s)
  }
  const bySession = (a, b) =>
    (sessSort === 'late' ? -1 : 1) * (startedOf(a) - startedOf(b)) || a.sessionId.localeCompare(b.sessionId)
  const accounts = [...byAccount.entries()].map(([key, dirs]) => {
    const projects = [...dirs.entries()]
      .map(([cwd, list]) => ({
        key: `d:${key}/${cwd}`, cwd, name: projectName(cwd || null), counts: countStates(list), sessions: [...list].sort(bySession),
      }))
      .sort((a, b) => (dirSort === 'desc' ? -1 : 1) * (a.name.localeCompare(b.name) || a.cwd.localeCompare(b.cwd)))
    const all = projects.flatMap((p) => p.sessions)
    return { key, nodeKey: `a:${key}`, name: accountName(key || null), counts: countStates(all), earliest: Math.min(...all.map(startedOf)), projects }
  })
  return accounts.sort((a, b) => a.earliest - b.earliest || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

// サイドバーの「許可」ボタンを出せる要求（AC-UI-17, 18）: 操作モードで、入力が 200 文字以下かつ省略されていない許可要求
export const SIDEBAR_ALLOW_MAX = 200
export const sidebarAllowRequest = (session) =>
  session.controllable
    ? (session.requests ?? []).find(
      (r) => r.kind === 'permission' && parsePreview(r.inputPreview).omitted === 0 && previewLength(r.inputPreview) <= SIDEBAR_ALLOW_MAX,
    ) ?? null
    : null

// 画面の状態（選択・表示・パネル・絞り込み・並び・折りたたみ）の更新。patch.toggle は、折りたたみのキーの切り替え
export const applyUiPatch = (ui, patch) => {
  const { toggle, ...rest } = patch
  const next = { ...ui, ...rest }
  // フィルター・ソートとメニューのパネルは、同時に開かない。開くときは、もう片方を閉じる（AC-UI-32）
  if (rest.opts === true) next.menu = false
  if (rest.menu === true) next.opts = false
  if (toggle !== undefined) {
    next.collapsed = new Set(ui.collapsed)
    if (!next.collapsed.delete(toggle)) next.collapsed.add(toggle)
  }
  return next
}

// タブのタイトル: 要対応（許可待ち・質問待ち）が 1 件以上なら件数を先頭に付ける（AC-UI-28）
export const titleFor = (counts) => {
  const n = counts.permission + counts.question
  return n > 0 ? `(${n}) Coders Hub` : 'Coders Hub'
}

// ---- 指示の送信（機能 002） ----

export const MAX_INSTRUCTION = 10_000

// Hub から届く指示の状態（instruction メッセージの status）の表示名（AC-002-6）
export const INSTRUCTION_LABEL = {
  held: '保留中',
  delivering: '送信中',
  sent: '送信中',
  confirmed: '届きました',
  missed: '指示として扱われませんでした',
  unconfirmed: '届いたか確認できません',
  cancelled: '取り消しました',
  lost: '失われました',
  failed: '送れませんでした',
}
const IN_FLIGHT = new Set(['delivering', 'sent'])
// これ以上は変わらない状態
export const isFinal = (status) => !(status === 'held' || IN_FLIGHT.has(status))

// 入力の検証。空・上限超過は送れない（AC-002-4）。戻り値: { ok, reason? }
export const validateInstruction = (text) => {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, reason: '指示を入力してください' }
  if (text.length > MAX_INSTRUCTION) return { ok: false, reason: `指示は ${MAX_INSTRUCTION} 文字までです（${text.length} 文字）` }
  return { ok: true }
}

// 操作できないセッションの入力欄に表示する文言（AC-UI-26）
export const VIEW_ONLY_LABEL = '閲覧のみ'

// 送った指示の記録 Map（id -> { id, sessionId, status, reason?, preview? }）に、Hub のメッセージを適用する
export const reduceInstruction = (records, message, at = 0) => {
  if (message.type !== 'instruction') return records
  const prev = records.get(message.id)
  const next = { at, ...prev, id: message.id, sessionId: message.sessionId, status: message.status }
  if (message.reason) next.reason = message.reason
  else delete next.reason
  return new Map(records).set(message.id, next)
}

// 送信の応答（202）を記録に反映する。WebSocket のほうが先に届いていたら、状態は上書きしない
export const addSubmitted = (records, { id, sessionId, status, preview, at = 0 }) => {
  const prev = records.get(id)
  if (prev) return new Map(records).set(id, { ...prev, preview })
  return new Map(records).set(id, { id, sessionId, status, preview, at })
}

// 送れなかった指示（API のエラー）の記録。Hub を通っていないので、画面だけの ID を付ける
export const addRejected = (records, { localId, sessionId, reason, preview, at = 0 }) =>
  new Map(records).set(localId, { id: localId, sessionId, status: 'failed', reason, preview, at })

export const dismissRecord = (records, id) => {
  const next = new Map(records)
  next.delete(id)
  return next
}

// 再接続したときのスナップショットで、記録を整理する（AC-003-5）。
//  - 保留中のはずの指示が、Hub のセッションの pending にない = Hub の再起動などで消えた → lost
//  - 送信中のままの指示は、結果を受け取れなかった → unconfirmed
export const reconcileInstructions = (records, sessions) => {
  let changed = false
  const next = new Map(records)
  for (const rec of records.values()) {
    const session = sessions.get(rec.sessionId)
    if (rec.status === 'held') {
      const stillPending = session && (session.pending ?? []).some((p) => p.id === rec.id)
      if (!stillPending) {
        next.set(rec.id, { ...rec, status: 'lost', reason: 'Hub の再起動、またはセッションの終了により、保留中の指示が失われました' })
        changed = true
      }
    } else if (IN_FLIGHT.has(rec.status)) {
      next.set(rec.id, { ...rec, status: 'unconfirmed' })
      changed = true
    }
  }
  return changed ? next : records
}

// 行に出す記録（新しい順ではなく、送った順）。最大 max 件
export const recordsFor = (records, sessionId, max = 5) =>
  [...records.values()].filter((r) => r.sessionId === sessionId).slice(-max)

// ---- 許可・質問への応答（機能 003） ----

// Hub から届く要求の結果（request メッセージの status）の表示名（AC-004-*, 005-*）
export const REQUEST_LABEL = {
  open: '応答待ち',
  allowed: '許可しました',
  denied: '拒否しました',
  answered: '回答しました',
  terminal: 'ターミナルで応答済み',
  timeout: '時間切れ',
  failed: '応答できませんでした',
}

// 1 つの答えの上限（Hub と同じ）
export const MAX_ANSWER = 2_000
// 入力がこの文字数を超えたら、折りたたんで表示する（AC-004-1）
export const PREVIEW_COLLAPSE_CHARS = 400

// claude は長い入力を省略して渡す（約 3,600 文字を超えると、中間が「⋯ N code points elided ⋯」になる）。
// 戻り値: { head, omitted, tail }。省略されていなければ omitted は 0、tail は空
const ELIDED = /\n⋯ (\d+) code points elided ⋯\n/
export const parsePreview = (preview) => {
  const text = typeof preview === 'string' ? preview : ''
  const m = ELIDED.exec(text)
  if (!m) return { head: text, omitted: 0, tail: '' }
  return { head: text.slice(0, m.index), omitted: Number(m[1]), tail: text.slice(m.index + m[0].length) }
}

// 折りたたみ前に見せる入力の長さ（省略の目印を含めた全体で数える）
export const previewLength = (preview) => (typeof preview === 'string' ? Array.from(preview).length : 0)

// 折りたたんだときに見せる先頭部分
export const collapsePreview = (preview, max = PREVIEW_COLLAPSE_CHARS) => {
  const chars = Array.from(typeof preview === 'string' ? preview : '')
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}

const clip = (text, max) => {
  const chars = Array.from(String(text).replace(/\s+/g, ' ').trim())
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('')
}

// 結果の表示に添える、要求の短い説明（本文は残さない）
export const summarizeRequest = (request) =>
  request.kind === 'permission'
    ? clip(`${request.toolName}${request.description ? `: ${request.description}` : ''}`, 60)
    : clip(`質問: ${request.questions?.[0]?.header || request.questions?.[0]?.question || ''}`, 60)

// 結果の色分け（許可／質問）に使う種類。Hub の request メッセージには種類がないので、応答待ちだった要求から覚えておく
export const collectKinds = (kinds, sessions) => {
  let next = kinds
  for (const s of sessions.values()) {
    for (const r of s.requests ?? []) {
      if (next.has(r.id)) continue
      if (next === kinds) next = new Map(kinds)
      next.set(r.id, r.kind)
    }
  }
  return next
}

// セッションの一覧から、応答待ちの要求の説明を集める（閉じたあとの結果の表示に使う）。増やすだけで、減らさない
export const collectSummaries = (summaries, sessions) => {
  let next = summaries
  for (const s of sessions.values()) {
    for (const r of s.requests ?? []) {
      if (next.has(r.id)) continue
      if (next === summaries) next = new Map(summaries)
      next.set(r.id, summarizeRequest(r))
    }
  }
  return next
}

// 要求の結果の記録 Map（id -> { id, sessionId, status, reason?, summary? }）に、Hub のメッセージを適用する。
// 応答待ち（open）は、セッションの requests から表示するので、記録しない
export const reduceRequest = (records, message, summaries = new Map(), kinds = new Map(), at = 0) => {
  if (message.type !== 'request' || message.status === 'open') return records
  const next = { id: message.id, sessionId: message.sessionId, status: message.status, at }
  if (message.reason) next.reason = message.reason
  const summary = summaries.get(message.id)
  if (summary) next.summary = summary
  const kind = kinds.get(message.id)
  if (kind) next.kind = kind
  return new Map(records).set(message.id, next)
}

export const requestRecordsFor = (records, sessionId, max = 5) =>
  [...records.values()].filter((r) => r.sessionId === sessionId).slice(-max)

// ---- 質問の答えの組み立て ----
// draft: 質問ごとの { selected: 選んだ選択肢のラベル[], other: 自由入力 }

export const emptyDraft = (questions) => questions.map(() => ({ selected: [], other: '' }))

const replaceAt = (draft, index, value) => draft.map((d, i) => (i === index ? value : d))

// 選択肢を選ぶ・外す。単一選択は 1 つだけ選べて、自由入力は消える
export const toggleOption = (draft, index, question, label) => {
  const d = draft[index]
  if (!question.multiSelect) return replaceAt(draft, index, { selected: [label], other: '' })
  const selected = d.selected.includes(label) ? d.selected.filter((l) => l !== label) : [...d.selected, label]
  return replaceAt(draft, index, { ...d, selected })
}

// 自由入力。単一選択は、入力があれば選択肢の選択を外す
export const setOther = (draft, index, question, text) => {
  const d = draft[index]
  const selected = !question.multiSelect && text.trim() !== '' ? [] : d.selected
  return replaceAt(draft, index, { selected, other: text })
}

// 1 つの質問の答え。単一選択は文字列、複数選択は文字列の配列（Hub がカンマ区切りにする）
export const answerFor = (question, d) => {
  const other = d.other.trim()
  if (!question.multiSelect) return other || d.selected[0] || ''
  return [...d.selected, ...(other ? [other] : [])]
}

const isBlank = (answer) => (Array.isArray(answer) ? answer.length === 0 : answer === '')

// すべての質問に答えがあり、長すぎないか。戻り値: { ok, reason? }
export const validateAnswers = (questions, draft) => {
  for (let i = 0; i < questions.length; i++) {
    const answer = answerFor(questions[i], draft[i])
    if (isBlank(answer)) return { ok: false, reason: 'すべての質問に答えてください' }
    const length = (Array.isArray(answer) ? answer.join(',') : answer).length
    if (length > MAX_ANSWER) return { ok: false, reason: `答えは ${MAX_ANSWER} 文字までです（${length} 文字）` }
  }
  return { ok: true }
}

// Hub へ送る answers（質問文 → 答え）
export const buildAnswers = (questions, draft) =>
  Object.fromEntries(questions.map((q, i) => [q.question, answerFor(q, draft[i])]))

// ---- 会話の表示（機能 004） ----

// 詳細を開いている間、会話を取得する間隔（AC-007-10: 3 秒以内に反映）
export const CONVERSATION_POLL_MS = 2_000

export const TOOL_RESULT_LABEL = { ok: '成功', rejected: '拒否', error: 'エラー' }

export const emptyConversation = () => ({ messages: [], cursor: null, etag: null, loaded: false, error: null })

// メッセージ ID は、会話ログの行の位置（と、同じ行の中の番号）から作られる: "<位置>" または "<位置>:<番号>"
const idKey = (id) => {
  const [offset, index = '0'] = String(id).split(':')
  return Number(offset) * 1000 + Number(index)
}

// 最新のページ（先頭は取得ごとに同じ範囲）を反映する。最新ページの範囲より前に読み込んだ分は残す
export const applyLatest = (conversation, page) => {
  const first = page.messages[0]
  const kept = first && conversation.messages.length > 0 && idKey(conversation.messages[0].id) < idKey(first.id)
    ? conversation.messages.filter((m) => idKey(m.id) < idKey(first.id))
    : []
  const replaced = kept.length === 0
  return {
    messages: [...kept, ...page.messages],
    // 古い分を読み込んでいるときは、その cursor を保つ。最新ページだけのときは、ページの cursor
    cursor: replaced ? page.cursor : conversation.cursor,
    etag: page.etag,
    loaded: true,
    error: null,
  }
}

// 「さらに表示」の結果を、前に足す
export const prependOlder = (conversation, page) => {
  const first = conversation.messages[0]
  const older = first ? page.messages.filter((m) => idKey(m.id) < idKey(first.id)) : page.messages
  return { ...conversation, messages: [...older, ...conversation.messages], cursor: page.cursor }
}

// 取得の失敗。すでに読めている会話は残し、理由だけを付ける（直れば、次の取得で消える）
export const withConversationError = (conversation, code) => ({ ...conversation, loaded: true, error: code })

// 会話に現れたダッシュボードの指示の ID（画面の「届きました」の記録を、二重に出さないため）
export const deliveredInstructionIds = (messages) =>
  new Set(messages.filter((m) => m.source === 'dashboard' && m.instructionId).map((m) => m.instructionId))

// 時刻（時:分）
export const formatClock = (at) => {
  if (typeof at !== 'number') return ''
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- 会話の組み立て（機能 004。ADR 0029）----

// 会話ログのメッセージと、画面のできごと（許可・質問の結果の行・送った指示）を、時刻の順に 1 本にする（AC-007-25）。
//  - events: [{ at, node, key }]。at がないものは、一番最後に置く
//  - hasMoreBefore: まだ読み込んでいない、前の会話があるとき。最初に読み込んだメッセージより前に起きたできごとは、
//    読み込むまで出さない（出すと、古い結果の行が、会話の一番上に居座る）
//  - 同じ時刻なら、メッセージのあとに置く
export const mergeTimeline = (messages, events, { hasMoreBefore = false } = {}) => {
  const sorted = events.map((e) => ({ ...e, at: typeof e.at === 'number' ? e.at : Infinity })).sort((a, b) => a.at - b.at)
  const firstAt = messages.find((m) => typeof m.at === 'number')?.at
  let i = 0
  if (hasMoreBefore && typeof firstAt === 'number') while (i < sorted.length && sorted[i].at < firstAt) i++
  const out = []
  for (const message of messages) {
    if (typeof message.at === 'number') while (i < sorted.length && sorted[i].at < message.at) out.push({ type: 'event', ...sorted[i++] })
    out.push({ type: 'message', message })
  }
  while (i < sorted.length) out.push({ type: 'event', ...sorted[i++] })
  return out
}

// 連続した 2 件以上のツールの行を、1 つのグループにする（AC-007-22）。間に発言・応答・質問・できごとが入れば、別のグループ。1 件だけは、まとめない
export const groupTools = (items) => {
  const out = []
  let run = []
  const flush = () => {
    if (run.length >= 2) out.push({ type: 'toolgroup', id: `g-${run[0].message.id}`, messages: run.map((r) => r.message) })
    else out.push(...run)
    run = []
  }
  for (const item of items) {
    if (item.type === 'message' && item.message.role === 'tool') run.push(item)
    else { flush(); out.push(item) }
  }
  flush()
  return out
}

// 末尾のツールの行（あとに発言や応答がない）は、実行中として出す。実行中のメッセージの id の集まり
export const runningToolIds = (messages) => {
  const tailStart = messages.findLastIndex((m) => m.role !== 'tool') + 1
  return new Set(messages.slice(tailStart).filter((m) => m.role === 'tool' && !m.tool.result).map((m) => m.id))
}

// ツールの行の状態: ok | rejected | error | running | none（結果なし）
export const toolStatus = (message, running) => message.tool.result ?? (running ? 'running' : 'none')
export const TOOL_STATUS_LABEL = { ...TOOL_RESULT_LABEL, running: '実行中', none: '結果なし' }

// 閉じた行に出す要点と、開いたときの全文。全文が要点と同じなら、開く意味がない（開閉しない。AC-007-4）
export const toolSummaryOf = (message) => message.tool.summary ?? ''
export const toolHasMore = (message) => typeof message.tool.detail === 'string' && message.tool.detail !== toolSummaryOf(message)

// グループの閉じた 1 行: 件数・ツール名（回数）・結果の内訳・時刻の範囲（AC-007-22）
export const summarizeToolGroup = (messages, running = new Set()) => {
  const names = new Map()
  const tally = { ok: 0, error: 0, rejected: 0, running: 0 }
  for (const m of messages) {
    names.set(m.tool.name, (names.get(m.tool.name) ?? 0) + 1)
    const status = toolStatus(m, running.has(m.id))
    if (status in tally) tally[status] += 1
  }
  const times = messages.map((m) => m.at).filter((t) => typeof t === 'number')
  return {
    count: messages.length,
    names: [...names].map(([name, count]) => ({ name, count })),
    tally,
    from: times.length ? times[0] : null,
    to: times.length ? times[times.length - 1] : null,
  }
}
