// ブラウザで動く入口。Hub の WebSocket につなぎ、一覧を表示する。
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './components.mjs'
import { createClient, initialState } from './client.mjs'
import { countStates, titleFor } from './logic.mjs'

// 絞り込みと折りたたみは、このブラウザだけの設定として保存する（読み書きに失敗しても動く）
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
  const [filter, setFilter] = useState(() => load('coders-hub.filter', 'all'))
  const [collapsed, setCollapsed] = useState(() => new Set(load('coders-hub.collapsed', [])))
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

  const onFilter = useCallback((value) => { setFilter(value); save('coders-hub.filter', value) }, [])
  const onToggle = useCallback((key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      save('coders-hub.collapsed', [...next])
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

  return h(App, { state, now: tick + state.offset, filter, collapsed, onFilter, onToggle, onSend, onCancel, onDismiss, onRespond, onDismissRequest })
}

createRoot(document.getElementById('root')).render(h(Dashboard))
