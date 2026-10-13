// 通知（音と点滅）。機能 008、ADR 0030。AC-NT-1〜14
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_EVERY_MS, ALERT_MAX_MS, DEFAULT_SETTINGS, DURATIONS, TONES, alertMs, createFlasher, createNotifier, createWebAudioPlayer, detectAlert,
  detectMarks, normalizeSettings,
} from '../src/web/notify.mjs'

const sessions = (...pairs) => new Map(pairs.map(([id, state]) => [id, { sessionId: id, state }]))

describe('設定（AC-NT-10）', () => {
  it('既定: ミュートなし・音量 60・点滅 ON・15 秒', () => {
    assert.deepEqual(DEFAULT_SETTINGS, { mute: false, volume: 60, blink: true, alertSec: 15 })
    assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
    assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
  })

  it('保存された値は、そのまま使う。音量は 0〜100 に収め、整数にする', () => {
    assert.deepEqual(normalizeSettings({ mute: true, volume: 30, blink: false, alertSec: 60 }), { mute: true, volume: 30, blink: false, alertSec: 60 })
    assert.equal(normalizeSettings({ volume: 150 }).volume, 100)
    assert.equal(normalizeSettings({ volume: -5 }).volume, 0)
    assert.equal(normalizeSettings({ volume: 33.6 }).volume, 34)
  })

  it('壊れた値は、既定に戻す（型が違う・選択肢にない時間・配列など）', () => {
    assert.deepEqual(normalizeSettings({ mute: 'yes', volume: 'loud', blink: 1, alertSec: 7 }), DEFAULT_SETTINGS)
    assert.deepEqual(normalizeSettings([1, 2]), DEFAULT_SETTINGS)
    assert.deepEqual(normalizeSettings('x'), DEFAULT_SETTINGS)
    assert.equal(normalizeSettings({ volume: NaN }).volume, DEFAULT_SETTINGS.volume)
  })

  it('続ける時間の選択肢: 5 秒・15 秒・30 秒・1 分・操作するまで（0）。0 は、最大 10 分', () => {
    assert.deepEqual(DURATIONS.map((d) => d.sec), [5, 15, 30, 60, 0])
    assert.deepEqual(DURATIONS.map((d) => d.label), ['5 秒', '15 秒', '30 秒', '1 分', '操作するまで'])
    assert.equal(alertMs({ alertSec: 5 }), 5000)
    assert.equal(alertMs({ alertSec: 0 }), ALERT_MAX_MS)
    assert.equal(ALERT_MAX_MS, 10 * 60 * 1000)
  })
})

describe('出来事の検出（AC-NT-1〜4）', () => {
  it('AC-NT-1: 作業中から返答待ちになると、完了', () => {
    assert.equal(detectAlert(sessions(['a', 'working']), sessions(['a', 'waiting'])), 'complete')
  })

  it('AC-NT-2: 許可待ち・質問待ちになると、許可・質問', () => {
    assert.equal(detectAlert(sessions(['a', 'working']), sessions(['a', 'permission'])), 'permission')
    assert.equal(detectAlert(sessions(['a', 'waiting']), sessions(['a', 'question'])), 'question')
  })

  it('AC-NT-3: 最初のスナップショット（前の一覧がない）・新しいセッション・状態が変わらないときは、知らせない', () => {
    assert.equal(detectAlert(null, sessions(['a', 'permission'])), null, '最初のスナップショット')
    assert.equal(detectAlert(sessions(['a', 'working']), sessions(['a', 'working'], ['b', 'permission'])), null, '新しいセッション')
    assert.equal(detectAlert(sessions(['a', 'permission']), sessions(['a', 'permission'])), null, '状態が変わらない（再接続など）')
  })

  it('完了ではないもの: 作業中になる・許可待ち（質問待ち）から作業中へ・返答待ちから返答待ち・ほかの状態から返答待ち', () => {
    assert.equal(detectAlert(sessions(['a', 'waiting']), sessions(['a', 'working'])), null)
    assert.equal(detectAlert(sessions(['a', 'permission']), sessions(['a', 'working'])), null, '許可して、作業中に戻っただけ')
    assert.equal(detectAlert(sessions(['a', 'permission']), sessions(['a', 'waiting'])), null, '拒否して、返答待ちに戻っただけ（作業の完了ではない）')
    assert.equal(detectAlert(sessions(['a', 'question']), sessions(['a', 'waiting'])), null)
  })

  it('AC-NT-4: 複数あれば、許可 > 質問 > 完了 の順に、1 つだけ', () => {
    const prev = sessions(['a', 'working'], ['b', 'working'], ['c', 'working'])
    assert.equal(detectAlert(prev, sessions(['a', 'waiting'], ['b', 'question'], ['c', 'permission'])), 'permission')
    assert.equal(detectAlert(prev, sessions(['a', 'waiting'], ['b', 'question'], ['c', 'working'])), 'question')
    assert.equal(detectAlert(prev, sessions(['a', 'waiting'], ['b', 'working'], ['c', 'working'])), 'complete')
  })

  it('消えたセッション（終了）は、見ない', () => {
    assert.equal(detectAlert(sessions(['a', 'working'], ['b', 'working']), sessions(['b', 'working'])), null)
  })
})

