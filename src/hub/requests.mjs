// 許可要求・質問の待ち行列（機能 003、ADR 0002・0014）。HTTP・WebSocket から独立した純粋なロジック。
// 許可はチャネルサーバーから、質問は AskUserQuestion 用のフックから届く。どちらも「要求」として同じ形で扱う。
// 本文（入力・質問）は、要求が閉じた時点でメモリから消す（NFR-009）。

export const MAX_ANSWER_CHARS = 2_000
const KEEP_MS = 60_000

// 状態: open 応答待ち / allowed 許可した / denied 拒否した / answered 回答した
//       terminal ターミナルで応答済み / timeout 時間切れ（質問） / failed 応答できなかった
export class RequestError extends Error {
  // code: not-found(404) / not-controllable(409) / invalid(400) / not-open(409)
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const defaultNewId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0')

// ターミナルで先に応答されたことの検知（ツールが終わった合図 PostToolUse）で、届いたばかりの要求を閉じない猶予（ミリ秒）。
// 画面から許可した直後は、次の要求が先に届き、前のツールの PostToolUse が少し遅れて届く（実機で確認）。
// 人が新しい許可画面を読んで応答するには、これより長くかかる
const GRACE_MS = 2_000

const isString = (v) => typeof v === 'string'

// 画面に出す要求の形（応答待ちのものだけ）
const viewOf = (r) =>
  r.kind === 'permission'
    ? { id: r.id, kind: r.kind, createdAt: r.createdAt, toolName: r.toolName, description: r.description, inputPreview: r.inputPreview }
    : { id: r.id, kind: r.kind, createdAt: r.createdAt, questions: r.questions }

const cleanQuestions = (questions) =>
  questions.map((q) => ({
    question: q.question,
    header: isString(q.header) ? q.header : '',
    options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
      label: String(o?.label ?? ''),
      description: isString(o?.description) ? o.description : '',
    })),
    multiSelect: q.multiSelect === true,
  }))

// 質問への答えを検証し、{ 質問文: 文字列 } にそろえる。配列（複数選択）はカンマ区切りの 1 つの文字列にする
const normalizeAnswers = (questions, answers) => {
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new RequestError('invalid', 'answers が不正です')
  }
  const result = {}
  for (const q of questions) {
    const raw = answers[q.question]
    const parts = Array.isArray(raw) ? raw : [raw]
    if (parts.length === 0 || !parts.every((p) => isString(p) && p.trim() !== '')) {
      throw new RequestError('invalid', `「${q.question}」に答えがありません`)
    }
    const text = parts.join(',')
    if (text.length > MAX_ANSWER_CHARS) throw new RequestError('invalid', `答えは ${MAX_ANSWER_CHARS} 文字までです`)
    result[q.question] = text
  }
  return result
}

