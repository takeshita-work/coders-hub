// フックの標準入力から、Hub へ送る内容を作る。
// PreToolUse／PostToolUse の入力にはツールの入出力（ファイルの中身など）が含まれ大きいので、必要な項目だけ送る。

const MAX_PROMPT_CHARS = 2000
// tool_name は、許可待ちと質問待ち（AskUserQuestion）の区別に使う
const KEEP = ['session_id', 'cwd', 'transcript_path', 'notification_type', 'reason', 'tool_name', 'source']

// 戻り値: Hub の POST /event に送る本文。イベント名か session_id がなければ null
export const buildEvent = (input, env = process.env) => {
  if (!input || typeof input !== 'object') return null
  const event = input.hook_event_name
  if (typeof event !== 'string' || typeof input.session_id !== 'string') return null

  const slim = {}
  for (const key of KEEP) if (input[key] !== undefined) slim[key] = input[key]
  if (typeof input.prompt === 'string') slim.prompt = input.prompt.slice(0, MAX_PROMPT_CHARS)

  return { event, account: env.CLAUDE_CONFIG_DIR ?? null, input: slim }
}
