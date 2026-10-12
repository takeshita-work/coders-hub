// ブラウザで動く入口。Hub の WebSocket につなぎ、一覧を表示する。
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App, defaultUi } from './components.mjs'
import { createClient, initialState } from './client.mjs'
import { applyUiPatch, countStates, titleFor } from './logic.mjs'
import { createFlasher, createNotifier, createWebAudioPlayer, detectAlert, normalizeSettings } from './notify.mjs'

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

  // 通知（音と点滅。機能 008）。設定は、このブラウザだけに保存する（壊れた値は、既定に戻す。AC-NT-10）
  const [notifySettings, setNotifySettings] = useState(() => normalizeSettings(load('coders-hub.notify', null)))
  const settingsRef = useRef(notifySettings)
  settingsRef.current = notifySettings
  const notifierRef = useRef(null)
  const prevSessionsRef = useRef(null)

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const client = createClient({ url, onChange: setState })
    clientRef.current = client
    client.start()
    return () => client.stop()
  }, [])

  // 通知の部品を作る。画面の操作（クリック・キー入力）で、続いている通知を止める（AC-NT-8）
  useEffect(() => {
    const flasher = createFlasher(document.getElementById('flash'))
    const play = createWebAudioPlayer()
    notifierRef.current = { ...createNotifier({ getSettings: () => settingsRef.current, play, flasher }), play, flasher }
    const stop = () => notifierRef.current?.stop()
    const types = ['pointerdown', 'keydown']
    types.forEach((type) => document.addEventListener(type, stop, true))
    return () => { types.forEach((type) => document.removeEventListener(type, stop, true)); stop() }
  }, [])

  // セッションの状態が変わったら、出来事を見つけて知らせる。最初のスナップショットでは、知らせない（AC-NT-1〜4）
  useEffect(() => {
    if (!state.ready) { prevSessionsRef.current = null; return }
    const kind = detectAlert(prevSessionsRef.current, state.sessions)
    prevSessionsRef.current = state.sessions
    if (kind) notifierRef.current?.notify(kind)
  }, [state.sessions, state.ready])

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

  // 通知の設定の変更（保存する）と、試しに鳴らす・光らせる（AC-NT-9）
  const onNotifySettings = useCallback((patch) => setNotifySettings((prev) => {
    const next = normalizeSettings({ ...prev, ...patch })
    save('coders-hub.notify', next)
    return next
  }), [])
  const onPreview = useCallback((kind) => {
    const notifier = notifierRef.current
    const settings = settingsRef.current
    if (!notifier) return
    if (kind === 'sound') { if (!settings.mute && settings.volume > 0) notifier.play('complete', settings.volume) } else notifier.flasher.flash('complete')
  }, [])
  const notify = { settings: notifySettings, onSettings: onNotifySettings, onPreview }

  // Hub の終了（機能 007、ADR 0020）
  const onShutdown = useCallback(() => clientRef.current.shutdownHub(), [])

  // 会話の取得（機能 004）。詳細を開いている間だけ、画面が呼ぶ
  const fetchConversation = useCallback((sessionId, options) => clientRef.current.fetchConversation(sessionId, options), [])

  return h(App, { state, now: tick + state.offset, ui, onUi, onSend, onCancel, onDismiss, onRespond, onDismissRequest, onShutdown, fetchConversation, notify })
}

createRoot(document.getElementById('root')).render(h(Dashboard))
