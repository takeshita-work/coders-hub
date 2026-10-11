// 配布版（coders-hub.exe）の入口。サブコマンドで、Hub・フック・チャネルサーバー・設定の出力を切り替える（ADR 0018）。
//   coders-hub.exe            Hub を起動する（hub と同じ。ダブルクリックを含む）
//   coders-hub.exe hub        Hub 本体
//   coders-hub.exe hook       フック（claude が起動する）
//   coders-hub.exe ask-hook   質問用の同期フック（claude が起動する）
//   coders-hub.exe channel [--channel]   チャネルサーバー（claude が起動する。--channel で操作モード）
//   coders-hub.exe setup      claude に入れる設定を表示する
//   coders-hub.exe version
// 開発時も `node src/cli/main.mjs <サブコマンド>` で同じ動作を確かめられる。
import path from 'node:path'
import { isSea } from 'node:sea'
import { fileURLToPath } from 'node:url'
import { runAskHook } from '../hook/ask-hook.mjs'
import { runChannel } from '../channel/channel.mjs'
import { runHook } from '../hook/hook.mjs'
import { runHub } from '../hub/main.mjs'
import { renderSetup } from '../setup/render.mjs'
import { isDirectRun } from '../shared/entry.mjs'
import { loadSeaAssets } from './sea-assets.mjs'
import { VERSION } from './version.mjs'

export const USAGE = `Coders Hub ${VERSION}

使い方: coders-hub <サブコマンド>
  hub                      Hub 本体を起動する（サブコマンドなしでも同じ）
  setup                    claude に入れる設定（フック・MCP）を表示する
  version                  バージョンを表示する
  hook / ask-hook          フック（claude が起動する）
  channel [--channel]      チャネルサーバー（claude が起動する。--channel で操作モード）
`

// 開発時（exe でないとき）の setup は、node で起動するファイルを指す設定を出す（scripts/print-setup.mjs と同じ）
const devPaths = () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  return { hook: path.join(root, 'src/hook/hook.mjs'), askHook: path.join(root, 'src/hook/ask-hook.mjs'), channel: path.join(root, 'src/channel/channel.mjs') }
}

// deps: テスト用の差し替え（out: 出力、exePath: 設定に書く exe のパス。exe でなければ null）
export const main = async (
  argv = process.argv.slice(2),
  { out = (t) => console.log(t), exePath = isSea() ? process.execPath : null, staticAssets = loadSeaAssets() } = {},
) => {
  const [command = 'hub', ...rest] = argv
  switch (command) {
    case 'hub': {
      const interactive = argv.length === 0
      return runHub({
        staticAssets,
        onListening: ({ uiPort }) => {
          if (interactive) out(`\nCoders Hub を起動しました。画面: http://127.0.0.1:${uiPort}/\n（このウィンドウを閉じると、Hub が止まります）`)
        },
      })
    }
    case 'hook': return runHook()
    case 'ask-hook': return runAskHook()
    case 'channel': return runChannel(rest)
    case 'setup': return out(exePath ? renderSetup({ exePath }) : renderSetup({ paths: devPaths() }))
    case 'version': case '--version': case '-v': return out(VERSION)
    case 'help': case '--help': case '-h': return out(USAGE)
    default:
      out(`不明なサブコマンドです: ${command}\n\n${USAGE}`)
      process.exitCode = 2
      return undefined
  }
}

if (isDirectRun(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
