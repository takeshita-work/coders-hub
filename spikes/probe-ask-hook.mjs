// 検証スパイク用（使い捨て）: AskUserQuestion を PermissionRequest フックで代理回答できるか。
// 確認したいこと:
//   A-1: 答えを返すまで待っても通るか（待ち時間は ASK_WAIT_SEC、既定 90 秒）
//   A-2: 待っている間、ターミナルに質問画面が出るか／ターミナルで先に答えると待ちはどうなるか
//   A-3: 複数質問・multiSelect・自由入力の答えの渡し方
// 動作: 質問を logs/ask-pending.json に書き、logs/ask-answer.json が現れるのを待つ。
//       答えは spikes/probe-ask-answer.mjs で入れる。待ちきれなければ何も返さず（画面に任せる）。
//       待っている間の様子は logs/ask.jsonl に残す（wait / tick / answer / timeout / signal）。
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')
mkdirSync(logDir, { recursive: true })
const log = (type, extra = {}) => {
  try {
    appendFileSync(join(logDir, 'ask.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, pid: process.pid, ...extra }) + '\n')
  } catch {}
}

let raw = ''
for await (const c of process.stdin) raw += c
let input
try { input = JSON.parse(raw) } catch { log('unparsed', { raw }); process.exit(0) }

if (input.tool_name !== 'AskUserQuestion') process.exit(0)

const questions = input.tool_input?.questions ?? []
// セッションごとに別のファイルを使う（複数セッションの同時質問。T0-9）
const sid = String(input.session_id ?? 'unknown')
const pendingFile = join(logDir, `ask-pending-${sid}.json`)
const answerFile = join(logDir, `ask-answer-${sid}.json`)
log('ask', { session: input.session_id, tool_input: input.tool_input })

for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => { log('signal', { sig }); rmSync(pendingFile, { force: true }); process.exit(0) })
}
process.on('exit', () => log('exit'))

rmSync(answerFile, { force: true })
writeFileSync(pendingFile, JSON.stringify({ pid: process.pid, session: sid, cwd: input.cwd, questions }, null, 2))

const waitSec = Number(process.env.ASK_WAIT_SEC ?? 90)
const startedAt = Date.now()
let answer = null
let lastTick = 0
while (Date.now() - startedAt < waitSec * 1000) {
  if (existsSync(answerFile)) {
    try { answer = JSON.parse(readFileSync(answerFile, 'utf8')); break } catch {}
  }
  if (Date.now() - lastTick >= 5000) { lastTick = Date.now(); log('tick', { session: sid, waitedSec: Math.round((Date.now() - startedAt) / 1000) }) }
  await sleep(200)
}
rmSync(pendingFile, { force: true })
rmSync(answerFile, { force: true })

if (!answer) {
  log('timeout', { session: sid, waitSec })
  process.exit(0)
}

// answer.answers: { "<質問文>": "<ラベル or 自由入力 or ラベルのカンマ区切り>" }
log('answer', { session: sid, waitedMs: Date.now() - startedAt, answers: answer.answers })
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: {
      behavior: 'allow',
      updatedInput: { ...input.tool_input, answers: answer.answers },
    },
  },
}))
