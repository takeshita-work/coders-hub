// Hub との WebSocket クライアント。スナップショットの受信、差分の適用、切断時の自動再接続。
// WebSocket の実装とタイマーは差し替えられる（テスト用）。
import {
  addRejected, addSubmitted, collectKinds, collectSummaries, dismissRecord, reconcileInstructions, reduceInstruction, reduceMessage,
  reduceRequest, validateInstruction,
} from './logic.mjs'

export const initialState = () => ({
  sessions: new Map(),
  connected: false,
  ready: false, // 最初のスナップショットを受け取ったか（受け取るまで「空」と表示しない）
  offset: 0, // Hub の時刻 - この PC の時刻（ミリ秒）。経過時間の計算に使う
  version: null, // Hub のバージョン（snapshot で届く。メニューに出す）
  instructions: new Map(), // この画面から送った指示の記録（id -> { id, sessionId, status, reason?, preview? }）
  requestRecords: new Map(), // 閉じた許可要求・質問の結果（id -> { id, sessionId, status, reason?, summary? }）
  requestSummaries: new Map(), // 応答待ちだった要求の短い説明（結果の表示に使う。id -> 説明）
  requestKinds: new Map(), // 応答待ちだった要求の種類（permission | question。結果の色分けに使う。id -> 種類）
})

export const createClient = ({
  url,
  onChange,
  WebSocketImpl = globalThis.WebSocket,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiBase = '', // 書き込み API の接頭辞（ブラウザでは同じオリジンなので空）
  reconnectMs = 1000,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) => {
  let state = initialState()
  let socket = null
  let timer = null
  let stopped = true

  const update = (patch) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  const connect = () => {
    if (stopped) return
    const ws = new WebSocketImpl(url)
    socket = ws
    ws.onopen = () => update({ connected: true })
    ws.onmessage = (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      const patch = { sessions: reduceMessage(state.sessions, message) }
      if (message.type === 'instruction') patch.instructions = reduceInstruction(state.instructions, message, now())
      // 閉じる前の要求の説明を覚えておく（閉じたあとの session には、要求が残らない）
      if (message.type === 'request') patch.requestRecords = reduceRequest(state.requestRecords, message, state.requestSummaries, state.requestKinds, now())
      else {
        patch.requestSummaries = collectSummaries(state.requestSummaries, patch.sessions)
        patch.requestKinds = collectKinds(state.requestKinds, patch.sessions)
      }
      if (message.type === 'snapshot') {
        patch.ready = true
        if (typeof message.now === 'number') patch.offset = message.now - now()
        if (typeof message.version === 'string') patch.version = message.version
        // 再接続のたびに、保留中の指示が残っているかを確かめる（消えていれば「失われました」）
        patch.instructions = reconcileInstructions(state.instructions, patch.sessions)
      }
      update(patch)
    }
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      // 切断中は最後の一覧を残す（古い情報として表示する）。再接続で取り直す
      update({ connected: false })
      if (!stopped) timer = setTimer(connect, reconnectMs)
    }
    ws.onerror = () => {}
  }

  // 書き込み API は、他のサイトのページから叩けないよう、独自ヘッダーと JSON を付ける（ADR 0012）
  const call = (method, route, body) =>
    fetchImpl(apiBase + route, {
      method,
      headers: { 'X-Coders-Hub': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const preview = (text) => text.trim().split(/\r?\n/)[0].slice(0, 40)
  let localSeq = 0

  return {
    // 指示を送る（AC-002-1）。戻り値: { ok, reason? }。送れなかった理由は、画面に「送れませんでした」として残す
    async sendInstruction(sessionId, text) {
      const checked = validateInstruction(text)
      if (!checked.ok) return checked
      const reject = (reason) => {
        update({ instructions: addRejected(state.instructions, { localId: `local-${++localSeq}`, sessionId, reason, preview: preview(text), at: now() }) })
        return { ok: false, reason }
      }
      let res
      try {
        res = await call('POST', `/api/sessions/${encodeURIComponent(sessionId)}/instructions`, { text })
      } catch {
        return reject('Hub に接続できません')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        return reject(body.message ?? body.error ?? `送信に失敗しました（${res.status}）`)
      }
      const { id, status } = await res.json()
      update({ instructions: addSubmitted(state.instructions, { id, sessionId, status, preview: preview(text), at: now() }) })
      return { ok: true }
    },

    // 保留中の指示を取り消す（AC-003-3）
    async cancelInstruction(sessionId, id) {
      try {
        const res = await call('DELETE', `/api/sessions/${encodeURIComponent(sessionId)}/instructions/${encodeURIComponent(id)}`)
        return { ok: res.ok }
      } catch {
        return { ok: false }
      }
    },

    // 結果の表示を消す
    dismissInstruction(id) {
      update({ instructions: dismissRecord(state.instructions, id) })
    },

    // 許可要求・質問に応答する（機能 003）。許可: { behavior: 'allow' | 'deny' } / 質問: { answers }。戻り値: { ok, reason? }
    async respondRequest(sessionId, requestId, body) {
      try {
        const res = await call('POST', `/api/sessions/${encodeURIComponent(sessionId)}/requests/${encodeURIComponent(requestId)}/response`, body)
        if (res.ok) return { ok: true }
        const detail = await res.json().catch(() => ({}))
        return { ok: false, reason: detail.message ?? detail.error ?? `応答に失敗しました（${res.status}）` }
      } catch {
        return { ok: false, reason: 'Hub に接続できません' }
      }
    },

    // Hub を終了する（ADR 0020）。応答を返してから Hub が終了する。戻り値: { ok, reason? }
    async shutdownHub() {
      try {
        const res = await call('POST', '/api/shutdown', {})
        if (res.ok) return { ok: true }
        return { ok: false, reason: res.status === 501 ? 'この Hub は画面から終了できません' : `終了を要求できませんでした（${res.status}）` }
      } catch {
        return { ok: false, reason: 'Hub に接続できません' }
      }
    },

    // 会話を取得する（機能 004、ADR 0016）。etag を渡すと、変更がなければ notModified。before で、さらに前を読む。
    // 戻り値: { status: 'ok', messages, cursor, etag } | { status: 'notModified' } | { status: 'error', code }
    // 本文は、画面のメモリにだけ持つ（ブラウザに保存しない。AC-007-14）
    async fetchConversation(sessionId, { before = null, etag = null, limit = 20 } = {}) {
      const query = new URLSearchParams({ limit: String(limit) })
      if (before !== null) query.set('before', String(before))
      try {
        const res = await fetchImpl(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/conversation?${query}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { 'X-Coders-Hub': '1', ...(etag && before === null ? { 'If-None-Match': etag } : {}) },
        })
        if (res.status === 304) return { status: 'notModified' }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          return { status: 'error', code: body.error ?? `http-${res.status}` }
        }
        const body = await res.json()
        return { status: 'ok', messages: Array.isArray(body.messages) ? body.messages : [], cursor: body.cursor ?? null, etag: res.headers?.get?.('etag') ?? null }
      } catch {
        return { status: 'error', code: 'network' }
      }
    },

    // 要求の結果の表示を消す
    dismissRequest(id) {
      update({ requestRecords: dismissRecord(state.requestRecords, id) })
    },

    start() {
      if (!stopped) return
      stopped = false
      onChange(state)
      connect()
    },
    stop() {
      stopped = true
      clearTimer(timer)
      const ws = socket
      socket = null
      ws?.close()
    },
  }
}
