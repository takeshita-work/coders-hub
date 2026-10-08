// セッション一覧の状態管理（HTTP・WebSocket から独立した純粋なロジック）。
// plan.md「状態遷移とフック」「生存確認と削除」に対応する。時刻は差し替え可能にしてテストする。

const STATE_BY_EVENT = {
  UserPromptSubmit: 'working',
  PermissionRequest: 'permission',
  Stop: 'waiting',
}
// 未登録のセッションでこれらを受けたら、作業中として登録する（SessionStart より先に届いた場合など）
const IMPLIES_WORKING = new Set(['PreToolUse', 'PostToolUse'])

// claude 自身が書く sessions/<pid>.json の status（ADR 0009）。許可待ち・質問待ち（waiting）はどちらも許可待ちとして扱う
const STATE_BY_STATUS = { busy: 'working', idle: 'waiting', waiting: 'permission' }

const view = (r) => ({
  sessionId: r.sessionId,
  account: r.account,
  cwd: r.cwd,
  state: r.state,
  stateSince: r.stateSince,
  lastPrompt: r.lastPrompt,
  channelAlive: r.channelAlive,
})

export const createStore = ({ now = Date.now, expireMs = 50_000 } = {}) => {
  const sessions = new Map()
  // 閉じたセッションの ID。遅れて届いたフックで復活しないようにする
  const ended = new Set()
  const listeners = new Set()

  const emit = (change) => {
    for (const l of listeners) {
      try { l(change) } catch { /* 購読者の失敗で本体を止めない */ }
    }
  }

  const create = (sessionId, state) => {
    const r = {
      sessionId, account: null, cwd: null, state, stateSince: now(),
      lastPrompt: null, transcriptPath: null, channelAlive: false, lastPollAt: null,
      // 状態を推測で置いただけ（再起動後の復元など）。実際の状態が分かったら外す
      unverified: false,
    }
    sessions.set(sessionId, r)
    return r
  }

  const setState = (r, state, since = now()) => {
    if (r.state === state) return
    r.state = state
    r.stateSince = since
  }

  const setFields = (r, { account, cwd, transcriptPath }) => {
    if (account) r.account = account
    if (cwd) r.cwd = cwd
    if (transcriptPath) r.transcriptPath = transcriptPath
  }

  // 既存のセッションを変更し、見える項目が変わったときだけ通知する
  const commit = (r, before) => {
    if (JSON.stringify(view(r)) !== before) emit({ type: 'updated', session: view(r) })
  }

  const remove = (sessionId) => {
    ended.add(sessionId)
    if (sessions.delete(sessionId)) emit({ type: 'removed', sessionId })
  }

  return {
    // フックのイベント。event: フック名、input: フックの入力、account: CLAUDE_CONFIG_DIR
    applyHookEvent({ event, input = {}, account = null }) {
      const id = input.session_id
      if (!id) return
      if (event === 'SessionEnd') return remove(id)
      if (ended.has(id)) {
        if (event !== 'SessionStart') return
        ended.delete(id)
      }

      let r = sessions.get(id)
      if (!r) {
        const initial = STATE_BY_EVENT[event] ?? (IMPLIES_WORKING.has(event) ? 'working' : 'waiting')
        r = create(id, initial)
        r.unverified = !(event in STATE_BY_EVENT) && !IMPLIES_WORKING.has(event) && event !== 'SessionStart'
        setFields(r, { account, cwd: input.cwd, transcriptPath: input.transcript_path })
        if (event === 'UserPromptSubmit' && typeof input.prompt === 'string') r.lastPrompt = input.prompt
        emit({ type: 'added', session: view(r) })
        return
      }

      const before = JSON.stringify(view(r))
      setFields(r, { account, cwd: input.cwd, transcriptPath: input.transcript_path })
      if (event === 'UserPromptSubmit' && typeof input.prompt === 'string') r.lastPrompt = input.prompt
      if (STATE_BY_EVENT[event] || IMPLIES_WORKING.has(event) || event === 'SessionStart') r.unverified = false
      if (STATE_BY_EVENT[event]) setState(r, STATE_BY_EVENT[event])
      // 許可後にツールが終わったら作業中へ戻す。それ以外の PostToolUse では動かさない
      else if (event === 'PostToolUse' && r.state === 'permission') setState(r, 'working')
      commit(r, before)
    },

    // チャネルサーバーの /poll を受けた（登録・生存確認）
    registerChannel({ sessionId, account = null, cwd = null }) {
      if (!sessionId) return
      ended.delete(sessionId)
      let r = sessions.get(sessionId)
      if (!r) {
        r = create(sessionId, 'waiting')
        r.unverified = true
        setFields(r, { account, cwd })
        r.channelAlive = true
        r.lastPollAt = now()
        emit({ type: 'added', session: view(r) })
        return
      }
      const before = JSON.stringify(view(r))
      setFields(r, { account, cwd })
      r.channelAlive = true
      r.lastPollAt = now()
      commit(r, before)
    },

    // /poll の接続が応答前に切れた = claude が終了した。即座に外す
    channelGone(sessionId) {
      if (sessions.has(sessionId)) remove(sessionId)
    },

    // 最後の /poll から期限を過ぎたセッションを外す。外した ID を返す
    sweep() {
      const gone = []
      for (const r of sessions.values()) {
        if (r.lastPollAt !== null && now() - r.lastPollAt > expireMs) gone.push(r.sessionId)
      }
      gone.forEach(remove)
      return gone
    },

    // 会話ログで中断・拒否を検知した（ADR 0007）。at: ログの時刻（ミリ秒）
    applyInterruption(sessionId, at = null) {
      const r = sessions.get(sessionId)
      if (!r || (r.state !== 'permission' && r.state !== 'working')) return false
      // 今の状態になる前の記録（以前の中断）は無視する
      if (at !== null && at < r.stateSince) return false
      const before = JSON.stringify(view(r))
      setState(r, 'waiting', at ?? now())
      commit(r, before)
      return true
    },

    // claude 自身の状態ファイル（sessions/<pid>.json）の status を反映する（ADR 0009）。at: statusUpdatedAt（ミリ秒）
    // フックで分かっている状態より新しい変化だけを採用する。推測で置いた状態（unverified）は、時刻を問わず置き換える
    applyStatus(sessionId, { status, at = null }) {
      const r = sessions.get(sessionId)
      const target = STATE_BY_STATUS[status]
      if (!r || !target) return false
      const before = JSON.stringify(view(r))
      if (r.unverified) {
        r.state = target
        r.stateSince = typeof at === 'number' && at <= now() ? at : now()
        r.unverified = false
      } else {
        if (r.state === target || typeof at !== 'number' || at <= r.stateSince) return false
        setState(r, target, at)
      }
      commit(r, before)
      return true
    },

    // 会話ログを確認する対象（許可待ち・作業中のセッションだけ）
    monitorTargets() {
      return [...sessions.values()]
        .filter((r) => (r.state === 'permission' || r.state === 'working') && r.transcriptPath)
        .map((r) => ({ sessionId: r.sessionId, transcriptPath: r.transcriptPath, state: r.state, stateSince: r.stateSince }))
    },

    list: () => [...sessions.values()].map(view),
    get: (sessionId) => (sessions.has(sessionId) ? view(sessions.get(sessionId)) : null),

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
