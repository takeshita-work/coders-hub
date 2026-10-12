// hook.mjs / channel.mjs / start から Hub 本体の内部 API を呼ぶための共通部品。
import { spawn } from 'node:child_process'
import { isSea } from 'node:sea'
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

// Hub を別プロセスとして起動する（起動元が終わっても残る）。多重に起動しても、
// ポートを確保できなかった側は main.mjs が何もせず終了するので、1 つだけ残る（NFR-005）
// 配布版（exe）では、自分と同じ exe を `hub` で起動する。開発時は、node で src/hub/main.mjs を起動する（ADR 0018）
// 起動するのは `coders-hub start` だけ。チャネルサーバーは起動しない（ADR 0020）。stdio: Hub の出力の行き先（ログファイルの fd）
export const startHubProcess = (spawnFn = spawn, env = process.env, { sea = isSea(), execPath = process.execPath, stdio = 'ignore' } = {}) => {
  // 起動元のセッション固有の環境変数は引き継がない
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE')))
  const child = spawnFn(execPath, sea ? ['hub'] : [HUB_ENTRY], {
    cwd: sea ? path.dirname(execPath) : ROOT,
    env: clean,
    detached: true,
    stdio,
    windowsHide: true,
  })
  child.on?.('error', () => {})
  child.unref?.()
}
