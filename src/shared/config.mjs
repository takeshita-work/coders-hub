// 設定の置き場所（ADR 0019）。優先順位: 環境変数 > 設定ファイル（config.json）> 既定値。
// hook.mjs / channel.mjs / hub.mjs が共通で読む。3 つが同じファイルを読むので、ポートがずれない。
// 設定ファイル: 配布版は coders-hub.exe と同じフォルダの config.json（ADR 0021。コメントを書ける: ADR 0023）。環境変数 CODERS_HUB_CONFIG でパスを変えられる。
// 開発時（node で起動）は、CODERS_HUB_CONFIG を指定したときだけ読む。
// 設定ファイルで変えられるのは、ポート（internalPort・uiPort）だけ。

import fs from 'node:fs'
import path from 'node:path'
import { isSea } from 'node:sea'

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

// 設定ファイルのパス。CODERS_HUB_CONFIG > exe と同じフォルダの config.json（配布版のみ）。どちらもなければ null（ファイルは読まない）
export const configFilePath = (env = process.env, { sea = isSea(), execPath = process.execPath } = {}) =>
  env.CODERS_HUB_CONFIG || (sea ? path.join(path.dirname(execPath), 'config.json') : null)

// JSONC: // の行コメントと /* */ のブロックコメントを許す（ADR 0023）。文字列の中の // などはそのまま。
// コメントは空白に置き換える（改行は残す）ので、JSON.parse のエラー位置がずれない。先頭の BOM（メモ帳など）は取り除く
export const stripJsonComments = (text) => {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\r\n]/g, ' ')
      i = stop
    } else {
      out += c
      i += 1
    }
  }
  return out
}

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
    json = JSON.parse(stripJsonComments(text))
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

export const loadConfig = (env = process.env, { readFile = (f) => fs.readFileSync(f, 'utf8'), sea, execPath } = {}) => {
  const file = readConfigFile(configFilePath(env, { ...(sea === undefined ? {} : { sea }), ...(execPath === undefined ? {} : { execPath }) }), readFile)
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
