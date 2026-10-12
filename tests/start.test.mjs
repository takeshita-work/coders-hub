// Hub の起動の分離（機能 007、ADR 0020）: start・ログ・チャネルサーバーは Hub を起動しない・ウィンドウなしの exe
// AC-011-20〜23, 26
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../src/cli/main.mjs'
import { MAX_LOG_BYTES, hubLogPath, openHubLog, startHub, waitForHub } from '../src/cli/start.mjs'
import { guideText, showGuideWindow } from '../src/cli/guide.mjs'
import { SUBSYSTEM_CONSOLE, SUBSYSTEM_GUI, readSubsystem, setSubsystem } from '../scripts/pe-subsystem.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coders-hub-start-'))

describe('引数なし・start（AC-011-20, 28）', () => {
  const config = { host: '127.0.0.1', internalPort: 1, uiPort: 2 }
  const deps = (over = {}) => ({ exePath: null, staticAssets: null, waitReady: async () => true, ...over })

  it('AC-011-28: 引数なし（ダブルクリック）は、Hub を起動して、案内を出す', async () => {
    const shown = []
    await main([], deps({ start: async () => ({ started: true, config }), guide: (t) => shown.push(t) }))
    assert.equal(shown.length, 1)
    assert.match(shown[0], /Hub を起動しました/)
    assert.match(shown[0], /http:\/\/127\.0\.0\.1:2\//)
  })

  it('AC-011-20: start は、Hub を起動するだけで、案内を出さない（スタートアップ・タスク スケジューラ用）', async () => {
    let started = 0
    const shown = []
    await main(['start'], deps({ start: async () => { started += 1; return { started: true, config } }, guide: (t) => shown.push(t) }))
    assert.equal(started, 1)
    assert.equal(shown.length, 0)
  })

  it('AC-011-28: すでに動いているときは、起動の待ちをせず、その旨の案内を出す', async () => {
    const shown = []
    let waited = 0
    await main([], deps({ start: async () => ({ started: false, reason: 'running', config }), waitReady: async () => { waited += 1; return true }, guide: (t) => shown.push(t) }))
    assert.equal(waited, 0)
    assert.match(shown[0], /すでに起動しています/)
  })
})

describe('startHub', () => {
  const config = { host: '127.0.0.1', internalPort: 1 }
  const base = (over = {}) => ({
    env: {}, load: () => config, up: async () => false, openLog: () => 7, closeLog: () => {}, logFile: 'x', write: () => {}, ...over,
  })

  it('AC-011-20: 動いていなければ、ログの fd を出力先にして Hub を起動する', async () => {
    let call
    const r = await startHub(base({ spawnHub: (fn, env, opts) => { call = opts } }))
    assert.deepEqual(r, { started: true, config })
    assert.deepEqual(call.stdio, ['ignore', 7, 7])
  })

  it('AC-011-21: すでに動いていれば、何もしない', async () => {
    let spawned = 0
    const r = await startHub(base({ up: async () => true, spawnHub: () => { spawned += 1 } }))
    assert.deepEqual(r, { started: false, reason: 'running', config })
    assert.equal(spawned, 0)
  })

  it('AC-011-22: 設定ファイルの誤りなどで読めないときは、起動せず、理由をログに残す', async () => {
    const written = []
    let spawned = 0
    const r = await startHub(base({
      load: () => { throw new Error('設定ファイルが JSON として読めません') },
      spawnHub: () => { spawned += 1 },
      write: (fd, t) => written.push(t),
    }))
    assert.deepEqual(r, { started: false, reason: 'config', error: '設定ファイルが JSON として読めません' })
    assert.equal(spawned, 0)
    assert.match(written.join(''), /設定ファイルが JSON として読めません/)
  })

  it('起動に失敗しても、例外にせず、理由をログに残す。ログは必ず閉じる', async () => {
    const written = []
    let closed = null
    const r = await startHub(base({
      spawnHub: () => { throw new Error('EPERM') },
      write: (fd, t) => written.push(t),
      closeLog: (fd) => { closed = fd },
    }))
    assert.deepEqual(r, { started: false, reason: 'spawn', config, error: 'EPERM' })
    assert.match(written.join(''), /EPERM/)
    assert.equal(closed, 7)
  })

  it('ログを開けなくても（fd なし）、Hub は起動する', async () => {
    let call
    const r = await startHub(base({ openLog: () => null, spawnHub: (fn, env, opts) => { call = opts } }))
    assert.equal(r.started, true)
    assert.deepEqual(call.stdio, ['ignore', 'ignore', 'ignore'])
  })
})

describe('ログファイル（AC-011-22）', () => {
  it('%LOCALAPPDATA%\\coders-hub\\hub.log。LOCALAPPDATA がなければ null', () => {
    assert.match(hubLogPath({ LOCALAPPDATA: 'C:\\L' }), /coders-hub[\\/]hub\.log$/)
    assert.equal(hubLogPath({}), null)
  })

  it('フォルダを作り、追記で開く。上限を超えていたら作り直す', () => {
    const dir = tmp()
    try {
      const file = path.join(dir, 'sub', 'hub.log')
      let fd = openHubLog(file)
      fs.writeSync(fd, 'a'.repeat(100))
      fs.closeSync(fd)
      fd = openHubLog(file, { maxBytes: 1000 })
      fs.writeSync(fd, 'b')
      fs.closeSync(fd)
      assert.equal(fs.readFileSync(file, 'utf8'), 'a'.repeat(100) + 'b', '上限以下は追記')
      fd = openHubLog(file, { maxBytes: 50 })
      fs.writeSync(fd, 'c')
      fs.closeSync(fd)
      assert.equal(fs.readFileSync(file, 'utf8'), 'c', '上限超過は作り直し')
      assert.equal(MAX_LOG_BYTES, 1024 * 1024)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('開けないときは null（例外にしない）', () => {
    assert.equal(openHubLog(null), null)
    assert.equal(openHubLog('x', { fsImpl: { mkdirSync() { throw new Error('denied') } } }), null)
  })
})

describe('チャネルサーバーは Hub を起動しない（AC-011-23）', () => {
  const freePort = () => new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })

  it('Hub が止まっていても落ちず、Hub を起動せず、Hub が動き始めたら再接続して登録する', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, ['src/channel/channel.mjs'], {
      cwd: root,
      stdio: ['pipe', 'ignore', 'inherit'],
      env: { ...process.env, CODERS_HUB_INTERNAL_PORT: String(port), CLAUDE_CODE_SESSION_ID: 'n1', CLAUDE_CONFIG_DIR: 'C:\\x\\.claude-n' },
    })
    let exited = false
    child.on('exit', () => { exited = true })
    try {
      await sleep(3000)
      assert.equal(exited, false, '落ちない')
      // 以前は、ここで Hub が起動していた。起動していない = ポートが空いたまま
      const probe = net.createServer()
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
      probe.close()
      // 偽の Hub を立てると、再接続して /poll してくる
      const polls = []
      const fake = http.createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          if (req.url === '/poll') polls.push(JSON.parse(raw))
          setTimeout(() => { res.writeHead(204); res.end() }, 200)
        })
      })
      await new Promise((resolve) => fake.listen(port, '127.0.0.1', resolve))
      try {
        for (let i = 0; i < 80 && polls.length === 0; i += 1) await sleep(100)
        assert.equal(polls.length > 0, true, '再接続しない')
        assert.equal(polls[0].session, 'n1')
      } finally {
        fake.closeAllConnections()
        fake.close()
      }
    } finally {
      child.kill()
    }
  })
})

