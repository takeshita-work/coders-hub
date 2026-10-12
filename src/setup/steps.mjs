// セットアップの手順（ADR 0026・0027）。文面の正は specs/30-features/007-distribution/setup-flow.md（tests/setup-flow.test.mjs が一致を確かめる）。
// `coders-hub.exe setup`（テキスト）・`setup --json`・案内のメニューが、同じデータを使う。
// 文面を直すときは、先に setup-flow.md を直し、ここを合わせる。1 つの手順は { id, title, body, copy? }
//  - body: 表示する行
//  - copy: コピーして使う内容（コマンド・JSON）。あれば、本文のあとに表示し、メニューの c でクリップボードへコピーできる
import { DEFAULT_INTERNAL_PORT, DEFAULT_UI_PORT } from '../shared/config.mjs'
import { buildHooksConfig } from './hooks-config.mjs'
import { buildMcpAddCommand, CHANNEL_FLAG, MCP_REMOVE_COMMAND } from './mcp-config.mjs'

// settings.json に貼る枠（{ "hooks": { イベントごとの 1 行 } }）。1 行が 1 イベントで、そのまま貼れる
const buildHooksFrame = (hooks) => {
  const events = Object.keys(hooks)
  const lines = events.map((event, index) => `    "${event}": ${JSON.stringify(hooks[event])}${index < events.length - 1 ? ',' : ''}`)
  return ['{', '  "hooks": {', ...lines, '  }', '}'].join('\n')
}

// paths: { hook, askHook, channel }（開発時。node で起動するファイル）。exePath: 配布版の exe の絶対パス（渡すと、exe を呼ぶ設定になる）
export const buildSetupSteps = ({ paths = {}, exePath = null, uiPort = DEFAULT_UI_PORT, internalPort = DEFAULT_INTERNAL_PORT } = {}) => {
  const hooksFrame = buildHooksFrame(buildHooksConfig(paths.hook ?? '', paths.askHook ?? '', { exePath }).hooks)
  return [
    {
      id: 'register',
      title: 'チャネルサーバーを登録する',
      body: [
        'アカウント（claude の設定フォルダ）ごとに、手順 1〜2 を行います。',
        '次のコマンドを、順に PowerShell で実行します。',
        '',
        '1. アカウントの指定: 既定のアカウントを使うときは、この手順をスキップします。別のアカウントを使うときは、そのアカウントでログインした設定フォルダを指定します（未ログインなら、指定後に claude を起動してログインします）。以降の手順も、同じ PowerShell で行います。',
        '',
        '   $env:CLAUDE_CONFIG_DIR = "$HOME\\.claude-account"',
        '',
        '2. 登録: claude に coders-hub を登録します。',
        '',
        `   ${buildMcpAddCommand(paths.channel ?? '', { exePath })}`,
        '',
        '3. 確認: 一覧に coders-hub が出れば、登録できています。',
        '',
        '   claude mcp list',
        '',
        'やり直すとき: 先に、次のコマンドで解除してから、登録します。',
        '',
        `   ${MCP_REMOVE_COMMAND}`,
        '',
        ...(exePath ? ['exe を移動・更新したら、登録し直します。'] : []),
      ],
    },
    {
      id: 'hooks',
      title: 'フックを追加する',
      body: [
        'フックは、claude の状態を Hub に知らせます。settings.json に追加します。',
        '次の枠は、c でコピーできます。自動では書き換わらないので、貼る前に、settings.json のバックアップを取ります。',
        '',
        '【settings.json の場所】',
        '  ・既定のアカウント: $HOME\\.claude\\settings.json',
        '  ・別のアカウント（手順 1 で指定した場合）: $env:CLAUDE_CONFIG_DIR\\settings.json',
        '  ・1 つのプロジェクトだけで試す: そのプロジェクトの .claude\\settings.local.json',
        '',
        '【ファイルがない】',
        '  ・次の枠を、そのまま settings.json として、新しく作ります（上の場所に保存）。',
        '',
        '【ファイルはあるが、"hooks" がない】',
        '  ・最上位の { } の中に、枠の "hooks": { ... } の部分（2 行目から、最後から 2 行目まで）を足します。前の項目の後ろに、カンマ（,）を付けます。',
        '',
        '【すでに "hooks" がある】',
        '  ・枠の中の、イベントごとの行を足します。',
        '    - そのイベントがまだない: 行ごと、"hooks" の { } の中に貼ります。',
        '    - すでにある: [ ] の中身（{ から } まで）だけを、既存の最後の項目の後ろに、カンマ付きで足します（行ごと貼ると、同じ名前が 2 つになります）。',
        '',
        '【貼ったあと】',
        '  ・JSON として正しいか（カンマ・括弧）を確かめます。',
        '  ・動いている claude は、起動し直します。',
      ],
      copy: hooksFrame,
    },
    {
      id: 'use',
      title: '起動して確認する',
      body: [
        '1. Hub を起動します（exe をダブルクリック。起動済みなら不要）。',
        '2. claude を起動します。指示の送信などの操作もするときは、次のコマンドで起動します（コマンドなしの起動は、一覧と状態の表示だけです）。',
        `3. http://127.0.0.1:${uiPort}/ を開き、セッションが一覧に出ることを確認します。`,
      ],
      copy: `claude ${CHANNEL_FLAG}`,
    },
  ]
}

// テキストにする（`coders-hub.exe setup`）
export const renderSteps = (steps) => {
  const lines = []
  steps.forEach((step, index) => {
    if (index > 0) lines.push('')
    lines.push(`# ${index + 1}. ${step.title}`, ...step.body)
    if (step.copy) lines.push('', step.copy)
  })
  return lines.join('\n')
}
