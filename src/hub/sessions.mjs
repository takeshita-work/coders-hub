// セッション一覧の状態管理（HTTP・WebSocket から独立した純粋なロジック）。
// plan.md「状態遷移とフック」「生存確認と削除」に対応する。時刻は差し替え可能にしてテストする。

import { promptText } from './prompt.mjs'

// モデルからの質問（AskUserQuestion）は、ツールの許可ではなく回答を求めるものなので、許可待ちと分けて「質問待ち」にする（ADR 0010）
const QUESTION_TOOL = 'AskUserQuestion'

const STATE_BY_EVENT = {
  UserPromptSubmit: 'working',
  Stop: 'waiting',
}
// 状態を決めるフック（PermissionRequest は、ツールによって許可待ちか質問待ちになる）
const stateForEvent = (event, input) =>
  event === 'PermissionRequest' ? (input.tool_name === QUESTION_TOOL ? 'question' : 'permission') : STATE_BY_EVENT[event]

// 人の応答を待って止まっている状態（許可待ち・質問待ち）
const isBlocked = (state) => state === 'permission' || state === 'question'
// 未登録のセッションでこれらを受けたら、作業中として登録する（SessionStart より先に届いた場合など）
const IMPLIES_WORKING = new Set(['PreToolUse', 'PostToolUse'])

// claude 自身が書く sessions/<pid>.json の status（ADR 0009）。waiting は waitingFor で、質問待ち（input needed）と許可待ちに分ける
const stateForStatus = (status, waitingFor) => {
  if (status === 'busy') return 'working'
  if (status === 'idle') return 'waiting'
  if (status === 'waiting') return waitingFor === 'input needed' ? 'question' : 'permission'
  return undefined
}

const view = (r) => ({
  sessionId: r.sessionId,
  account: r.account,
  cwd: r.cwd,
  state: r.state,
  stateSince: r.stateSince,
  lastPrompt: r.lastPrompt,
  channelAlive: r.channelAlive,
  // 操作モードのチャネルサーバーが接続している = 指示を送れる（ADR 0011）
  controllable: r.controllable,
  // 保留中の指示 [{ id, createdAt, preview }]（002-send-instruction）
  pending: r.pending,
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
      controllable: false, pending: [],
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
        const decided = stateForEvent(event, input)
        r = create(id, decided ?? (IMPLIES_WORKING.has(event) ? 'working' : 'waiting'))
        r.unverified = !decided && !IMPLIES_WORKING.has(event) && event !== 'SessionStart'
        setFields(r, { account, cwd: input.cwd, transcriptPath: input.transcript_path })
        if (event === 'UserPromptSubmit' && typeof input.prompt === 'string') r.lastPrompt = promptText(input.prompt)
        emit({ type: 'added', session: view(r) })
        return
      }

      const before = JSON.stringify(view(r))
      setFields(r, { account, cwd: input.cwd, transcriptPath: input.transcript_path })
      if (event === 'UserPromptSubmit' && typeof input.prompt === 'string') r.lastPrompt = promptText(input.prompt)
      const decided = stateForEvent(event, input)
      if (decided || IMPLIES_WORKING.has(event) || event === 'SessionStart') r.unverified = false
      if (decided) setState(r, decided)
      // 許可後にツールが終わったら作業中へ戻す。それ以外の PostToolUse では動かさない
      else if (event === 'PostToolUse' && isBlocked(r.state)) setState(r, 'working')
      commit(r, before)
    },

    // チャネルサーバーの /poll を受けた（登録・生存確認）
    registerChannel({ sessionId, account = null, cwd = null, channel = false }) {
      if (!sessionId) return
      ended.delete(sessionId)
      let r = sessions.get(sessionId)
      if (!r) {
        r = create(sessionId, 'waiting')
        r.unverified = true
        setFields(r, { account, cwd })
        r.channelAlive = true
        r.controllable = channel === true
        r.lastPollAt = now()
        emit({ type: 'added', session: view(r) })
        return
      }
      const before = JSON.stringify(view(r))
      setFields(r, { account, cwd })
      r.channelAlive = true
      r.controllable = channel === true
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
      if (!r || (!isBlocked(r.state) && r.state !== 'working')) return false
      // 今の状態になる前の記録（以前の中断）は無視する
      if (at !== null && at < r.stateSince) return false
      const before = JSON.stringify(view(r))
      setState(r, 'waiting', at ?? now())
      commit(r, before)
      return true
    },

    // claude 自身の状態ファイル（sessions/<pid>.json）の status を反映する（ADR 0009）。at: statusUpdatedAt（ミリ秒）
    // フックで分かっている状態より新しい変化だけを採用する。推測で置いた状態（unverified）は、時刻を問わず置き換える
    applyStatus(sessionId, { status, waitingFor = null, at = null }) {
      const r = sessions.get(sessionId)
      const target = stateForStatus(status, waitingFor)
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
        .filter((r) => (isBlocked(r.state) || r.state === 'working') && r.transcriptPath)
        .map((r) => ({ sessionId: r.sessionId, transcriptPath: r.transcriptPath, state: r.state, stateSince: r.stateSince }))
    },

    // 保留中の指示の一覧を更新する（instructions.mjs から）。変わったときだけ通知する
    setPending(sessionId, pending) {
      const r = sessions.get(sessionId)
      if (!r) return
      const before = JSON.stringify(view(r))
      r.pending = pending
      commit(r, before)
    },

    // 会話ログの場所（指示が届いたかの確認に使う）
    transcriptOf: (sessionId) => sessions.get(sessionId)?.transcriptPath ?? null,

    list: () => [...sessions.values()].map(view),
    get: (sessionId) => (sessions.has(sessionId) ? view(sessions.get(sessionId)) : null),

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
