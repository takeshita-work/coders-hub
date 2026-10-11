// バージョン。配布版は、束ねるときに __CODERS_HUB_VERSION__ が置き換わる（scripts/build-exe.mjs）。開発時は package.json から読む
import fs from 'node:fs'

const read = () => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

export const VERSION = typeof __CODERS_HUB_VERSION__ === 'string' ? __CODERS_HUB_VERSION__ : read()
