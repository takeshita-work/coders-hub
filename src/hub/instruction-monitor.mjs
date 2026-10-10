// 渡した指示の確認（機能 002）。渡した指示があるセッションの会話ログの末尾を短い間隔で読み、
// 指示として処理されたか（confirmed）、作業中に重なって扱われなかったか（missed）を判定する。
// あわせて、時間切れ（unconfirmed）の判定と古い記録の掃除も行う。読めなければ何もしない（時間切れになるだけ）。
import { realFiles } from './monitor.mjs'
import { findDelivery } from './delivery.mjs'

// 読む量の上限。通知の記録は、渡した直後のログの末尾にある
const TAIL_BYTES = 1024 * 1024

export const createInstructionMonitor = ({ instructions, intervalMs = 500, files = realFiles }) => {
  let timer = null
  let running = false

  const check = async ({ sessionId, id, transcriptPath }) => {
    const size = await files.size(transcriptPath)
    const start = Math.max(0, size - TAIL_BYTES)
    const text = (await files.read(transcriptPath, start, size)).toString('utf8')
    const outcome = findDelivery(text, id)
    if (outcome) instructions.observe(sessionId, id, outcome)
  }

  const tick = async () => {
    if (running) return
    running = true
    try {
      for (const target of instructions.watchTargets()) {
        try { await check(target) } catch { /* 読めなければ何もしない */ }
      }
      instructions.tick()
    } finally {
      running = false
    }
  }

  return {
    tick,
    start() {
      if (timer) return
      timer = setInterval(tick, intervalMs)
      timer.unref()
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
  }
}