describe('サイドバーの目印の検出（AC-NT-12）: detectMarks は、起きたセッションぶんすべて返す', () => {
  it('前の一覧がない（最初のスナップショット）ときは、空', () => {
    assert.deepEqual(detectMarks(null, sessions(['a', 'permission'])), new Map())
  })

  it('1 件なら、detectAlert と同じ種類が、その sessionId に入る', () => {
    const marks = detectMarks(sessions(['a', 'working']), sessions(['a', 'waiting']))
    assert.deepEqual(marks, new Map([['a', 'complete']]))
  })

  it('複数あれば、detectAlert が 1 つに絞るのに対し、全部返す', () => {
    const prev = sessions(['a', 'working'], ['b', 'working'], ['c', 'working'])
    const next = sessions(['a', 'waiting'], ['b', 'question'], ['c', 'permission'])
    assert.deepEqual(detectMarks(prev, next), new Map([['a', 'complete'], ['b', 'question'], ['c', 'permission']]))
  })

  it('新しいセッション・状態が変わらない・完了でない変化は、入らない', () => {
    const prev = sessions(['a', 'working'], ['b', 'permission'])
    const next = sessions(['a', 'working'], ['b', 'working'], ['c', 'permission'])
    assert.deepEqual(detectMarks(prev, next), new Map())
  })
})