describe('ウィンドウなしの exe（AC-011-26）', () => {
  // 最小の PE ヘッダーを持つ合成データ
  const fakePe = (subsystem) => {
    const buf = Buffer.alloc(0x200)
    buf.write('MZ', 0, 'latin1')
    buf.writeUInt32LE(0x80, 0x3c)
    buf.write('PE\0\0', 0x80, 'latin1')
    buf.writeUInt16LE(subsystem, 0x80 + 24 + 68)
    return buf
  }

  it('コンソール(3) を GUI(2) に書き換える。ほかのバイトは変えない', () => {
    const src = fakePe(SUBSYSTEM_CONSOLE)
    const out = setSubsystem(Buffer.from(src), SUBSYSTEM_GUI)
    assert.equal(readSubsystem(out), SUBSYSTEM_GUI)
    const diff = [...out].map((b, i) => (b === src[i] ? -1 : i)).filter((i) => i >= 0)
    assert.deepEqual(diff, [0x80 + 24 + 68])
  })

  it('想定と違うサブシステム・PE でないデータは、エラー', () => {
    assert.throws(() => setSubsystem(fakePe(SUBSYSTEM_GUI), SUBSYSTEM_GUI), /想定/)
    assert.throws(() => setSubsystem(Buffer.alloc(100), SUBSYSTEM_GUI), /実行ファイルではありません/)
    const bad = fakePe(3)
    bad.write('XX', 0x80, 'latin1')
    assert.throws(() => setSubsystem(bad, SUBSYSTEM_GUI), /PE ヘッダー/)
  })
})

describe('waitForHub', () => {
  const noWait = async () => {}
  it('応答したら true。時間切れなら false', async () => {
    let n = 0
    assert.equal(await waitForHub({}, { up: async () => ++n > 3, wait: noWait }), true)
    assert.equal(await waitForHub({}, { up: async () => false, wait: noWait, timeoutMs: 500, intervalMs: 100 }), false)
  })
})

