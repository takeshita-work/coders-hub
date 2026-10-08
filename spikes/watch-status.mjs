// 検証スパイク用（使い捨て）: claude が各アカウントの sessions/<pid>.json に書く status の変化を記録する。
// 目的: 通常の作業中の Esc など、フックと会話ログでは検知できない状態の変化を拾えるか確認する。
//   node spikes/watch-status.mjs <アカウントのフォルダ>...   （省略すると下の既定を見る）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'logs')
fs.mkdirSync(logDir, { recursive: true })
const logFile = path.join(logDir, 'status.jsonl')

const dirs = process.argv.length > 2
  ? process.argv.slice(2)
  : ['C:\\Users\\yuya\\.claude-takeshita.work', 'C:\\Users\\yuya\\.claude-soilook']

const last = new Map() // ファイル -> 直近の内容（status の変化だけ記録する）
const log = (entry) => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry })
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
}

const scan = () => {
  const seen = new Set()
  for (const dir of dirs) {
    const sessionsDir = path.join(dir, 'sessions')
    let files = []
    try { files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json')) } catch { continue }
    for (const f of files) {
      const file = path.join(sessionsDir, f)
      seen.add(file)
      let j
      try { j = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
      const key = `${j.status}|${j.waitingFor ?? ''}`
      const prev = last.get(file)
      if (prev === undefined || prev.key !== key) {
        log({
          type: prev === undefined ? 'first-seen' : 'status-change',
          account: path.basename(dir), pid: j.pid, session: String(j.sessionId).slice(0, 8),
          from: prev?.key ?? null, to: key, statusUpdatedAt: j.statusUpdatedAt,
          extraKeys: Object.keys(j).filter((k) => !['pid', 'sessionId', 'cwd', 'startedAt', 'procStart', 'version', 'peerProtocol', 'peerFeatures', 'kind', 'entrypoint', 'pidDomain', 'messagingSocketPath', 'name', 'nameSource', 'nameSince', 'updatedAt', 'statusUpdatedAt', 'status'].includes(k)),
        })
        last.set(file, { key })
      }
    }
  }
  for (const file of [...last.keys()]) {
    if (!seen.has(file)) { log({ type: 'file-removed', file: path.basename(file) }); last.delete(file) }
  }
}

setInterval(scan, 250)
scan()
