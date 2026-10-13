// 通知（音と点滅）。機能 008、ADR 0030。
// 画面（ブラウザ）の中だけで完結する。セッションの一覧の前後を比べて出来事を見つけ、設定の時間だけ、音と点滅をくり返す。
// 副作用（音・点滅・タイマー）は、差し替えられる（テスト用）。

export const ALERT_EVERY_MS = 3000 // くり返しの間隔
export const ALERT_MAX_MS = 10 * 60 * 1000 // 「操作するまで」の上限（止め忘れても、ここで止まる）

// 続ける時間の選択肢（秒）。0 = 操作するまで
export const DURATIONS = [
  { sec: 5, label: '5 秒' },
  { sec: 15, label: '15 秒' },
  { sec: 30, label: '30 秒' },
  { sec: 60, label: '1 分' },
  { sec: 0, label: '操作するまで' },
]

export const DEFAULT_SETTINGS = { mute: false, volume: 60, blink: true, alertSec: 15 }

// 保存された設定を検証して、既定で補う（壊れた値は、既定に戻す。AC-NT-10）
export const normalizeSettings = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {}
  const volume = Number.isFinite(r.volume) ? Math.min(100, Math.max(0, Math.round(r.volume))) : DEFAULT_SETTINGS.volume
  return {
    mute: typeof r.mute === 'boolean' ? r.mute : DEFAULT_SETTINGS.mute,
    volume,
    blink: typeof r.blink === 'boolean' ? r.blink : DEFAULT_SETTINGS.blink,
    alertSec: DURATIONS.some((d) => d.sec === r.alertSec) ? r.alertSec : DEFAULT_SETTINGS.alertSec,
  }
}

// 続ける時間（ミリ秒）
export const alertMs = (settings) => (settings.alertSec === 0 ? ALERT_MAX_MS : settings.alertSec * 1000)

// ---- 出来事の検出 ----

export const RANK = { permission: 3, question: 2, complete: 1 }

// 1 セッションぶんの、状態の変化から出来事の種類を決める（なければ null）
//  - 前の状態がない（新しく現れた）・状態が変わらないときは、null（AC-NT-3）
//  - 許可待ちになった → permission、質問待ちになった → question、作業中 → 返答待ち → complete（AC-NT-1, 2）
const kindOf = (before, session) => {
  if (!before || before.state === session.state) return null
  if (session.state === 'permission') return 'permission'
  if (session.state === 'question') return 'question'
  if (before.state === 'working' && session.state === 'waiting') return 'complete'
  return null
}

// 前の一覧と次の一覧（どちらも sessionId -> セッションの Map）を比べて、知らせる出来事を 1 つ返す（なければ null）。
//  - 前の一覧がない（最初のスナップショット）ときは、知らせない（AC-NT-3）
//  - 複数あれば、許可 > 質問 > 完了（AC-NT-4）
export const detectAlert = (prev, next) => {
  if (!prev) return null
  let found = null
  for (const [id, session] of next) {
    const kind = kindOf(prev.get(id), session)
    if (kind && (!found || RANK[kind] > RANK[found])) found = kind
  }
  return found
}

// 出来事があった、すべてのセッション（サイドバーの目印用。AC-NT-12）。戻り値: sessionId -> 出来事の種類の Map
// detectAlert と同じ判定だが、1 つに絞らず、起きたセッションぶんすべて返す
export const detectMarks = (prev, next) => {
  const marks = new Map()
  if (!prev) return marks
  for (const [id, session] of next) {
    const kind = kindOf(prev.get(id), session)
    if (kind) marks.set(id, kind)
  }
  return marks
}

// ---- 音と点滅 ----

// 音（周波数 Hz）。完了＝上がる 3 音、許可＝同じ音 2 回、質問＝上がる 2 音（AC-NT-5）
export const TONES = { complete: [523.25, 659.25, 783.99], permission: [660, 660], question: [392, 523.25] }
export const TONE_STEP_S = 0.16 // 音のずらし幅（秒）

// 点滅の色（AC-NT-6）。CSS の変数
export const FLASH_COLOR = { complete: 'var(--working)', permission: 'var(--permission-solid)', question: 'var(--question-solid)' }

// WebAudio で音を鳴らす部品。AudioContext は、最初に鳴らすときに作る（ブラウザの決まりで、操作の前は鳴らない）。
// 鳴らせなくても、例外にしない（AC-NT-5）。volume: 0〜100
export const createWebAudioPlayer = ({ AudioContextImpl = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) => {
  let context = null
  return (kind, volume) => {
    const tones = TONES[kind]
    if (!tones || !AudioContextImpl) return false
    try {
      context ??= new AudioContextImpl()
      if (context.state === 'suspended') context.resume?.()
      const t0 = context.currentTime
      tones.forEach((frequency, i) => {
        const osc = context.createOscillator()
        const gain = context.createGain()
        const at = t0 + i * TONE_STEP_S
        osc.type = 'sine'
        osc.frequency.value = frequency
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime((volume / 100) * 0.3, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24)
        osc.connect(gain)
        gain.connect(context.destination)
        osc.start(at)
        osc.stop(at + 0.27)
      })
      return true
    } catch {
      return false
    }
  }
}

// 画面の縁の点滅。element に、色の変数と、on クラスを付け直して、アニメーションをやり直す（AC-NT-6）
export const createFlasher = (element) => ({
  flash: (kind) => {
    if (!element) return
    element.style.setProperty('--flash', FLASH_COLOR[kind])
    element.classList.remove('on')
    void element.offsetWidth // アニメーションを、最初からやり直すために、再計算させる
    element.classList.add('on')
  },
  clear: () => element?.classList.remove('on'),
})

// ---- 通知（くり返しと止め方）----

// getSettings: いまの設定を返す（続けている間も、その時点の設定を使う）。play(kind, volume)・flasher.flash(kind)・flasher.clear()
// notify(kind): 前の通知を止めて、すぐ 1 回、そのあと ALERT_EVERY_MS ごとにくり返す。設定の時間がたったら、止まる（AC-NT-8）
// stop(): 止める（画面の操作で呼ぶ）
export const createNotifier = ({
  getSettings, play, flasher, setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = Date.now,
}) => {
  let timer = null
  const stop = () => {
    if (timer !== null) clearIntervalFn(timer)
    timer = null
    flasher.clear()
  }
  const once = (kind) => {
    const settings = getSettings()
    if (!settings.mute && settings.volume > 0) play(kind, settings.volume)
    if (settings.blink) flasher.flash(kind)
  }
  const notify = (kind) => {
    stop()
    once(kind)
    const end = now() + alertMs(getSettings())
    // 次の回が、終わりの半周期より後になるなら、そこで止める（5 秒の設定で、0 秒と 3 秒の 2 回）
    timer = setIntervalFn(() => (now() + ALERT_EVERY_MS / 2 >= end ? stop() : once(kind)), ALERT_EVERY_MS)
  }
  return { notify, stop, active: () => timer !== null, once }
}
