// hook.mjs / channel.mjs から Hub 本体の内部 API を呼ぶための共通部品。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '../..')
export const HUB_ENTRY = path.join(ROOT, 'src/hub/main.mjs')

const baseUrl = (config) => `http://${config.host}:${config.internalPort}`

export const postJson = (config, route, body, { timeoutMs = 1500 } = {}) =>
  fetch(baseUrl(config) + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

export const isHubUp = async (config, timeoutMs = 500) => {
  try {
    const res = await fetch(baseUrl(config) + '/health', { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

// Hub を別プロセスとして起動する（claude が終わっても残る）。多重に起動しても、
// ポートを確保できなかった側は main.mjs が何もせず終了するので、1 つだけ残る（NFR-005）
export const startHubProcess = (spawnFn = spawn, env = process.env) => {
  // 起動元のセッション固有の環境変数は引き継がない
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE')))
  const child = spawnFn(process.execPath, [HUB_ENTRY], {
    cwd: ROOT,
    env: clean,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.on?.('error', () => {})
  child.unref?.()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Hub が動いていることを確認し、動いていなければ起動して待つ。動いていれば true
export const ensureHub = async (
  config,
  { up = isHubUp, spawnHub = startHubProcess, waitMs = 3000, intervalMs = 100, wait = sleep } = {},
) => {
  if (await up(config)) return true
  try { spawnHub() } catch { return false }
  for (let waited = 0; waited < waitMs; waited += intervalMs) {
    await wait(intervalMs)
    if (await up(config)) return true
  }
  return false
}
