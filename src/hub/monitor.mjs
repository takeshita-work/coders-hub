// 会話ログの定期確認（ADR 0007）。許可待ち・作業中のセッションだけ、ログの追記分を読んで中断・拒否を探す。
// 補助用途: 読み取りに失敗しても何もしない（状態の主はフック）。
import fs from 'node:fs/promises'
import { findInterruption } from './transcript.mjs'

// 1 回に読む量の上限。これを超える追記は読まずに読み取り位置だけ進める
const MAX_READ_BYTES = 8 * 1024 * 1024

export const realFiles = {
  async size(path) {
    return (await fs.stat(path)).size
  },
  async read(path, start, end) {
    const handle = await fs.open(path, 'r')
    try {
      const buf = Buffer.alloc(end - start)
      const { bytesRead } = await handle.read(buf, 0, buf.length, start)
      return buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
}

export const createTranscriptMonitor = ({ store, intervalMs = 1000, files = realFiles }) => {
  // sessionId -> { path, offset }。確認の対象から外れたら忘れる
  const positions = new Map()
  let timer = null
  let running = false

  const check = async ({ sessionId, transcriptPath }) => {
    const size = await files.size(transcriptPath)
    const pos = positions.get(sessionId)
    // 初めて見る・ファイルが変わった・小さくなった: 今の末尾を起点にする（以前の記録は見ない）
    if (!pos || pos.path !== transcriptPath || size < pos.offset) {
      positions.set(sessionId, { path: transcriptPath, offset: size })
      return
    }
    if (size === pos.offset) return
    if (size - pos.offset > MAX_READ_BYTES) {
      pos.offset = size
      return
    }
    const buf = await files.read(transcriptPath, pos.offset, size)
    const lastNewline = buf.lastIndexOf(0x0a)
    if (lastNewline < 0) return // 行がまだ書き終わっていない。次回に回す
    pos.offset += lastNewline + 1
    const found = findInterruption(buf.subarray(0, lastNewline + 1).toString('utf8'))
    if (found) store.applyInterruption(sessionId, found.at)
  }

  const tick = async () => {
    if (running) return
    running = true
    try {
      const targets = store.monitorTargets()
      const live = new Set(targets.map((t) => t.sessionId))
      for (const id of [...positions.keys()]) if (!live.has(id)) positions.delete(id)
      for (const target of targets) {
        try { await check(target) } catch { /* 読めなければ何もしない */ }
      }
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
