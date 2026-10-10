// 検証スパイク用（使い捨て）: probe-ask-hook.mjs が待っている質問を表示し、答えを渡す。
// 待っている質問はセッションごと（logs/ask-pending-<session_id>.json）。
//   node spikes/probe-ask-answer.mjs state                     → 待っている質問の一覧
//   node spikes/probe-ask-answer.mjs 黄                         → 待っている質問が 1 件のとき、1 問目の答え
//   node spikes/probe-ask-answer.mjs --session <ID の先頭> 黄    → セッションを指定して答える
//   node spikes/probe-ask-answer.mjs --empty                    → 空の答え
//   質問ごとに順に答える（multiSelect はカンマ区切り）: 黄 小 "赤,青"
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')
const pendings = () =>
  readdirSync(logDir)
    .filter((f) => /^ask-pending-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(logDir, f), 'utf8')))

let args = process.argv.slice(2)
let prefix = null
const si = args.indexOf('--session')
if (si >= 0) { prefix = args[si + 1]; args = [...args.slice(0, si), ...args.slice(si + 2)] }

const all = pendings()
if (args.length === 0 || args[0] === 'state') {
  console.log(all.length ? JSON.stringify(all.map((p) => ({ session: p.session, cwd: p.cwd, questions: p.questions.map((q) => q.question) })), null, 2) : '(待っている質問なし)')
  process.exit(0)
}
const targets = prefix ? all.filter((p) => p.session.startsWith(prefix)) : all
if (targets.length !== 1) {
  console.log(targets.length === 0 ? '待っている質問がありません' : '待っている質問が複数あります。--session <ID の先頭> で指定してください')
  process.exit(1)
}
const pending = targets[0]
const answers = {}
// PowerShell は空文字の引数を落とすので、`--empty` を空の答えとして扱う
pending.questions.forEach((q, i) => { answers[q.question] = args[i] === '--empty' ? '' : (args[i] ?? '') })
writeFileSync(join(logDir, `ask-answer-${pending.session}.json`), JSON.stringify({ answers }))
console.log('answered', pending.session.slice(0, 8), JSON.stringify(answers))
