// 配布版の exe の入口（scripts/build-exe.mjs が束ねる）。ファイルを直接実行したかの判定が使えないので、ここで main を呼ぶ。
import { main } from './main.mjs'

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
