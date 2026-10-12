// ブラウザで動く入口。Hub の WebSocket につなぎ、一覧を表示する。
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App, defaultUi } from './components.mjs'
import { createClient, initialState } from './client.mjs'
import { applyUiPatch, countStates, titleFor } from './logic.mjs'

// 絞り込み・並び・折りたたみは、このブラウザだけの設定として保存する（読み書きに失敗しても動く）
const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 保存できなくても続ける */ }
}

const Dashboard = () => {
  const [state, setState] = useState(initialState)
  const [tick, setTick] = useState(Date.now())
  const [ui, setUi] = useState(() => ({
    ...defaultUi(),
    onlyControl: load('coders-hub.onlyControl', false) === true,
    dirSort: load('coders-hub.dirSort', 'asc') === 'desc' ? 'desc' : 'asc',
    sessSort: load('coders-hub.sessSort', 'early') === 'late' ? 'late' : 'early',
    collapsed: new Set(load('coders-hub.collapsed', [])),
  }))
  const clientRef = useRef(null)

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const client = createClient({ url, onChange: setState })
    clientRef.current = client
    client.start()
    return () => client.stop()
  }, [])

  // 経過時間を、画面を操作しなくても進める（AC-001-8）
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.title = titleFor(countStates([...state.sessions.values()]))
  }, [state.sessions])

  // 画面の状態の変更。保存するのは、絞り込み・並び・折りたたみだけ（選択やパネルの開閉は保存しない）
  const onUi = useCallback((patch) => {
    setUi((prev) => {
      const next = applyUiPatch(prev, patch)
      if ('onlyControl' in patch) save('coders-hub.onlyControl', next.onlyControl)
      if ('dirSort' in patch) save('coders-hub.dirSort', next.dirSort)
      if ('sessSort' in patch) save('coders-hub.sessSort', next.sessSort)
      if ('toggle' in patch) save('coders-hub.collapsed', [...next.collapsed])
      return next
    })
  }, [])

  // 指示の送信・取り消し・結果を閉じる（機能 002）
  const onSend = useCallback((sessionId, text) => clientRef.current.sendInstruction(sessionId, text), [])
  const onCancel = useCallback((sessionId, id) => clientRef.current.cancelInstruction(sessionId, id), [])
  const onDismiss = useCallback((id) => clientRef.current.dismissInstruction(id), [])

  // 許可要求・質問への応答、結果を閉じる（機能 003）
  const onRespond = useCallback((sessionId, requestId, body) => clientRef.current.respondRequest(sessionId, requestId, body), [])
  const onDismissRequest = useCallback((id) => clientRef.current.dismissRequest(id), [])

  // Hub の終了（機能 007、ADR 0020）
  const onShutdown = useCallback(() => clientRef.current.shutdownHub(), [])

  // 会話の取得（機能 004）。詳細を開いている間だけ、画面が呼ぶ
  const fetchConversation = useCallback((sessionId, options) => clientRef.current.fetchConversation(sessionId, options), [])

  return h(App, { state, now: tick + state.offset, ui, onUi, onSend, onCancel, onDismiss, onRespond, onDismissRequest, onShutdown, fetchConversation })
}

createRoot(document.getElementById('root')).render(h(Dashboard))
