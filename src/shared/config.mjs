// 設定の置き場所（ADR 0019）。優先順位: 環境変数 > 設定ファイル（config.json）> 既定値。
// hook.mjs / channel.mjs / hub.mjs が共通で読む。3 つが同じファイルを読むので、ポートがずれない。
// 設定ファイル: %APPDATA%\coders-hub\config.json（環境変数 CODERS_HUB_CONFIG でパスを変えられる）。
// 設定ファイルで変えられるのは、ポート（internalPort・uiPort）だけ。

import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_INTERNAL_PORT = 47765
export const DEFAULT_UI_PORT = 47766

const parsePort = (raw, label) => {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error(`${label} は 1〜65535 の整数で指定してください: ${raw}`)
  return n
}

const intFromEnv = (env, name, fallback) => {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} は正の整数で指定してください: ${raw}`)
  return n
}

// 設定ファイルのパス。環境変数に APPDATA も CODERS_HUB_CONFIG もなければ、null（ファイルは読まない）
export const configFilePath = (env = process.env) =>
  env.CODERS_HUB_CONFIG || (env.APPDATA ? path.join(env.APPDATA, 'coders-hub', 'config.json') : null)

// ファイルがなければ {}。壊れているときは、ファイルのパスを入れたエラーにする（黙って既定値に戻すと、ポートがずれる）
const readConfigFile = (file, readFile) => {
  if (!file) return {}
  let text
  try {
    text = readFile(file)
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw new Error(`設定ファイルを読めません: ${file}（${e.message}）`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new Error(`設定ファイルが JSON として読めません: ${file}（${e.message}）`)
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error(`設定ファイルは JSON のオブジェクトで書いてください: ${file}`)
  const out = {}
  for (const key of ['internalPort', 'uiPort']) {
    if (json[key] !== undefined) out[key] = parsePort(json[key], `${file} の ${key}`)
  }
  return out
}

export const loadConfig = (env = process.env, { readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) => {
  const file = readConfigFile(configFilePath(env), readFile)
  return {
    host: '127.0.0.1',
    // 内部 API（hook / channel → Hub）。外に出さない（security.md）
    internalPort: intFromEnv(env, 'CODERS_HUB_INTERNAL_PORT', file.internalPort ?? DEFAULT_INTERNAL_PORT),
    // 画面と WebSocket
    uiPort: intFromEnv(env, 'CODERS_HUB_UI_PORT', file.uiPort ?? DEFAULT_UI_PORT),
    // 長いポーリングの周期と、最後の /poll からの削除期限（NFR-006）
    pollTimeoutMs: intFromEnv(env, 'CODERS_HUB_POLL_TIMEOUT_MS', 30_000),
    expireMs: intFromEnv(env, 'CODERS_HUB_EXPIRE_MS', 50_000),
    // 質問（AskUserQuestion）の答えを待つ上限。質問用フックの timeout（設定、100 秒）より短くする（機能 003）
    askWaitMs: intFromEnv(env, 'CODERS_HUB_ASK_WAIT_MS', 85_000),
  }
}
