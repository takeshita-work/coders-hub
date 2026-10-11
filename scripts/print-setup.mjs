// セットアップに必要な設定を、このリポジトリの場所に合わせて表示する。
//   node scripts/print-setup.mjs
// 表示された内容を、アカウントごと（CLAUDE_CONFIG_DIR）に反映する。手順は docs/setup.md。
// 配布版の exe では、`coders-hub.exe setup` が同じ内容を表示する（exe のパスを指す）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSetup } from '../src/setup/render.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
console.log(renderSetup({
  paths: {
    hook: path.join(root, 'src/hook/hook.mjs'),
    askHook: path.join(root, 'src/hook/ask-hook.mjs'),
    channel: path.join(root, 'src/channel/channel.mjs'),
  },
}))
