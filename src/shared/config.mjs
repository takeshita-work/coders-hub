// 設定の置き場所: 環境変数で上書きでき、なければ既定値を使う（ADR なし。plan.md「設定」参照）。
// hook.mjs / channel.mjs / hub.mjs が共通で読む。

const intFromEnv = (env, name, fallback) => {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} は正の整数で指定してください: ${raw}`)
  return n
}

export const loadConfig = (env = process.env) => ({
  host: '127.0.0.1',
  // 内部 API（hook / channel → Hub）。外に出さない（security.md）
  internalPort: intFromEnv(env, 'CODERS_HUB_INTERNAL_PORT', 8765),
  // 画面と WebSocket
  uiPort: intFromEnv(env, 'CODERS_HUB_UI_PORT', 8766),
  // 長いポーリングの周期と、最後の /poll からの削除期限（NFR-006）
  pollTimeoutMs: intFromEnv(env, 'CODERS_HUB_POLL_TIMEOUT_MS', 30_000),
  expireMs: intFromEnv(env, 'CODERS_HUB_EXPIRE_MS', 50_000),
  // 質問（AskUserQuestion）の答えを待つ上限。質問用フックの timeout（設定、100 秒）より短くする（機能 003）
  askWaitMs: intFromEnv(env, 'CODERS_HUB_ASK_WAIT_MS', 85_000),
})
