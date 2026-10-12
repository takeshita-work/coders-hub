// `coders-hub start`（引数なしの実行を含む）: Hub を、ウィンドウなしで切り離して起動し、すぐ終了する（ADR 0020）。
// Hub の出力は %LOCALAPPDATA%\coders-hub\hub.log に追記する。起動できない理由（設定ファイルの誤りなど）も、ここに残る。
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../shared/config.mjs'
import { isHubUp, startHubProcess } from '../shared/hub-client.mjs'

export const MAX_LOG_BYTES = 1024 * 1024

export const hubLogPath = (env = process.env) => (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'coders-hub', 'hub.log') : null)

// ログを追記用に開く。上限を超えていたら作り直す。開けなければ null（ログなしで続ける）
export const openHubLog = (file, { maxBytes = MAX_LOG_BYTES, fsImpl = fs } = {}) => {
  if (!file) return null
  try {
    fsImpl.mkdirSync(path.dirname(file), { recursive: true })
    let flags = 'a'
    try {
      if (fsImpl.statSync(file).size > maxBytes) flags = 'w'
    } catch {
      // まだない
    }
    return fsImpl.openSync(file, flags)
  } catch {
    return null
  }
}

// 戻り値: { started: true } 起動した / { started: false, reason: 'running' | 'config' | 'spawn' }
export const startHub = async ({
  env = process.env,
  load = loadConfig,
  up = isHubUp,
  spawnHub = startHubProcess,
  openLog = openHubLog,
  closeLog = (fd) => fs.closeSync(fd),
  logFile = hubLogPath(env),
  write = (fd, text) => fs.writeSync(fd, text),
} = {}) => {
  const fd = openLog(logFile)
  const note = (text) => { if (fd !== null) { try { write(fd, `${JSON.stringify({ at: new Date().toISOString(), type: 'start', message: text })}\n`) } catch { /* ログに書けなくても続ける */ } } }
  try {
    let config
    try {
      config = load(env)
    } catch (e) {
      note(`設定を読めないので、Hub を起動しません: ${e.message}`)
      return { started: false, reason: 'config' }
    }
    if (await up(config)) return { started: false, reason: 'running' }
    try {
      spawnHub(undefined, env, { stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'] })
    } catch (e) {
      note(`Hub を起動できませんでした: ${e.message}`)
      return { started: false, reason: 'spawn' }
    }
    return { started: true }
  } finally {
    if (fd !== null) { try { closeLog(fd) } catch { /* 閉じられなくても続ける */ } }
  }
}