// AC-011-28（ADR 0024）: ダブルクリックしたときの案内
describe('案内（guideText）', () => {
  const config = { uiPort: 47766, internalPort: 47765 }
  const log = 'C:\L\hub.log'

  it('起動した: 画面の URL・終了の方法・ログ・Enter で閉じる旨を出す', () => {
    const t = guideText({ started: true, ready: true, config, logFile: log, version: '1.2.3' })
    assert.match(t, /Coders Hub 1\.2\.3/)
    assert.match(t, /Hub を起動しました。/)
    assert.match(t, /http:\/\/127\.0\.0\.1:47766\//)
    assert.match(t, /内部 API: http:\/\/127\.0\.0\.1:47765\/$/m)
    assert.doesNotMatch(t, /フック・チャネルサーバー用/)
    assert.match(t, /Hub を終了するには、アプリにアクセスし終了してください/)
    assert.match(t, /閉じても、Hub は動き続けます/)
    assert.match(t, /ログ: C:\L\hub\.log/)
    assert.match(t, /Enter キーを押すと、このウィンドウを閉じます/)
  })

  it('すでに起動している・応答が遅い', () => {
    assert.match(guideText({ started: false, reason: 'running', config }), /すでに起動しています/)
    assert.match(guideText({ started: true, ready: false, config, logFile: log }), /まだ応答がありません/)
  })

  it('設定ファイルの誤り: 理由とログを出し、URL と終了の説明は出さない', () => {
    const t = guideText({ started: false, reason: 'config', error: '設定ファイルが JSON として読めません: C:\A\config.json', logFile: log })
    assert.match(t, /起動できませんでした/)
    assert.match(t, /config\.json/)
    assert.doesNotMatch(t, /http:\/\//)
    assert.doesNotMatch(t, /Hub を終了するには/)
    assert.match(t, /ログ:/)
  })
})

describe('案内のウィンドウ（showGuideWindow）', () => {
  // 偽の子プロセス: イベントを登録すると、すぐに知らせる（cmd /c start は、案内を開いたらすぐ終了する）
  const fakeChild = (events = {}) => ({ unref() {}, on(name, fn) { if (events[name] !== undefined) setImmediate(() => fn(events[name])) } })

  it('AC-011-28: 本文を UTF-8 のファイルに書き、バッチを cmd の start で開く。バッチは Enter（set /p）を待って閉じる', async () => {
    const dir = tmp()
    try {
      let call
      const ok = await showGuideWindow('本文\n二行目', { dir, spawnFn: (cmd, args, opts) => { call = { cmd, args, opts }; return fakeChild({ exit: 0 }) } })
      assert.equal(ok, true)
      assert.equal(call.cmd, 'cmd.exe')
      assert.deepEqual(call.args.slice(0, 3), ['/c', 'start', 'Coders Hub'])
      assert.equal(call.args[3], path.join(dir, 'guide.cmd'))
      assert.equal(call.opts.windowsHide, true, 'cmd 自体は隠す')
      assert.equal(fs.readFileSync(path.join(dir, 'guide.txt'), 'utf8'), '本文\r\n二行目')
      const bat = fs.readFileSync(path.join(dir, 'guide.cmd'), 'utf8').split('\r\n')
      const show = bat.find((l) => l.includes('powershell.exe'))
      assert.ok(show, '本文は PowerShell で表示する（cmd の type は、chcp 65001 で末尾の文字が化けるため使わない）')
      assert.ok(!bat.some((l) => /^type /.test(l) || /chcp/.test(l)), 'type・chcp は使わない')
      assert.match(show, /Get-Content -LiteralPath '%~dp0guide\.txt' -Encoding UTF8/)
      assert.match(show, /Read-Host/, 'Enter を待つ')
      assert.ok(!/-EncodedCommand|-enc /i.test(show), 'エンコードしたコマンドは使わない（誤検知を避ける）')
      assert.equal(bat.filter(Boolean).at(-1), 'exit', 'Enter のあと、ウィンドウを閉じる')
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
      const p = showGuideWindow('x', { dir, spawnFn: () => child }).then((v) => { resolved = true; return v })
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
      assert.equal(await showGuideWindow('x', { dir, spawnFn: () => fakeChild({ error: new Error('ENOENT') }) }), false)
      assert.equal(await showGuideWindow('x', { dir, timeoutMs: 20, spawnFn: () => ({ unref() {}, on() {} }) }), true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('置き場所がない・書けないときは false（例外にしない）', async () => {
    assert.equal(await showGuideWindow('x', { dir: null }), false)
    assert.equal(await showGuideWindow('x', { dir: 'd', fsImpl: { mkdirSync() { throw new Error('denied') } } }), false)
  })
})
