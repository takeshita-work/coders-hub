// AskUserQuestion の PermissionRequest フックの出力を作る（機能 003、ADR 0014）。
// 実機で確認した形: allow ＋ updatedInput（元の入力に answers を足したもの）を返すと、質問画面を出さずに答えが渡る。

export const QUESTION_TOOL = 'AskUserQuestion'

// toolInput: フックの入力の tool_input。answers: { 質問文: 答えの文字列 }
export const buildAnswerOutput = (toolInput, answers) => ({
  hookSpecificOutput: {
    hookEventName: 'PermissionRequest',
    decision: {
      behavior: 'allow',
      updatedInput: { ...toolInput, answers },
    },
  },
})

// Hub の /ask の応答から答えを取り出す。答えがなければ null（何も出力せず、ターミナルの質問画面に任せる）
export const answersFromResponse = (status, body) => {
  if (status !== 200 || body === null || typeof body !== 'object') return null
  const { answers } = body
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return null
  return Object.keys(answers).length > 0 ? answers : null
}