export const createRequests = ({
  store,
  now = Date.now,
  newId = defaultNewId,
  keepMs = KEEP_MS,
  graceMs = GRACE_MS,
  // 許可の応答ができたとき（チャネルサーバーへ返す応答がたまったとき）に呼ばれる。呼び出し側が takeVerdicts() で受け取る
  onVerdict = () => {},
} = {}) => {
  // sessionId -> 応答待ちの要求の配列（届いた順）
  const open = new Map()
  // sessionId -> チャネルサーバーへ返す許可の応答 [{ request_id, behavior }]
  const verdicts = new Map()
  // id -> { sessionId, status, finishedAt }。閉じた要求も keepMs だけ覚える
  const records = new Map()
  const listeners = new Set()

  const emit = (sessionId, id, status, reason) => {
    const change = { type: 'request', sessionId, id, status }
    if (reason) change.reason = reason
    for (const l of listeners) {
      try { l(change) } catch { /* 購読者の失敗で本体を止めない */ }
    }
  }

  const sync = (sessionId) => store.setRequests(sessionId, (open.get(sessionId) ?? []).map(viewOf))

  const find = (sessionId, id) => (open.get(sessionId) ?? []).find((r) => r.id === id)

  // 要求を閉じる。本文はここで手放す。質問を待っているフックには、答えがないこと（null）を返す
  const close = (sessionId, id, status, reason, answers = null) => {
    const list = open.get(sessionId)
    const index = list ? list.findIndex((r) => r.id === id) : -1
    if (index < 0) return false
    const [req] = list.splice(index, 1)
    if (list.length === 0) open.delete(sessionId)
    records.set(id, { sessionId, status, finishedAt: now() })
    req.settle?.(answers)
    sync(sessionId)
    emit(sessionId, id, status, reason)
    return true
  }

  const closeAll = (sessionId, status, reason) => {
    for (const r of [...(open.get(sessionId) ?? [])]) close(sessionId, r.id, status, reason)
  }

  const add = (sessionId, req) => {
    const session = store.get(sessionId)
    if (!session) throw new RequestError('not-found', 'セッションが見つかりません')
    if (!session.controllable) throw new RequestError('not-controllable', '操作モードで起動していません')
    const list = open.get(sessionId) ?? []
    list.push({ ...req, createdAt: now() })
    open.set(sessionId, list)
    records.set(req.id, { sessionId, status: 'open', finishedAt: null })
    sync(sessionId)
    emit(sessionId, req.id, 'open')
  }

  // セッションの状態が変わった・閉じられた
  const unsubscribe = store.subscribe((change) => {
    if (change.type === 'removed') {
      verdicts.delete(change.sessionId)
      return closeAll(change.sessionId, 'failed', 'セッションが終了しました')
    }
    if (change.type !== 'updated') return
    const { sessionId, state, stateSince } = change.session
    // 返答待ちに戻った（ターミナルでの拒否・中断、ターンの終了）。作業中に戻っただけでは閉じない（前のツールの PostToolUse が
    // 次の要求より遅れて届くことがあるため。ツールの終了は toolDone で扱う）。
    // 状態の変化が要求を受け取った後のものだけを閉じる（状態の通知が遅れて届く場合の誤閉じを防ぐ）
    if (state !== 'waiting') return
    for (const r of [...(open.get(sessionId) ?? [])]) {
      if (stateSince > r.createdAt) close(sessionId, r.id, 'terminal')
    }
  })

  return {
    // 許可要求（チャネルサーバーから）。戻り値: { id }。同じ ID がすでに応答待ちなら、何もせずその ID を返す
    addPermission(sessionId, { requestId, toolName, description = '', inputPreview = '' } = {}) {
      if (!isString(requestId) || requestId === '' || !isString(toolName) || toolName === '') {
        throw new RequestError('invalid', 'request_id と tool_name が必要です')
      }
      if (find(sessionId, requestId)) return { id: requestId }
      add(sessionId, {
        id: requestId, kind: 'permission', toolName,
        description: isString(description) ? description : '',
        inputPreview: isString(inputPreview) ? inputPreview : '',
      })
      return { id: requestId }
    },

    // 質問（AskUserQuestion 用のフックから）。戻り値: { id, result }。result は、答えが入れば { 質問文: 答え }、
    // 答えなしで閉じれば（ターミナルで応答・時間切れなど）null で解決する Promise
    addQuestion(sessionId, { questions } = {}) {
      if (!Array.isArray(questions) || questions.length === 0 || !questions.every((q) => q && isString(q.question) && q.question !== '')) {
        throw new RequestError('invalid', 'questions が不正です')
      }
      const id = newId()
      let settle
      const result = new Promise((resolve) => { settle = resolve })
      add(sessionId, { id, kind: 'question', questions: cleanQuestions(questions), settle })
      return { id, result }
    },

    // 画面からの応答。許可: { behavior: 'allow' | 'deny' } / 質問: { answers }
    respond(sessionId, id, body = {}) {
      const req = find(sessionId, id)
      if (!req) {
        const rec = records.get(id)
        if (rec && rec.sessionId === sessionId) throw new RequestError('not-open', 'すでに閉じています')
        throw new RequestError('not-found', '要求が見つかりません')
      }
      if (req.kind === 'permission') {
        if (body.behavior !== 'allow' && body.behavior !== 'deny') throw new RequestError('invalid', 'behavior が不正です')
        const list = verdicts.get(sessionId) ?? []
        list.push({ request_id: id, behavior: body.behavior })
        verdicts.set(sessionId, list)
        close(sessionId, id, body.behavior === 'allow' ? 'allowed' : 'denied')
        onVerdict(sessionId)
        return
      }
      close(sessionId, id, 'answered', undefined, normalizeAnswers(req.questions, body.answers))
    },

    // ツールが終わった（PostToolUse）。ターミナルで先に許可・回答されたと判断して、対応する要求を閉じる。
    // 同じツール（質問は AskUserQuestion）の要求のうち、最も古いものを 1 件。届いたばかりの要求（猶予の間）は閉じない。
    // 戻り値: 閉じた要求の ID（なければ null）
    toolDone(sessionId, toolName) {
      const t = now()
      const target = (open.get(sessionId) ?? []).find(
        (r) => (r.kind === 'permission' ? r.toolName === toolName : toolName === 'AskUserQuestion') && t - r.createdAt >= graceMs,
      )
      if (!target) return null
      close(sessionId, target.id, 'terminal')
      return target.id
    },

    // 質問の待ち時間切れなど、呼び出し側が閉じたいとき。戻り値: 閉じたか
    close: (sessionId, id, status, reason) => close(sessionId, id, status, reason),

    // チャネルサーバーへ返す許可の応答を取り出す
    takeVerdicts(sessionId) {
      const list = verdicts.get(sessionId) ?? []
      verdicts.delete(sessionId)
      return list
    },
    hasVerdicts: (sessionId) => (verdicts.get(sessionId)?.length ?? 0) > 0,

    // 古い記録の掃除。定期的に呼ぶ
    tick() {
      const t = now()
      for (const [id, rec] of records) {
        if (rec.finishedAt !== null && t - rec.finishedAt > keepMs) records.delete(id)
      }
    },

    // 応答待ちの要求（テスト・確認用）
    list: (sessionId) => (open.get(sessionId) ?? []).map(viewOf),

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose: unsubscribe,
  }
}
