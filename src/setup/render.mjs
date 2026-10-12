// セットアップに必要な設定の表示（scripts/print-setup.mjs と、配布版の `coders-hub.exe setup` が共通で使う）。
import fs from 'node:fs'
import path from 'node:path'
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

// ファイルに保存する設定（`setup --write`。ADR 0025）。内容は renderSetup と同じ。そのまま使える JSON だけを書く（コメントは付けない）
export const SETUP_FILES = {
  hooks: 'coders-hub-hooks.json',
  list: 'coders-hub.json',
  control: 'coders-hub-control.json',
}

export const buildSetupFiles = ({ paths = {}, exePath = null } = {}) => {
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  return [
    { key: 'hooks', name: SETUP_FILES.hooks, content: json(buildHooksConfig(paths.hook ?? '', paths.askHook ?? '', { exePath })) },
    { key: 'list', name: SETUP_FILES.list, content: json(buildMcpConfig(paths.channel ?? '', { exePath })) },
    { key: 'control', name: SETUP_FILES.control, content: json(buildMcpConfig(paths.channel ?? '', { channel: true, exePath })) },
  ]
}

// dir に書き出し、使い方の説明（表示用の行）を返す。同じ名前のファイルは上書きする（生成物なので）
export const writeSetupFiles = ({ dir, paths = {}, exePath = null, fsImpl = fs }) => {
  fsImpl.mkdirSync(dir, { recursive: true })
  const files = buildSetupFiles({ paths, exePath })
  const where = {}
  for (const file of files) {
    where[file.key] = path.join(dir, file.name)
    fsImpl.writeFileSync(where[file.key], file.content, 'utf8')
  }
  return [
    '次のファイルを保存しました。',
    '',
    `  ${where.hooks}`,
    '    使う claude の settings.json（アカウントごと）の "hooks" に、この内容を追加します。',
    `  ${where.list}`,
    `    一覧だけのモード: claude --mcp-config "${where.list}"`,
    `  ${where.control}`,
    `    操作モード:       claude --mcp-config "${where.control}" ${CHANNEL_FLAG}`,
    '',
    '※ 開発用フラグを付け忘れると、操作モードの指示は黙って捨てられます。',
  ]
}
