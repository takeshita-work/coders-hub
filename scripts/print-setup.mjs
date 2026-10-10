// セットアップに必要な設定を、このリポジトリの場所に合わせて表示する。
//   node scripts/print-setup.mjs
// 表示された内容を、アカウントごと（CLAUDE_CONFIG_DIR）に反映する。手順は docs/setup.md。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHooksConfig } from '../src/setup/hooks-config.mjs'
import { buildMcpConfig, CHANNEL_FLAG } from '../src/setup/mcp-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hookPath = path.join(root, 'src/hook/hook.mjs')
const channelPath = path.join(root, 'src/channel/channel.mjs')

console.log('# 1. settings.json に追加するフック設定（アカウントごと）')
console.log(JSON.stringify(buildHooksConfig(hookPath), null, 2))
console.log()
console.log('# 2. 一覧だけのモード: --mcp-config に渡す設定（例: coders-hub.json として保存）')
console.log(JSON.stringify(buildMcpConfig(channelPath), null, 2))
console.log('#    起動: claude --mcp-config coders-hub.json')
console.log()
console.log('# 3. 操作モード（指示を送れる）: --mcp-config に渡す設定（例: coders-hub-control.json として保存）')
console.log(JSON.stringify(buildMcpConfig(channelPath, { channel: true }), null, 2))
console.log(`#    起動: claude --mcp-config coders-hub-control.json ${CHANNEL_FLAG}`)
console.log('#    開発用フラグを付け忘れると、サーバーは動くが、指示は黙って捨てられる（画面には「届いたか確認できません」と出る）')
