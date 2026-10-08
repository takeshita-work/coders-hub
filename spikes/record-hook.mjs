// 検証スパイク用（使い捨て）: フックの入力と環境を spikes/logs/hooks.jsonl に追記するだけ。
// 仕様: specs/30-features/001-session-list/tasks.md の T0-1〜T0-8
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const startedAt = performance.timeOrigin // このプロセスの起動時刻（ms）
const logDir = join(dirname(fileURLToPath(import.meta.url)), 'logs')

let raw = ''
try {
  for await (const c of process.stdin) raw += c
} catch {}

let input
try { input = JSON.parse(raw) } catch { input = { _unparsed: raw } }

const now = Date.now()
const entry = {
  at: new Date(now).toISOString(),
  event: input.hook_event_name ?? null,
  input,
  env: {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
    CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? null,
  },
  proc: { pid: process.pid, ppid: process.ppid },
  // T0-7: プロセス起動から記録までの所要時間（ms）
  elapsedMs: Math.round(now - startedAt),
}

try {
  mkdirSync(logDir, { recursive: true })
  appendFileSync(join(logDir, 'hooks.jsonl'), JSON.stringify(entry) + '\n')
} catch {}

process.exit(0) // claude の動作を妨げない
