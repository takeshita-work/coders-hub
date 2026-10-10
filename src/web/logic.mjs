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
