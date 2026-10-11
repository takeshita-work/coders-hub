// セットアップに必要な設定の表示（scripts/print-setup.mjs と、配布版の `coders-hub.exe setup` が共通で使う）。
import { buildHooksConfig } from './hooks-config.mjs'
import { buildMcpConfig, CHANNEL_FLAG } from './mcp-config.mjs'

// paths: { hook, askHook, channel }（開発時。node で起動するファイル）。exePath: 配布版の exe の絶対パス（渡すと、exe を呼ぶ設定になる）
export const renderSetup = ({ paths = {}, exePath = null } = {}) => {
  const lines = []
  const json = (value) => JSON.stringify(value, null, 2)
  lines.push('# 1. settings.json に追加するフック設定（アカウントごと）')
  lines.push(json(buildHooksConfig(paths.hook ?? '', paths.askHook ?? '', { exePath })))
  lines.push('#    PermissionRequest の 2 つ目（matcher: AskUserQuestion）は、ダッシュボードから質問に答えるための同期フック（操作モードのセッションだけで働く）')
  lines.push('')
  lines.push('# 2. 一覧だけのモード: --mcp-config に渡す設定（例: coders-hub.json として保存）')
  lines.push(json(buildMcpConfig(paths.channel ?? '', { exePath })))
  lines.push('#    起動: claude --mcp-config coders-hub.json')
  lines.push('')
  lines.push('# 3. 操作モード（指示を送れる）: --mcp-config に渡す設定（例: coders-hub-control.json として保存）')
  lines.push(json(buildMcpConfig(paths.channel ?? '', { channel: true, exePath })))
  lines.push(`#    起動: claude --mcp-config coders-hub-control.json ${CHANNEL_FLAG}`)
  lines.push('#    開発用フラグを付け忘れると、サーバーは動くが、指示は黙って捨てられる（画面には「届いたか確認できません」と出る）')
  return lines.join('\n')
}
