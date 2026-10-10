// Hub との WebSocket クライアント。スナップショットの受信、差分の適用、切断時の自動再接続。
// WebSocket の実装とタイマーは差し替えられる（テスト用）。
import { addRejected, addSubmitted, dismissRecord, reconcileInstructions, reduceInstruction, reduceMessage, validateInstruction } from './logic.mjs'

export const initialState = () => ({
  sessions: new Map(),
  connected: false,
  ready: false, // 最初のスナップショットを受け取ったか（受け取るまで「空」と表示しない）
  offset: 0, // Hub の時刻 - この PC の時刻（ミリ秒）。経過時間の計算に使う
  instructions: new Map(), // この画面から送った指示の記録（id -> { id, sessionId, status, reason?, preview? }）
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
      if (message.type === 'instruction') patch.instructions = reduceInstruction(state.instructions, message)
      if (message.type === 'snapshot') {
        patch.ready = true
        if (typeof message.now === 'number') patch.offset = message.now - now()
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
        update({ instructions: addRejected(state.instructions, { localId: `local-${++localSeq}`, sessionId, reason, preview: preview(text) }) })
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
      update({ instructions: addSubmitted(state.instructions, { id, sessionId, status, preview: preview(text) }) })
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
