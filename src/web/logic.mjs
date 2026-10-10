// 画面の表示ロジック（React に依存しない純粋な関数）。仕様: specs/30-features/001-session-list/spec.md
//  - 並び順・グループ化・件数・経過時間・タイトル（AC-001-9, AC-008-*, AC-010-*）

export const STATE_LABEL = { permission: '許可待ち', question: '質問待ち', waiting: '返答待ち', working: '作業中' }
// 人の応答で止まっているものを上に: 許可待ち → 質問待ち → 返答待ち → 作業中
const STATE_ORDER = { permission: 0, question: 1, waiting: 2, working: 3 }

// 要対応 = 許可待ち・質問待ち・返答待ち（作業中以外）
export const isAttention = (session) => session.state !== 'working'

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

// 許可待ち → 質問待ち → 返答待ち → 作業中。同じ状態の中は、状態になった時刻が新しい順（AC-001-9）
export const sortSessions = (sessions) =>
  [...sessions].sort(
    (a, b) =>
      (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) ||
      b.stateSince - a.stateSince ||
      a.sessionId.localeCompare(b.sessionId),
  )

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

// アカウントごとのグループ。filter: 'all' | 'attention'（AC-010-5）。
// 件数（attention）は絞り込み前の全セッションから数える（折りたたみ時の表示用。AC-008-4）
export const groupByAccount = (sessions, filter = 'all') => {
  const byAccount = new Map()
  for (const s of sessions) {
    const key = s.account ?? ''
    if (!byAccount.has(key)) byAccount.set(key, [])
    byAccount.get(key).push(s)
  }
  return [...byAccount.entries()]
    .map(([key, all]) => {
      const counts = countStates(all)
      const visible = filter === 'attention' ? all.filter(isAttention) : all
      return { key, name: accountName(key || null), counts, sessions: sortSessions(visible) }
    })
    .filter((g) => g.sessions.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

// タブのタイトル: 要対応が 1 件以上なら件数を先頭に付ける（AC-010-4）
export const titleFor = (counts) => {
  const n = counts.permission + counts.question + counts.waiting
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

// 操作できないセッションで表示する理由（AC-002-5）
export const NOT_CONTROLLABLE_REASON = '操作モードで起動していません'

// セッションの状態に応じた、送信前の案内（作業中などは、返答待ちになってから渡される）
export const holdNotice = (session) =>
  session.state === 'waiting' ? null : `${STATE_LABEL[session.state] ?? session.state}のため、返答待ちになってから送られます`

// 送った指示の記録 Map（id -> { id, sessionId, status, reason?, preview? }）に、Hub のメッセージを適用する
export const reduceInstruction = (records, message) => {
  if (message.type !== 'instruction') return records
  const prev = records.get(message.id)
  const next = { ...prev, id: message.id, sessionId: message.sessionId, status: message.status }
  if (message.reason) next.reason = message.reason
  else delete next.reason
  return new Map(records).set(message.id, next)
}

// 送信の応答（202）を記録に反映する。WebSocket のほうが先に届いていたら、状態は上書きしない
export const addSubmitted = (records, { id, sessionId, status, preview }) => {
  const prev = records.get(id)
  if (prev) return new Map(records).set(id, { ...prev, preview })
  return new Map(records).set(id, { id, sessionId, status, preview })
}

// 送れなかった指示（API のエラー）の記録。Hub を通っていないので、画面だけの ID を付ける
export const addRejected = (records, { localId, sessionId, reason, preview }) =>
  new Map(records).set(localId, { id: localId, sessionId, status: 'failed', reason, preview })

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
export const reduceRequest = (records, message, summaries = new Map()) => {
  if (message.type !== 'request' || message.status === 'open') return records
  const next = { id: message.id, sessionId: message.sessionId, status: message.status }
  if (message.reason) next.reason = message.reason
  const summary = summaries.get(message.id)
  if (summary) next.summary = summary
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
