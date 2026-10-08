// Hub との WebSocket クライアント。スナップショットの受信、差分の適用、切断時の自動再接続。
// WebSocket の実装とタイマーは差し替えられる（テスト用）。
import { reduceMessage } from './logic.mjs'

export const initialState = () => ({
  sessions: new Map(),
  connected: false,
  ready: false, // 最初のスナップショットを受け取ったか（受け取るまで「空」と表示しない）
  offset: 0, // Hub の時刻 - この PC の時刻（ミリ秒）。経過時間の計算に使う
})

export const createClient = ({
  url,
  onChange,
  WebSocketImpl = globalThis.WebSocket,
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
      if (message.type === 'snapshot') {
        patch.ready = true
        if (typeof message.now === 'number') patch.offset = message.now - now()
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

  return {
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