describe('音（AC-NT-5）', () => {
  // 偽の AudioContext: 作られた oscillator・gain を記録する
  const fakeAudio = (state = 'running') => {
    const log = { contexts: 0, oscillators: [], gains: [], resumed: 0, started: [] }
    class FakeContext {
      constructor() { log.contexts += 1; this.state = state; this.currentTime = 10; this.destination = {} }
      resume() { log.resumed += 1 }
      createOscillator() {
        const osc = { frequency: { value: 0 }, type: '', connect() {}, start(at) { log.started.push(at) }, stop() {} }
        log.oscillators.push(osc)
        return osc
      }
      createGain() {
        const gain = { gain: { setValueAtTime() {}, linearRampToValueAtTime(v) { gain.peak = v }, exponentialRampToValueAtTime() {} }, connect() {} }
        log.gains.push(gain)
        return gain
      }
    }
    return { FakeContext, log }
  }

  it('出来事ごとに、違う音: 完了＝上がる 3 音、許可＝同じ音 2 回、質問＝上がる 2 音', () => {
    assert.deepEqual(TONES.complete, [523.25, 659.25, 783.99])
    assert.deepEqual(TONES.permission, [660, 660])
    assert.deepEqual(TONES.question, [392, 523.25])
    const { FakeContext, log } = fakeAudio()
    const play = createWebAudioPlayer({ AudioContextImpl: FakeContext })
    assert.equal(play('complete', 100), true)
    assert.deepEqual(log.oscillators.map((o) => o.frequency.value), [523.25, 659.25, 783.99])
    assert.deepEqual(log.started.map((t) => Math.round((t - 10) * 100) / 100), [0, 0.16, 0.32], '音は、少しずつずらして、重ならない')
    assert.ok(log.oscillators.every((o) => o.type === 'sine'))
  })

  it('音量に従う（0〜100 が、音の大きさに比例する）。AudioContext は、最初に鳴らすときに 1 つだけ作る', () => {
    const { FakeContext, log } = fakeAudio()
    const play = createWebAudioPlayer({ AudioContextImpl: FakeContext })
    play('question', 100)
    play('question', 50)
    assert.equal(log.contexts, 1)
    assert.ok(Math.abs(log.gains[0].peak - 0.3) < 1e-9)
    assert.ok(Math.abs(log.gains[2].peak - 0.15) < 1e-9, '半分の音量は、半分の大きさ')
  })

  it('停止中（ブラウザが、操作の前は止めている）の AudioContext は、再開を試みる', () => {
    const { FakeContext, log } = fakeAudio('suspended')
    createWebAudioPlayer({ AudioContextImpl: FakeContext })('permission', 60)
    assert.equal(log.resumed, 1)
  })

  it('鳴らせないとき（AudioContext がない・例外・知らない出来事）は、例外にせず、false', () => {
    assert.equal(createWebAudioPlayer({ AudioContextImpl: undefined })('complete', 60), false)
    class Broken { constructor() { throw new Error('not allowed') } }
    assert.equal(createWebAudioPlayer({ AudioContextImpl: Broken })('complete', 60), false)
    assert.equal(createWebAudioPlayer({ AudioContextImpl: fakeAudio().FakeContext })('unknown', 60), false)
  })
})

describe('点滅（AC-NT-6）', () => {
  const fakeElement = () => {
    const el = { classes: new Set(), vars: {}, reflows: 0 }
    el.style = { setProperty: (k, v) => { el.vars[k] = v } }
    el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c) }
    Object.defineProperty(el, 'offsetWidth', { get: () => { el.reflows += 1; return 0 } })
    return el
  }

  it('出来事ごとの色を設定し、on クラスを付け直す（アニメーションを、最初からやり直す）', () => {
    const el = fakeElement()
    const flasher = createFlasher(el)
    flasher.flash('complete')
    assert.equal(el.vars['--flash'], 'var(--working)')
    assert.ok(el.classes.has('on'))
    assert.equal(el.reflows, 1, '付け直す間に、再計算を挟む')
    flasher.flash('permission')
    assert.equal(el.vars['--flash'], 'var(--permission-solid)')
    flasher.flash('question')
    assert.equal(el.vars['--flash'], 'var(--question-solid)')
    flasher.clear()
    assert.equal(el.classes.has('on'), false)
  })

  it('点滅の要素がなくても、例外にしない', () => {
    const flasher = createFlasher(null)
    flasher.flash('complete')
    flasher.clear()
  })
})

