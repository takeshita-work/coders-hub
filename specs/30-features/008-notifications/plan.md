# 008 通知（音と点滅） 実装計画

- ステータス: Draft
- 対応 spec: ./spec.md
- 関連 ADR: 0030
- 画面の見た目の基準: `../../20-design/screens/mockup/index.html`

## 方針
通知は、画面（ブラウザ）の中だけで完結する。Hub は変えない。受け取ったセッションの一覧（WebSocket の snapshot・session）の前後を比べて、出来事を見つけ、音と点滅で知らせる。

## 部品

| 部品 | 責務 |
|---|---|
| `src/web/notify.mjs`（新規） | 純粋な部分: 既定の設定・`normalizeSettings`（壊れた値を既定に）・`detectAlert(prev, next)`（出来事を 1 つに絞る）・音の組み立て（`TONES`）・続ける時間の換算。副作用の部分: `createNotifier({ audio, flash, setInterval, ... })`（音・点滅・くり返し・止める。部品を差し替えられる） |
| `src/web/main.mjs` | 設定の読み書き（`localStorage`）。セッションの一覧の更新のたびに、`detectAlert` → `notifier.notify`。画面の操作（pointerdown・keydown）で `stop` |
| `src/web/components.mjs` | メニューのパネル（音量・ミュート・点滅・続ける時間）。点滅の重ね（`#flash`） |
| `src/web/styles.css` | 点滅（`edge-blink`。`steps(1)`）・パネルの見た目（試作のものを元に） |

## 出来事の見つけ方（`detectAlert`）
- 入力: 前の一覧（Map）、次の一覧（Map）、最初のスナップショットを受け取り済みか
- 前の一覧が、まだない（最初のスナップショット）ときは、なし
- 次の一覧の各セッションで、前にもあって、状態が変わったものだけを見る（新しく現れたものは、見ない）
  - 許可待ちになった → permission、質問待ちになった → question、作業中 → 返答待ち → complete
- 複数あれば、permission > question > complete

## くり返し（`notify`）
- 開始: 前の通知を止めてから、すぐ 1 回（音・点滅）、そのあと 3 秒おき
- 終了: 設定の時間（秒。0 は、最大 10 分）の、半周期前まで。画面の操作で、すぐ止まる
- 音: WebAudio（`OscillatorNode`＋`GainNode`。0.16 秒ずつずらした正弦波）。`AudioContext` は、最初の通知で作る（ブラウザの決まり）。作れない・鳴らせないときは、何もしない
- 点滅: `#flash` の `on` クラスを付け直して、アニメーションを再開する（`getBoundingClientRect` などで再計算を強制）

## テスト
- `tests/notify.test.mjs`: `detectAlert`・`normalizeSettings`・`createNotifier`（偽のタイマー・音・点滅で、くり返し・止まり方・ミュート・OFF を確かめる）
- `tests/web-components.test.mjs`・`tests/web-interactions.test.mjs`: メニューの設定の表示と操作
