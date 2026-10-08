// セットアップに必要な設定を、このリポジトリの場所に合わせて表示する。
//   node scripts/print-setup.mjs
// 表示された内容を、アカウントごと（CLAUDE_CONFIG_DIR）に反映する。手順は docs/setup.md。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHooksConfig } from '../src/setup/hooks-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hookPath = path.join(root, 'src/hook/hook.mjs')
const channelPath = path.join(root, 'src/channel/channel.mjs').replaceAll('\\', '/')

console.log('# 1. settings.json に追加するフック設定（アカウントごと）')
console.log(JSON.stringify(buildHooksConfig(hookPath), null, 2))
console.log()
console.log('# 2. チャネルサーバーの登録（アカウントごと。CLAUDE_CONFIG_DIR を切り替えて実行）')
console.log(`claude mcp add --scope user coders-hub -- node "${channelPath}"`)
