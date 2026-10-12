// 配布版（coders-hub.exe）の入口。サブコマンドで、Hub・フック・チャネルサーバー・設定の出力を切り替える（ADR 0018）。
//   coders-hub.exe            Hub をウィンドウなしで起動し、案内のウィンドウ（URL・終了の方法）を出す。Enter で閉じる（ダブルクリック。ADR 0024）
//   coders-hub.exe start      Hub をウィンドウなしで起動して終了する（案内なし。スタートアップ・タスク スケジューラ用。ADR 0020）
//   coders-hub.exe hub        Hub 本体を前面で動かす（確認・不具合調査用）
//   coders-hub.exe hook       フック（claude が起動する）
//   coders-hub.exe ask-hook   質問用の同期フック（claude が起動する）
//   coders-hub.exe channel [--channel]   チャネルサーバー（claude が起動する。--channel で操作モード）
//   coders-hub.exe setup [--json]   セットアップの手順を表示する（--json: メニュー用の JSON）
//   coders-hub.exe version
// 開発時も `node src/cli/main.mjs <サブコマンド>` で同じ動作を確かめられる。
import path from 'node:path'
import { isSea } from 'node:sea'
import { fileURLToPath } from 'node:url'
import { runAskHook } from '../hook/ask-hook.mjs'
import { runChannel } from '../channel/channel.mjs'
import { runHook } from '../hook/hook.mjs'
import { runHub } from '../hub/main.mjs'
import { renderSetup, renderSetupJson } from '../setup/render.mjs'
import { isDirectRun } from '../shared/entry.mjs'
import { loadSeaAssets } from './sea-assets.mjs'
import { guideScript, guideText, showGuideWindow } from './guide.mjs'
import { hubLogPath, startHub, waitForHub } from './start.mjs'
import { VERSION } from './version.mjs'

export const USAGE = `Coders Hub ${VERSION}

使い方: coders-hub <サブコマンド>
  （サブコマンドなし）     Hub をウィンドウなしで起動し、案内のウィンドウを出す（ダブルクリック）
  start                    Hub をウィンドウなしで起動する（案内なし。スタートアップ用）
  hub                      Hub 本体を前面で動かす（確認・不具合調査用）
  setup                    セットアップの手順（claude mcp add・フック）を表示する
  setup --json             手順を JSON で表示する（案内のメニュー用）
  version                  バージョンを表示する
  hook / ask-hook          フック（claude が起動する）
  channel [--channel]      チャネルサーバー（claude が起動する。--channel で操作モード）
`

// 開発時（exe でないとき）の setup は、node で起動するファイルを指す設定を出す（scripts/print-setup.mjs と同じ）
const devPaths = () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  return { hook: path.join(root, 'src/hook/hook.mjs'), askHook: path.join(root, 'src/hook/ask-hook.mjs'), channel: path.join(root, 'src/channel/channel.mjs') }
}

// 案内のファイルの置き場所（ログと同じフォルダ）
const logDir = () => (hubLogPath() ? path.dirname(hubLogPath()) : null)

// deps: テスト用の差し替え（out: 出力、exePath: 設定に書く exe のパス。exe でなければ null）
export const main = async (
  argv = process.argv.slice(2),
  {
    out = (t) => console.log(t),
    exePath = isSea() ? process.execPath : null,
    staticAssets = loadSeaAssets(),
    start = startHub,
    waitReady = waitForHub,
    // 案内の表示。配布版（ダブルクリック）は、メニューつきで、別のコンソールのウィンドウに出す（ADR 0025）。開発時（node）は、そのターミナルに案内だけを出す
    guide = (result, ready) => {
      const logFile = hubLogPath()
      if (!isSea()) return out(guideText({ ...result, ready, logFile }))
      const text = guideText({ ...result, ready, logFile, menu: true })
      return showGuideWindow(text, { dir: logDir(), script: guideScript({ exePath: process.execPath, logFile }) })
    },
  } = {},
) => {
  const [command, ...rest] = argv
  switch (command) {
    case undefined: {
      const result = await start()
      const ready = result.started ? await waitReady(result.config) : undefined
      return guide(result, ready)
    }
    case 'start': return start()
    case 'hub': return runHub({ staticAssets })
    case 'hook': return runHook()
    case 'ask-hook': return runAskHook()
    case 'channel': return runChannel(rest)
    case 'setup': {
      if (rest.includes('--json')) return out(renderSetupJson(exePath ? { exePath } : { paths: devPaths() }))
      return out(exePath ? renderSetup({ exePath }) : renderSetup({ paths: devPaths() }))
    }
    case 'version': case '--version': case '-v': return out(VERSION)
    case 'help': case '--help': case '-h': return out(USAGE)
    default:
      out(`不明なサブコマンドです: ${command}\n\n${USAGE}`)
      process.exitCode = 2
      return undefined
  }
}

if (isDirectRun(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1) })
