// 画面の表示ロジック（React に依存しない純粋な関数）。仕様: specs/30-features/001-session-list/spec.md
//  - 並び順・グループ化・件数・経過時間・タイトル（AC-001-9, AC-008-*, AC-010-*）

export const STATE_LABEL = { permission: '許可待ち', waiting: '返答待ち', working: '作業中' }
const STATE_ORDER = { permission: 0, waiting: 1, working: 2 }

// 要対応 = 返答待ち・許可待ち
export const isAttention = (session) => session.state === 'permission' || session.state === 'waiting'

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

// 許可待ち → 返答待ち → 作業中。同じ状態の中は、状態になった時刻が新しい順（AC-001-9）
export const sortSessions = (sessions) =>
  [...sessions].sort(
    (a, b) =>
      (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) ||
      b.stateSince - a.stateSince ||
      a.sessionId.localeCompare(b.sessionId),
  )

export const countStates = (sessions) => {
  const counts = { permission: 0, waiting: 0, working: 0, total: 0 }
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
  const n = counts.permission + counts.waiting
  return n > 0 ? `(${n}) Coders Hub` : 'Coders Hub'
}
