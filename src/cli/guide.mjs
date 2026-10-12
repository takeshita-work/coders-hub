// `coders-hub.exe` をダブルクリックしたとき（引数なし）に出す案内（ADR 0024）。
// Hub は、ウィンドウなしで動き続ける。案内のウィンドウは、URL・終了の方法・ログの場所を示し、Enter で閉じる（閉じても Hub は止まらない）。
// 配布版の exe はウィンドウのない形式（ADR 0020）なので、案内は、別のコンソールのウィンドウ（cmd）で出す。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { VERSION } from './version.mjs'

const STATUS = {
  started: 'Hub を起動しました。',
  slow: 'Hub を起動しましたが、まだ応答がありません。数秒待っても画面が開かないときは、下のログを確認してください。',
  running: 'Hub はすでに起動しています。',
  config: '設定ファイル（config.json）を読めないため、Hub を起動できませんでした。',
  spawn: 'Hub を起動できませんでした。',
}

// status: { started, reason?, ready?, config?, error? }（start.mjs の戻り値に、ready を足したもの）
export const guideText = ({ started, reason, ready, config, error, logFile, version = VERSION }) => {
  const key = started ? (ready === false ? 'slow' : 'started') : reason
  const lines = [`Coders Hub ${version}`, '', STATUS[key] ?? STATUS.spawn]
  if (error) lines.push(error)
  if (config && key !== 'config' && key !== 'spawn') {
    lines.push('', `画面:     http://127.0.0.1:${config.uiPort}/`, `内部 API: http://127.0.0.1:${config.internalPort}/`)
  }
  lines.push('')
  if (key === 'started' || key === 'running' || key === 'slow') {
    lines.push(
      '・このウィンドウを閉じても、Hub は動き続けます。',
      '・Hub を終了するには、アプリにアクセスし終了してください',
    )
  }
  if (logFile) lines.push(`・ログ: ${logFile}`)
  lines.push('', 'Enter キーを押すと、このウィンドウを閉じます。')
  return lines.join('\r\n')
}

// バッチ: PowerShell で本文を表示し、Enter を待つ。cmd の type は、chcp 65001 だと、末尾の日本語の 1 文字が文字化けしたため使わない
// （PowerShell は、コンソールに UTF-16 で書くので、コードページに依存しない）。コマンドは固定の文字列で、-EncodedCommand は使わない
const BATCH = [
  '@echo off',
  'title Coders Hub',
  'powershell.exe -NoProfile -Command "Get-Content -LiteralPath \'%~dp0guide.txt\' -Encoding UTF8; $null = Read-Host"',
  'exit',
  '',
]

// 案内を、新しいコンソールのウィンドウで表示する。本文は UTF-8 のファイルに書き、バッチファイルが表示する
// （本文を cmd の引数に載せると、& や % のエスケープが要るため）。ファイルは固定の名前で上書きする（増えない）。
// 配布版の exe はウィンドウのない形式なので、cmd が `start` で案内を開き終える（cmd が終了する）まで待ってから返す。
// 待たずに親（exe）が終了すると、案内のウィンドウも消えてしまう（実機で確認）。
// 戻り値: Promise<boolean> 表示を始められたら true
export const showGuideWindow = (text, { dir, spawnFn = spawn, fsImpl = fs, timeoutMs = 5000 } = {}) => {
  if (!dir) return Promise.resolve(false)
  try {
    fsImpl.mkdirSync(dir, { recursive: true })
    const textFile = path.join(dir, 'guide.txt')
    const batFile = path.join(dir, 'guide.cmd')
    fsImpl.writeFileSync(textFile, text.replace(/\r?\n/g, '\r\n'), 'utf8')
    fsImpl.writeFileSync(batFile, BATCH.join('\r\n'))
    return new Promise((resolve) => {
      // start: 新しいコンソールのウィンドウで開く。cmd 自体は隠す
      const child = spawnFn('cmd.exe', ['/c', 'start', 'Coders Hub', batFile], { windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => resolve(true), timeoutMs)
      timer.unref?.()
      child.on?.('error', () => { clearTimeout(timer); resolve(false) })
      child.on?.('exit', () => { clearTimeout(timer); resolve(true) })
      if (!child.on) { clearTimeout(timer); resolve(true) }
    })
  } catch {
    return Promise.resolve(false)
  }
}
