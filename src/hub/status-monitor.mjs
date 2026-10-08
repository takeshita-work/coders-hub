// claude 自身の状態ファイル（<CLAUDE_CONFIG_DIR>/sessions/<pid>.json）の status を読み、Hub の状態のずれを直す（ADR 0009）。
// フックも会話ログも出さない変化（通常の作業中の Esc など）を拾える。非公開のファイルなので補助に限る:
// 読めない・形式が違う場合は何もしない（状態の主はフック）。
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const realFs = { readdir: fs.readdir, readFile: (file) => fs.readFile(file, 'utf8') }

// アカウント（CLAUDE_CONFIG_DIR）が分からないセッションは、既定の ~/.claude を見る
export const sessionsDirOf = (account, home = os.homedir()) => path.join(account || path.join(home, '.claude'), 'sessions')

export const createStatusMonitor = ({ store, intervalMs = 500, files = realFs, home = os.homedir() }) => {
  let timer = null
  let running = false

  const readDir = async (dir) => {
    const found = []
    let names
    try { names = await files.readdir(dir) } catch { return found }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const j = JSON.parse(await files.readFile(path.join(dir, name)))
        if (typeof j?.sessionId === 'string') found.push(j)
      } catch { /* 書き込み中・壊れたファイルは次回に回す */ }
    }
    return found
  }

  const tick = async () => {
    if (running) return
    running = true
    try {
      const dirs = new Set(store.list().map((s) => sessionsDirOf(s.account, home)))
      for (const dir of dirs) {
        for (const j of await readDir(dir)) {
          if (store.get(j.sessionId)) store.applyStatus(j.sessionId, { status: j.status, at: j.statusUpdatedAt })
        }
      }
    } catch { /* 補助なので、失敗しても本体は動き続ける */ } finally {
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
