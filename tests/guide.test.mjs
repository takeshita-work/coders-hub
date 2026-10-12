// ダブルクリックしたときの案内とメニュー（機能 007、ADR 0024・0025）。AC-011-20, 28〜30
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guideScript, guideText, showGuideWindow } from '../src/cli/guide.mjs'
import { main } from '../src/cli/main.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-guide-'))

describe('引数なし・start（AC-011-20, 28）', () => {
  const config = { host: '127.0.0.1', internalPort: 1, uiPort: 2 }
  const deps = (over = {}) => ({ exePath: null, staticAssets: null, waitReady: async () => true, ...over })

  it('AC-011-28: 引数なし（ダブルクリック）は、Hub を起動して、結果を案内に渡す', async () => {
    const shown = []
    await main([], deps({ start: async () => ({ started: true, config }), guide: (result, ready) => shown.push({ result, ready }) }))
    assert.equal(shown.length, 1)
    assert.equal(shown[0].result.started, true)
    assert.equal(shown[0].ready, true, '起動した Hub の応答を待った結果')
  })

  it('AC-011-20: start は、Hub を起動するだけで、案内を出さない（スタートアップ・タスク スケジューラ用）', async () => {
    let started = 0
    const shown = []
    await main(['start'], deps({ start: async () => { started += 1; return { started: true, config } }, guide: () => shown.push(1) }))
    assert.equal(started, 1)
    assert.equal(shown.length, 0)
  })

  it('AC-011-28: すでに動いているときは、起動の待ちをせず、案内に渡す', async () => {
    const shown = []
    let waited = 0
    await main([], deps({
      start: async () => ({ started: false, reason: 'running', config }),
      waitReady: async () => { waited += 1; return true },
      guide: (result, ready) => shown.push({ result, ready }),
    }))
    assert.equal(waited, 0)
    assert.equal(shown[0].result.reason, 'running')
    assert.equal(shown[0].ready, undefined)
  })
})

