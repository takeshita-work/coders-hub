// セットアップの手順の表示（scripts/print-setup.mjs と、配布版の `coders-hub.exe setup` が共通で使う）。手順の中身は steps.mjs（ADR 0027）。
// 設定のファイル保存（`setup --write`）は、ADR 0028 でやめた。
import { buildSetupSteps, renderSteps } from './steps.mjs'

// paths: { hook, askHook, channel }（開発時。node で起動するファイル）。exePath: 配布版の exe の絶対パス（渡すと、exe を呼ぶ設定になる）
export const renderSetup = ({ paths = {}, exePath = null, uiPort, internalPort } = {}) => renderSteps(buildSetupSteps({ paths, exePath, uiPort, internalPort }))

// 手順を JSON にする（`setup --json`。案内のメニューが読む。ADR 0027）
export const renderSetupJson = ({ paths = {}, exePath = null, uiPort, internalPort } = {}) => JSON.stringify({ steps: buildSetupSteps({ paths, exePath, uiPort, internalPort }) })
