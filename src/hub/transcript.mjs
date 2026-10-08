// 会話ログ（JSONL）から、中断・拒否の記録を見つける（ADR 0007）。
// 補助用途のみ。読めない・見つからない場合は null を返し、状態は変えない。
// 判定は前方一致 `[Request interrupted by user`（拒否: `... for tool use]`、Esc: `...]`）。

export const INTERRUPT_PREFIX = '[Request interrupted by user'

const textsOf = (entry) => {
  const content = entry?.message?.content
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text)
}

// 追記分のテキスト（複数行の JSONL）から、最後の中断記録を探す。
// 戻り値: { at: ミリ秒 | null } | null。壊れた行・途中で切れた行は無視する。
export const findInterruption = (text) => {
  let found = null
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.type !== 'user') continue
    if (!textsOf(entry).some((t) => t.startsWith(INTERRUPT_PREFIX))) continue
    const at = Date.parse(entry.timestamp)
    found = { at: Number.isNaN(at) ? null : at }
  }
  return found
}