describe('案内の本文（guideText）', () => {
  const config = { uiPort: 47766, internalPort: 47765 }
  const log = 'C:\\L\\hub.log'

  it('起動した: 画面の URL・終了の方法・ログを出す。メニューがなければ、メニューの説明は出さない（開発時のターミナル）', () => {
    const t = guideText({ started: true, ready: true, config, logFile: log, version: '1.2.3' })
    assert.match(t, /Coders Hub 1\.2\.3/)
    assert.match(t, /Hub を起動しました。/)
    assert.match(t, /http:\/\/127\.0\.0\.1:47766\//)
    assert.match(t, /内部 API: http:\/\/127\.0\.0\.1:47765\/$/m)
    assert.doesNotMatch(t, /フック・チャネルサーバー用/)
    assert.match(t, /Hub を終了するには、アプリにアクセスし終了してください/)
    assert.match(t, /閉じても、Hub は動き続けます/)
    assert.ok(t.includes(`ログ: ${log}`))
    assert.doesNotMatch(t, /番号を入力/)
  })

  it('AC-011-29: メニューつき: 3 つの項目と、Enter だけで閉じる旨を出す', () => {
    const t = guideText({ started: true, ready: true, config, logFile: log, menu: { saveDir: 'C:\\Apps' } })
    assert.match(t, /^ {2}1 {2}claude に入れる設定を表示する/m)
    assert.match(t, /^ {2}2 {2}設定をファイルに保存する（C:\\Apps）/m)
    assert.match(t, /^ {2}3 {2}ログを開く/m)
    assert.match(t, /何も入力せずに Enter を押すと、このウィンドウを閉じます/)
  })

  it('すでに起動している・応答が遅い', () => {
    assert.match(guideText({ started: false, reason: 'running', config }), /すでに起動しています/)
    assert.match(guideText({ started: true, ready: false, config, logFile: log }), /まだ応答がありません/)
  })

  it('設定ファイルの誤り: 理由とログを出し、URL と終了の説明は出さない', () => {
    const t = guideText({ started: false, reason: 'config', error: '設定ファイルが JSON として読めません: C:\\A\\config.json', logFile: log })
    assert.match(t, /起動できませんでした/)
    assert.match(t, /config\.json/)
    assert.doesNotMatch(t, /http:\/\//)
    assert.doesNotMatch(t, /Hub を終了するには/)
    assert.match(t, /ログ:/)
  })
})

describe('メニューのスクリプト（guideScript。AC-011-29）', () => {
  const script = guideScript({ exePath: "C:\\Apps\\Coders Hub's\\coders-hub.exe", logFile: 'C:\\L\\hub.log' })

  it('exe のパスとログのパスを、単一引用符の文字列として埋め込む（引用符は二重にする）', () => {
    assert.ok(script.includes("$exe = 'C:\\Apps\\Coders Hub''s\\coders-hub.exe'"))
    assert.ok(script.includes("$log = 'C:\\L\\hub.log'"))
  })

  it('1: setup を表示、2: setup --write、3: ログをメモ帳で開く。空の入力で抜ける', () => {
    assert.match(script, /'1' \{[^}]*& \$exe setup \| Out-Host;/)
    assert.match(script, /'2' \{[^}]*& \$exe setup --write \| Out-Host/)
    assert.match(script, /'3' \{[\s\S]*Start-Process notepad\.exe/)
    assert.match(script, /if \(\$choice -eq ''\) \{ break \}/)
  })

  it('UTF-8 で受ける。毎回 guide.txt を表示する。EncodedCommand は使わない', () => {
    assert.match(script, /\[Console\]::OutputEncoding = \[Text\.Encoding\]::UTF8/)
    assert.match(script, /Get-Content -LiteralPath \$text -Encoding UTF8/)
    assert.ok(!/EncodedCommand/i.test(script))
  })
})

describe('案内のウィンドウ（showGuideWindow）', () => {
  // 偽の子プロセス: イベントを登録すると、すぐに知らせる（cmd /c start は、案内を開いたらすぐ終了する）
  const fakeChild = (events = {}) => ({ unref() {}, on(name, fn) { if (events[name] !== undefined) setImmediate(() => fn(events[name])) } })

  it('AC-011-28: 本文とスクリプトを UTF-8 のファイルに書き、バッチを cmd の start で開く', async () => {
    const dir = tmp()
    try {
      let call
      const ok = await showGuideWindow('本文\n二行目', { dir, script: '# メニュー', spawnFn: (cmd, args, opts) => { call = { cmd, args, opts }; return fakeChild({ exit: 0 }) } })
      assert.equal(ok, true)
      assert.equal(call.cmd, 'cmd.exe')
      assert.deepEqual(call.args.slice(0, 3), ['/c', 'start', 'Coders Hub'])
      assert.equal(call.args[3], path.join(dir, 'guide.cmd'))
      assert.equal(call.opts.windowsHide, true, 'cmd 自体は隠す')
      assert.equal(fs.readFileSync(path.join(dir, 'guide.txt'), 'utf8'), '本文\r\n二行目')
      // PowerShell 5.1 は、BOM がないスクリプトを ANSI として読み、日本語が化ける
      const ps1 = fs.readFileSync(path.join(dir, 'guide.ps1'))
      assert.deepEqual([...ps1.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 の BOM つき')
      assert.equal(ps1.toString('utf8').slice(1), '# メニュー')
      const bat = fs.readFileSync(path.join(dir, 'guide.cmd'), 'utf8').split('\r\n')
      const run = bat.find((l) => l.includes('powershell.exe'))
      assert.match(run, /-NoProfile -ExecutionPolicy Bypass -File "%~dp0guide\.ps1"/)
      assert.ok(!/-EncodedCommand|-enc /i.test(run), 'エンコードしたコマンドは使わない（誤検知を避ける）')
      assert.ok(!bat.some((l) => /^type /.test(l) || /chcp/.test(l)), 'type・chcp は使わない（末尾の文字が化けるため）')
      assert.equal(bat.filter(Boolean).at(-1), 'exit', 'メニューを抜けたあと、ウィンドウを閉じる')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('AC-011-28: cmd が案内を開き終える（終了する）まで待ってから返す。待たずに exe が終了すると、案内も消える', async () => {
    const dir = tmp()
    try {
      let exitHandler = null
      let resolved = false
      const child = { unref() {}, on(name, fn) { if (name === 'exit') exitHandler = fn } }
      const p = showGuideWindow('x', { dir, script: 's', spawnFn: () => child }).then((v) => { resolved = true; return v })
      await new Promise((r) => setTimeout(r, 30))
      assert.equal(resolved, false, 'cmd がまだ動いている間は待つ')
      exitHandler(0)
      assert.equal(await p, true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cmd を起動できない（error）ときは false。応答がなくても、時間切れで返す', async () => {
    const dir = tmp()
    try {
      assert.equal(await showGuideWindow('x', { dir, script: 's', spawnFn: () => fakeChild({ error: new Error('ENOENT') }) }), false)
      assert.equal(await showGuideWindow('x', { dir, script: 's', timeoutMs: 20, spawnFn: () => ({ unref() {}, on() {} }) }), true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('置き場所がない・書けないときは false（例外にしない）', async () => {
    assert.equal(await showGuideWindow('x', { dir: null, script: 's' }), false)
    assert.equal(await showGuideWindow('x', { dir: 'd', script: 's', fsImpl: { mkdirSync() { throw new Error('denied') } } }), false)
  })
})