describe('くり返しと止め方（AC-NT-5, 7, 8）', () => {
  // 偽のタイマー: 時刻を進めて、setInterval のコールバックを、間隔ごとに呼ぶ
  const harness = (settings = {}) => {
    const log = { plays: [], flashes: [], clears: 0 }
    let time = 1_000_000
    let tick = null
    let cleared = 0
    const state = { ...DEFAULT_SETTINGS, ...settings }
    const notifier = createNotifier({
      getSettings: () => state,
      play: (kind, volume) => log.plays.push([kind, volume]),
      flasher: { flash: (kind) => log.flashes.push(kind), clear: () => { log.clears += 1 } },
      setIntervalFn: (fn, ms) => { assert.equal(ms, ALERT_EVERY_MS); tick = fn; return 1 },
      clearIntervalFn: () => { cleared += 1; tick = null },
      now: () => time,
    })
    const advance = (ms) => { time += ms; tick?.() }
    return { notifier, log, state, advance, active: () => tick !== null, cleared: () => cleared }
  }

  it('通知すると、すぐ 1 回（音と点滅）。そのあと、3 秒おきにくり返す。間隔は 3 秒', () => {
    const { notifier, log, advance } = harness({ alertSec: 30 })
    notifier.notify('complete')
    assert.deepEqual(log.plays, [['complete', 60]])
    assert.deepEqual(log.flashes, ['complete'])
    advance(3000)
    advance(3000)
    assert.equal(log.plays.length, 3)
    assert.equal(log.flashes.length, 3)
    assert.equal(ALERT_EVERY_MS, 3000)
  })

  it('設定の時間で止まる: 5 秒なら、0 秒と 3 秒の 2 回。15 秒なら 5 回。操作するまで（0）は、最大 10 分', () => {
    const run = (alertSec, steps) => {
      const h = harness({ alertSec })
      h.notifier.notify('question')
      for (let i = 0; i < steps; i++) h.advance(3000)
      return h
    }
    const five = run(5, 10)
    assert.equal(five.log.plays.length, 2)
    assert.equal(five.active(), false, '止まっている')
    const fifteen = run(15, 20)
    assert.equal(fifteen.log.plays.length, 5)
    assert.equal(fifteen.active(), false)
    const minute = run(60, 40)
    assert.equal(minute.log.plays.length, 20)
    const forever = run(0, 100)
    assert.equal(forever.active(), true, '10 分たつまでは、続く')
    const capped = run(0, 300)
    assert.equal(capped.log.plays.length, 200, '10 分 ÷ 3 秒 = 200 回で止まる')
    assert.equal(capped.active(), false, '止め忘れても、最大 10 分で止まる')
  })

  it('stop: 画面の操作で、すぐに止まる（点滅も消す）。止まったあとは、くり返さない', () => {
    const { notifier, log, advance, active } = harness({ alertSec: 60 })
    notifier.notify('permission')
    advance(3000)
    const before = log.plays.length
    notifier.stop()
    assert.equal(active(), false)
    assert.ok(log.clears >= 1)
    advance(3000)
    assert.equal(log.plays.length, before)
    notifier.stop() // 止まっているときに呼んでも、問題ない
  })

  it('新しい通知が来たら、前のものを止めて、切り替わる（タイマーが二重にならない）', () => {
    const { notifier, log, advance, cleared } = harness({ alertSec: 60 })
    notifier.notify('complete')
    notifier.notify('permission')
    assert.ok(cleared() >= 1, '前のタイマーを止めた')
    advance(3000)
    assert.deepEqual(log.plays.map((p) => p[0]), ['complete', 'permission', 'permission'])
  })

  it('AC-NT-5: ミュート・音量 0 では、音を鳴らさない（点滅は出る）。音量は、設定のとおり渡す', () => {
    const muted = harness({ mute: true })
    muted.notifier.notify('complete')
    assert.deepEqual([muted.log.plays.length, muted.log.flashes.length], [0, 1])
    const silent = harness({ volume: 0 })
    silent.notifier.notify('complete')
    assert.deepEqual([silent.log.plays.length, silent.log.flashes.length], [0, 1])
    const loud = harness({ volume: 85 })
    loud.notifier.notify('complete')
    assert.deepEqual(loud.log.plays, [['complete', 85]])
  })

  it('AC-NT-7: 点滅が OFF なら、点滅しない（音は鳴る）', () => {
    const { notifier, log } = harness({ blink: false })
    notifier.notify('question')
    assert.deepEqual([log.plays.length, log.flashes.length], [1, 0])
  })

  it('続けている間も、その時点の設定が効く（途中でミュートにすると、次の回から鳴らない）', () => {
    const { notifier, log, state, advance } = harness({ alertSec: 60 })
    notifier.notify('complete')
    state.mute = true
    advance(3000)
    assert.equal(log.plays.length, 1)
    assert.equal(log.flashes.length, 2, '点滅は続く')
    state.blink = false
    advance(3000)
    assert.equal(log.flashes.length, 2)
  })
})
