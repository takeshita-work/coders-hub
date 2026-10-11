// ファイルを直接実行したか（`node src/hub/main.mjs` など）。束ねた exe の中では、false になる
// （束ねるとき、import.meta.url を、実在しない固定の URL に置き換えるため。scripts/build-exe.mjs）。
// 最上位の await を使わずに入口を書くための部品（SEA は CommonJS のみ。ADR 0018）
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const isDirectRun = (metaUrl) => {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(fs.realpathSync(process.argv[1])).href === metaUrl
  } catch {
    return false
  }
}
