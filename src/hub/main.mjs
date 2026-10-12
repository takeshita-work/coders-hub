// Hub 本体の起動。`npm start` または `node src/hub/main.mjs`（配布版は `coders-hub.exe hub`）。
// ポートがすでに使われていたら（= 別の Hub が動いている）、何もせずに終了する（NFR-005）。
import { loadConfig } from '../shared/config.mjs'
import { isDirectRun } from '../shared/entry.mjs'
import { createHub } from './hub.mjs'

// options.staticAssets: 画面のファイルの配信元（配布版は、exe に埋め込んだもの）。省略すると、dist/web を読む。onListening: 待ち受けを始めたとき（ポートを渡す）
export const runHub = async ({ staticAssets, onListening } = {}) => {
  const config = loadConfig()
  const log = (type, extra = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), type, ...extra }))
  const shutdown = async () => {
    await hub.stop()
    process.exit(0)
  }
  // 画面の「Hub を終了」から止められる（ADR 0020）
  const hub = createHub({ config, log, onShutdown: shutdown, ...(staticAssets ? { staticAssets } : {}) })

  try {
    const ports = await hub.start()
    log('hub-listening', { host: config.host, ...ports })
    onListening?.(ports)
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      log('already-running', { message: 'ポートがすでに使われています。別の Hub が動いている可能性があります' })
      process.exit(0)
    }
    throw e
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (isDirectRun(import.meta.url)) runHub().catch((e) => { console.error(e); process.exit(1) })
