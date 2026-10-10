// UserPromptSubmit の prompt を、一覧の「直近の発言」に使う形に整える。
// ダッシュボードから送った指示（チャネルの通知）は、<channel source="..." id="...">本文</channel> の形で届く。
// タグのままでは先頭行がタグだけになるので、本文を取り出す（機能 002）。

const CHANNEL_WRAPPER = /^\s*<channel(?:\s[^>]*)?>\s*([\s\S]*?)\s*<\/channel>\s*$/

export const promptText = (prompt) => {
  if (typeof prompt !== 'string') return prompt
  const match = CHANNEL_WRAPPER.exec(prompt)
  return match ? match[1] : prompt
}
