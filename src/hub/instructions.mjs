// 指示の待ち行列（機能 002、ADR 0013）。HTTP・WebSocket から独立した純粋なロジック。
// 作業中・許可待ち・質問待ちのセッション宛の指示は保留し、返答待ちになったときに 1 件ずつ渡す。
// 本文は、チャネルサーバーに渡した時点でメモリから消す（NFR-009）。

export const MAX_TEXT = 10_000
const PREVIEW_CHARS = 40
const IN_FLIGHT = new Set(['delivering', 'sent'])

// 状態: held 保留中 / delivering 渡した / sent 通知できた / confirmed 届いた
//       missed 指示として扱われなかった / unconfirmed 確認できない / failed 通知に失敗
//       cancelled 取り消し / lost セッション終了などで消えた
export class InstructionError extends Error {
  // code: not-found(404) / not-controllable(409) / invalid(400) / too-long(413) / not-held(409)
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const defaultNewId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0')

const previewOf = (text) => {
  const line = text.trim().split(/\r?\n/)[0]
  return line.length > PREVIEW_CHARS ? line.slice(0, PREVIEW_CHARS) + '…' : line
}

export const createInstructions = ({
  store,
  now = Date.now,
  newId = defaultNewId,
  confirmMs = 15_000,
  keepMs = 60_000,
  // 渡せる指示ができたとき（保留・状態変化のたび）に呼ばれる。呼び出し側が take() で受け取る
  onReady = () => {},
} = {}) => {
  // sessionId -> { held: [{ id, text, createdAt }], flight: { id, deliveredAt } | null, last: { id, status, deliveredAt } | null }
  const queues = new Map()
  // id -> { sessionId, status, finishedAt }。終わった指示も keepMs だけ覚える
  const records = new Map()
  const listeners = new Set()

  const queueOf = (sessionId) => {
    let q = queues.get(sessionId)
    if (!q) {
      q = { held: [], flight: null, last: null }
      queues.set(sessionId, q)
    }
    return q
  }

  const emit = (sessionId, id, status, reason) => {
    const change = { type: 'instruction', sessionId, id, status }
    if (reason) change.reason = reason
    for (const l of listeners) {
      try { l(change) } catch { /* 購読者の失敗で本体を止めない */ }
    }
  }

  const setStatus = (sessionId, id, status, reason) => {
    const rec = records.get(id) ?? { sessionId }
    rec.status = status
    rec.finishedAt = IN_FLIGHT.has(status) || status === 'held' ? null : now()
    records.set(id, rec)
    emit(sessionId, id, status, reason)
  }

  const syncPending = (sessionId) => {
    const q = queues.get(sessionId)
    store.setPending(sessionId, (q?.held ?? []).map((h) => ({ id: h.id, createdAt: h.createdAt, preview: previewOf(h.text) })))
  }

  // 前の指示が片づいて、次を渡してよいか。確認できなかった指示（unconfirmed・failed）は待たない
  const blocked = (q, session) => {
    if (q.flight) return true
    const last = q.last
    if (!last || (last.status !== 'confirmed' && last.status !== 'missed')) return false
    // 届いた指示は、そのターンが終わって返答待ちに戻るまで待つ
    return !(session.state === 'waiting' && session.stateSince > last.deliveredAt)
  }

  const dispatchable = (sessionId) => {
    const q = queues.get(sessionId)
    if (!q || q.held.length === 0) return false
    const session = store.get(sessionId)
    return Boolean(session && session.controllable && session.state === 'waiting' && !blocked(q, session))
  }

  const kick = (sessionId) => {
    if (dispatchable(sessionId)) onReady(sessionId)
  }

  const finish = (sessionId, id, status, reason) => {
    const q = queues.get(sessionId)
    if (q?.flight?.id === id) {
      q.last = { id, status, deliveredAt: q.flight.deliveredAt }
      q.flight = null
    }
    setStatus(sessionId, id, status, reason)
    kick(sessionId)
  }

  // セッションの状態が変わった・閉じられた
  const unsubscribe = store.subscribe((change) => {
    if (change.type === 'updated') kick(change.session.sessionId)
    else if (change.type === 'removed') {
      const q = queues.get(change.sessionId)
      if (!q) return
      queues.delete(change.sessionId)
      for (const h of q.held) setStatus(change.sessionId, h.id, 'lost', 'セッションが終了しました')
      if (q.flight) setStatus(change.sessionId, q.flight.id, 'lost', 'セッションが終了しました')
    }
  })

  return {
    // 指示を預かる。戻り値: { id, status }
    submit(sessionId, text) {
      const session = store.get(sessionId)
      if (!session) throw new InstructionError('not-found', 'セッションが見つかりません')
      if (!session.controllable) throw new InstructionError('not-controllable', '操作モードで起動していません')
      if (typeof text !== 'string' || text.trim() === '') throw new InstructionError('invalid', '指示が空です')
      if (text.length > MAX_TEXT) throw new InstructionError('too-long', `指示は ${MAX_TEXT} 文字までです`)
      const id = newId()
      queueOf(sessionId).held.push({ id, text, createdAt: now() })
      setStatus(sessionId, id, 'held')
      syncPending(sessionId)
      kick(sessionId)
      return { id, status: records.get(id).status }
    },

    // 保留中の指示を取り消す
    cancel(sessionId, id) {
      const q = queues.get(sessionId)
      const rec = records.get(id)
      if (!rec || rec.sessionId !== sessionId) throw new InstructionError('not-found', '指示が見つかりません')
      const index = q ? q.held.findIndex((h) => h.id === id) : -1
      if (index < 0) throw new InstructionError('not-held', '保留中ではありません')
      q.held.splice(index, 1)
      setStatus(sessionId, id, 'cancelled')
      syncPending(sessionId)
    },

    // /poll の応答に載せる指示を 1 件取り出す。渡せなければ null。本文はここで手放す
    take(sessionId) {
      if (!dispatchable(sessionId)) return null
      const q = queues.get(sessionId)
      const item = q.held.shift()
      q.flight = { id: item.id, deliveredAt: now() }
      setStatus(sessionId, item.id, 'delivering')
      syncPending(sessionId)
      return { id: item.id, text: item.text }
    },

    // チャネルサーバーが /poll で返した、通知の結果
    report(sessionId, results) {
      if (!Array.isArray(results)) return
      for (const r of results) {
        const rec = r && records.get(r.id)
        if (!rec || rec.sessionId !== sessionId || rec.status !== 'delivering') continue
        if (r.ok === true) setStatus(sessionId, r.id, 'sent')
        else finish(sessionId, r.id, 'failed', typeof r.error === 'string' ? r.error : '通知に失敗しました')
      }
    },

    // 会話ログで結果が分かった（delivery.mjs）。outcome: 'confirmed' | 'missed'
    observe(sessionId, id, outcome) {
      const rec = records.get(id)
      if (!rec || rec.sessionId !== sessionId || !IN_FLIGHT.has(rec.status)) return false
      finish(sessionId, id, outcome)
      return true
    },

    // 時間切れの確認と、古い記録の掃除。定期的に呼ぶ
    tick() {
      const t = now()
      for (const [sessionId, q] of queues) {
        if (q.flight && t - q.flight.deliveredAt > confirmMs) finish(sessionId, q.flight.id, 'unconfirmed')
      }
      for (const [id, rec] of records) {
        if (rec.finishedAt !== null && t - rec.finishedAt > keepMs) records.delete(id)
      }
    },

    // 会話ログで確認する対象（渡した指示があるセッション）
    watchTargets() {
      const targets = []
      for (const [sessionId, q] of queues) {
        if (!q.flight) continue
        const transcriptPath = store.transcriptOf(sessionId)
        if (transcriptPath) targets.push({ sessionId, id: q.flight.id, transcriptPath })
      }
      return targets
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose: unsubscribe,
  }
}
