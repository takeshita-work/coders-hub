// `coders-hub.exe` をダブルクリックしたとき（引数なし）に出す案内とメニュー（ADR 0024・0025）。
// Hub は、ウィンドウなしで動き続ける。案内のウィンドウは、URL・終了の方法・ログの場所を示し、メニューから
// 「claude に入れる設定の表示」「設定のファイル保存」「ログを開く」を選べる。何も入力せずに Enter で閉じる（閉じても Hub は止まらない）。
// 配布版の exe はウィンドウのない形式（ADR 0020）で、自分では対話できないので、案内とメニューは、別のコンソールのウィンドウ
// （cmd → PowerShell）で出す。
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
// menu: 配布版（ダブルクリック）のとき { saveDir }。メニューと、閉じ方の説明を足す。なければ（開発時のターミナル）足さない
export const guideText = ({ started, reason, ready, config, error, logFile, version = VERSION, menu = null }) => {
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
  if (menu) {
    lines.push(
      '',
      '  1  claude に入れる設定を表示する（フック・MCP）',
      `  2  設定をファイルに保存する（${menu.saveDir}）`,
      '  3  ログを開く',
      '',
      '番号を入力して Enter を押してください。何も入力せずに Enter を押すと、このウィンドウを閉じます。',
    )
  }
  return lines.join('\r\n')
}

// PowerShell の文字列リテラル（単一引用符）にする
const psq = (s) => `'${String(s).replaceAll("'", "''")}'`

// メニューの PowerShell スクリプト。本文は guide.txt を毎回表示する。選択に応じて、exe の setup を呼ぶ。
// 日本語を含むので、UTF-8（BOM つき）で保存する（Windows PowerShell 5.1 は、BOM がないと ANSI として読む）。
// exe のパスとログのパスは、ここで埋め込む。exe の出力は UTF-8 なので、コンソールの出力エンコーディングを UTF-8 にして受ける
export const guideScript = ({ exePath, logFile }) => [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$Host.UI.RawUI.WindowTitle = 'Coders Hub'",
  `$exe = ${psq(exePath)}`,
  `$log = ${psq(logFile ?? '')}`,
  "$text = Join-Path $PSScriptRoot 'guide.txt'",
  'while ($true) {',
  '  Clear-Host',
  '  Get-Content -LiteralPath $text -Encoding UTF8',
  '  $choice = (Read-Host).Trim()',
  "  if ($choice -eq '') { break }",
  '  switch ($choice) {',
  "    '1' { Write-Host ''; & $exe setup | Out-Host; Write-Host ''; $null = Read-Host 'Enter キーを押すと、メニューに戻ります' }",
  "    '2' { Write-Host ''; & $exe setup --write | Out-Host; Write-Host ''; $null = Read-Host 'Enter キーを押すと、メニューに戻ります' }",
  "    '3' {",
  '      if ($log -and (Test-Path -LiteralPath $log)) { Start-Process notepad.exe -ArgumentList (\'"\' + $log + \'"\') }',
  "      else { Write-Host ''; Write-Host 'ログはまだありません。'; $null = Read-Host 'Enter キーを押すと、メニューに戻ります' }",
  '    }',
  '  }',
  '}',
  '',
].join('\r\n')

// バッチ: PowerShell のメニューを動かす。cmd の type は、chcp 65001 だと、末尾の日本語の 1 文字が文字化けしたため使わない
// （PowerShell は、コンソールに UTF-16 で書くので、コードページに依存しない）。-EncodedCommand は使わない（誤検知を避ける）
const BATCH = [
  '@echo off',
  'title Coders Hub',
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0guide.ps1"',
  'exit',
  '',
]

const BOM = '﻿'

// 案内を、新しいコンソールのウィンドウで表示する。本文は guide.txt、メニューは guide.ps1（UTF-8）に書き、バッチが動かす
// （本文を cmd の引数に載せると、& や % のエスケープが要るため）。ファイルは固定の名前で上書きする（増えない）。
// 配布版の exe はウィンドウのない形式なので、cmd が `start` で案内を開き終える（cmd が終了する）まで待ってから返す。
// 待たずに親（exe）が終了すると、案内のウィンドウも消えてしまう（実機で確認）。
// script: メニューの PowerShell スクリプト（guideScript の戻り値）。戻り値: Promise<boolean> 表示を始められたら true
export const showGuideWindow = (text, { dir, script, spawnFn = spawn, fsImpl = fs, timeoutMs = 5000 } = {}) => {
  if (!dir) return Promise.resolve(false)
  try {
    fsImpl.mkdirSync(dir, { recursive: true })
    const batFile = path.join(dir, 'guide.cmd')
    fsImpl.writeFileSync(path.join(dir, 'guide.txt'), text.replace(/\r?\n/g, '\r\n'), 'utf8')
    fsImpl.writeFileSync(path.join(dir, 'guide.ps1'), BOM + script, 'utf8')
    fsImpl.writeFileSync(batFile, BATCH.join('\r\n'))
    return new Promise((resolve) => {
      // start: 新しいコンソールのウィンドウで開く。cmd 自体は隠す
      const child = spawnFn('cmd.exe', ['/c', 'start', 'Coders Hub', batFile], { windowsHide: true, stdio: 'ignore' })
      // 時間切れ（cmd が終了しないとき）。unref しない: 待っている間に、イベントループが終わってしまうと、待ちが解けない
      const timer = setTimeout(() => resolve(true), timeoutMs)
      child.on?.('error', () => { clearTimeout(timer); resolve(false) })
      child.on?.('exit', () => { clearTimeout(timer); resolve(true) })
      if (!child.on) { clearTimeout(timer); resolve(true) }
    })
  } catch {
    return Promise.resolve(false)
  }
}
