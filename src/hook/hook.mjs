// Claude Code のフックから起動され、イベントを Hub 本体へ送る。
// claude の動作を妨げないよう、失敗は黙って無視し、必ず終了コード 0 で終わる。何も出力しない。
import { loadConfig } from '../shared/config.mjs'
import { postJson } from '../shared/hub-client.mjs'
import { buildEvent } from './payload.mjs'

// 何があっても数秒で終わる
setTimeout(() => process.exit(0), 3000).unref()

try {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const body = buildEvent(JSON.parse(raw))
  if (body) await postJson(loadConfig(), '/event', body, { timeoutMs: 1500 })
} catch {
  // Hub が落ちている・入力が壊れている場合も何もしない
}
process.exit(0)
