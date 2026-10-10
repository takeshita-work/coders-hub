// AskUserQuestion 用の同期フック（PermissionRequest。機能 003、ADR 0014）。
// 質問を Hub へ送り、ダッシュボードで答えが入るまで待ち、答えを標準出力に書いて質問画面の代わりにする。
// 答えがない場合（Hub が動いていない・操作モードでない・時間切れ・ターミナルで先に応答）は何も出力せず、
// claude の質問画面（ターミナル）に任せる。claude の動作を妨げないよう、何があっても終了コード 0 で終わる。
import { loadConfig } from '../shared/config.mjs'
import { postJson } from '../shared/hub-client.mjs'
import { answersFromResponse, buildAnswerOutput, QUESTION_TOOL } from './answer.mjs'

const config = loadConfig()
// Hub の待ち時間（askWaitMs）より少し長く待つ。Hub が先に 204 を返せるように
const WAIT_MS = config.askWaitMs + 5000

// 何があっても待ち続けない（フックの timeout より前に終わる）
setTimeout(() => process.exit(0), WAIT_MS + 2000).unref()

try {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const input = JSON.parse(raw)
  if (input?.tool_name === QUESTION_TOOL && typeof input.session_id === 'string') {
    // Hub が動いていなければ、起動を試みずにすぐ終了する（待たずにターミナルへ任せる）
    const res = await postJson(config, '/ask', { session: input.session_id, questions: input.tool_input?.questions }, { timeoutMs: WAIT_MS })
    const body = res.status === 200 ? await res.json().catch(() => null) : null
    const answers = answersFromResponse(res.status, body)
    if (answers) process.stdout.write(JSON.stringify(buildAnswerOutput(input.tool_input, answers)))
  }
} catch {
  // Hub に届かない・入力が壊れている場合も何も出力しない
}
process.exit(0)
