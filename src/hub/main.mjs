// Hub 本体の起動。`npm start` または `node src/hub/main.mjs`。
// ポートがすでに使われていたら（= 別の Hub が動いている）、何もせずに終了する（NFR-005）。
import { loadConfig } from '../shared/config.mjs'
import { createHub } from './hub.mjs'

const config = loadConfig()
const log = (type, extra = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), type, ...extra }))
const hub = createHub({ config, log })

try {
  const ports = await hub.start()
  log('hub-listening', { host: config.host, ...ports })
} catch (e) {
  if (e.code === 'EADDRINUSE') {
    log('already-running', { message: 'ポートがすでに使われています。別の Hub が動いている可能性があります' })
    process.exit(0)
  }
  throw e
}

const shutdown = async () => {
  await hub.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
