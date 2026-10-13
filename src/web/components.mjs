// 画面の部品（表示のみ。状態は props で受け取る）。JSX は使わず createElement で書く（ビルドなしでテストできる）。
// 仕様: specs/30-features/006-dashboard-layout/spec.md（ADR 0015）。見た目の基準は specs/20-design/screens/mockup/index.html
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CONVERSATION_POLL_MS, INSTRUCTION_LABEL, MAX_INSTRUCTION, PREVIEW_COLLAPSE_CHARS, REQUEST_LABEL, SHORT_LABEL, TOOL_STATUS_LABEL, VIEW_ONLY_LABEL,
  accountName, applyLatest, bestMark, buildAnswers, buildTree, collapsePreview, deliveredInstructionIds, emptyConversation, emptyDraft, formatClock,
  formatElapsed, formatPrompt, groupTools, isAttention, isFinal, mergeTimeline, parsePreview, prependOlder, previewLength, projectName, recordsFor,
  requestRecordsFor, runningToolIds, setOther, shortId, sidebarAllowRequest, summarizeToolGroup, toggleOption, toolHasMore, toolStatus,
  toolSummaryOf, validateAnswers, validateInstruction, withConversationError,
} from './logic.mjs'
import { DEFAULT_SETTINGS, DURATIONS } from './notify.mjs'
import { Markdown } from './markdown.mjs'

// ---- 許可要求・質問（会話の中のカード。機能 003） ----

// 許可要求の入力の表示（AC-004-1）。長いときは折りたたむ。claude が省略して渡したときは、省略があることと文字数を示す
export const RequestInput = ({ preview }) => {
  const [expanded, setExpanded] = useState(false)
  const { omitted } = parsePreview(preview)
  const long = previewLength(preview) > PREVIEW_COLLAPSE_CHARS
  const shown = expanded || !long ? preview : collapsePreview(preview)
  return h('div', { className: 'request-input-wrap' },
    h('pre', { className: 'pre request-input', 'data-collapsed': long && !expanded }, shown),
    omitted > 0 && h('p', { className: 'hint', 'data-hint': 'elided' },
      `入力が長いため、途中が省略されています（省略: ${omitted} 文字）。全文は確認できません。内容に確信が持てないときは、拒否してください`),
    long && h('button', { type: 'button', className: 'btn request-toggle', 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) },
      expanded ? '折りたたむ' : 'すべて表示'),
  )
}

// 許可要求（AC-004-1〜004-4）
export const PermissionCard = ({ sessionId, request, onRespond }) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const answer = async (behavior) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onRespond?.(sessionId, request.id, { behavior })
      if (result && !result.ok) setError(result.reason)
    } finally {
      setBusy(false)
    }
  }
  return h('section', { className: 'card c-permission', 'data-request-kind': 'permission', 'data-request-id': request.id },
    h('h3', null, '許可要求'),
    h('div', { className: 'request-head' },
      h('b', { className: 'request-tool' }, request.toolName),
      request.description && h('span', { className: 'request-description' }, ` — ${request.description}`),
    ),
    h(RequestInput, { preview: request.inputPreview }),
    h('div', { className: 'actions' },
      h('button', { type: 'button', className: 'btn btn-allow', disabled: busy, onClick: () => answer('allow') }, '許可'),
      h('button', { type: 'button', className: 'btn btn-deny', disabled: busy, onClick: () => answer('deny') }, '拒否'),
      error && h('span', { className: 'hint request-error', role: 'alert' }, error),
    ),
  )
}

// 質問への回答（AC-004-7〜004-10）。選択肢（単一・複数）と自由入力
export const QuestionCard = ({ sessionId, request, onRespond }) => {
  const { questions } = request
  const [draft, setDraft] = useState(() => emptyDraft(questions))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const checked = validateAnswers(questions, draft)
  const submit = async () => {
    if (!checked.ok || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onRespond?.(sessionId, request.id, { answers: buildAnswers(questions, draft) })
      if (result && !result.ok) setError(result.reason)
    } finally {
      setBusy(false)
    }
  }
  return h('section', { className: 'card c-question', 'data-request-kind': 'question', 'data-request-id': request.id },
    h('h3', null, '質問'),
    questions.map((q, qi) =>
      h('fieldset', { key: qi, className: 'q', 'data-multi': q.multiSelect },
        h('legend', { className: 'q-title' },
          q.header && h('span', { className: 'question-header' }, `${q.header}: `),
          h('span', { className: 'question-text' }, q.question),
          q.multiSelect && h('span', { className: 'hint' }, '（複数選択）'),
        ),
        q.options.map((o, oi) =>
          h('label', { key: oi, className: 'opt' },
            h('input', {
              type: q.multiSelect ? 'checkbox' : 'radio', name: `${request.id}-${qi}`, checked: draft[qi].selected.includes(o.label),
              onChange: () => setDraft(toggleOption(draft, qi, q, o.label)),
            }),
            h('span', null, o.label, o.description && h('small', null, o.description)),
          )),
        h('input', {
          type: 'text', className: 'other', placeholder: 'その他（自由入力）', 'aria-label': `${q.header || q.question}の自由入力`, value: draft[qi].other,
          onChange: (e) => setDraft(setOther(draft, qi, q, e.target.value)),
        }),
      )),
    h('div', { className: 'actions' },
      h('button', { type: 'button', className: 'btn btn-primary', disabled: !checked.ok || busy, onClick: submit }, busy ? '送信中…' : '回答する'),
      !checked.ok && h('span', { className: 'hint', 'data-hint': 'invalid' }, checked.reason),
      error && h('span', { className: 'hint request-error', role: 'alert' }, error),
    ),
  )
}

// ---- 会話の中のできごと（結果の行・送った指示） ----

// 閉じた要求の結果。状態の色で右寄せ。入力や答えの内容は残さない（NFR-009。AC-UI-21）
const kindOfResult = (r) => r.kind ?? (r.status === 'allowed' || r.status === 'denied' ? 'permission' : r.status === 'answered' ? 'question' : null)
export const ResultLine = ({ record, onDismiss }) => {
  const kind = kindOfResult(record)
  return h('div', { className: `msg res${kind ? ` res-${kind}` : ''}`, 'data-request-status': record.status },
    h('small', null,
      kind && h('span', { className: 'res-tag' }, kind === 'permission' ? '許可' : '質問'),
      h('span', { className: 'request-status' }, REQUEST_LABEL[record.status] ?? record.status),
      h('button', { type: 'button', className: 'dismiss', 'aria-label': '結果を閉じる', onClick: () => onDismiss?.(record.id) }, '×'),
    ),
    record.summary && h('div', { className: 'request-summary', title: record.summary }, record.summary),
    record.reason && h('div', { className: 'instruction-reason' }, record.reason),
  )
}

// 保留中の指示（AC-UI-22, 003-3）
export const PendingMessage = ({ sessionId, pending, onCancel }) =>
  h('div', { className: 'msg user is-pending', 'data-instruction-status': 'held' },
    h('small', null, 'あなた', h('span', { className: 'tag-pend' }, INSTRUCTION_LABEL.held)),
    h('span', { className: 'instruction-text', title: pending.preview }, pending.preview),
    h('button', { type: 'button', className: 'btn cancel', onClick: () => onCancel?.(sessionId, pending.id) }, '取り消し'),
  )

// 送った指示の結果（届きました・送れませんでした、など）。保留中のものは PendingMessage で出す
export const SentMessage = ({ record, onDismiss }) =>
  h('div', { className: `msg user instruction-${record.status}`, 'data-instruction-status': record.status },
    h('small', null, 'あなた',
      h('span', { className: record.status === 'confirmed' ? 'tag-done' : 'tag-pend' }, INSTRUCTION_LABEL[record.status] ?? record.status),
      isFinal(record.status) && record.status !== 'confirmed' && h('button', {
        type: 'button', className: 'dismiss', 'aria-label': '結果を閉じる', onClick: () => onDismiss?.(record.id),
      }, '×'),
    ),
    h('span', { className: 'instruction-text', title: record.preview ?? '' }, record.preview ?? ''),
    record.reason && h('div', { className: 'instruction-reason' }, record.reason),
  )

// ---- 会話（機能 004）。会話ログから読んだ、利用者の発言・Claude の応答・ツールの使用・質問と答え ----

const Time = ({ at }) => (formatClock(at) ? h('time', { className: 'msg-time' }, formatClock(at)) : null)

// ツールの使用（AC-007-4。ADR 0029）。閉じた 1 行: ツール名・要点（実行したコマンド・ファイル名など）・結果・時刻。
// 開くと、要点の全文。出力（結果の中身）は出さない。全文が要点と同じなら、開く意味がないので、開閉しない
export const ToolRow = ({ message, running }) => {
  const status = toolStatus(message, running)
  const summary = toolSummaryOf(message)
  const head = [
    h('span', { key: 'name', className: 'tool-name' }, message.tool.name),
    summary && h('span', { key: 'arg', className: 'tool-arg', title: summary }, summary),
    h('span', { key: 'result', className: 'tool-result' }, TOOL_STATUS_LABEL[status]),
    h(Time, { key: 'time', at: message.at }),
  ]
  const className = `tool-line tool-${status}`
  if (!toolHasMore(message)) return h('div', { className, 'data-conversation': 'tool' }, h('div', { className: 'tl-row' }, head))
  return h('details', { className, 'data-conversation': 'tool' },
    h('summary', null, head),
    h('div', { className: 'tool-detail' },
      h('pre', { className: 'pre' }, message.tool.detail),
      message.tool.truncated && h('span', { className: 'truncated' }, '…（以下省略）')))
}

// 連続したツール（2 件以上）のグループ（AC-007-22）。閉じた 1 行: 件数・ツール名（回数）・結果の内訳・時刻の範囲。開くと、個別の行
const GROUP_SUMS = [['ok', '成功', ''], ['error', 'エラー', 'warn'], ['rejected', '拒否', 'warn'], ['running', '実行中', 'run']]
export const ToolGroup = ({ group, running }) => {
  const info = summarizeToolGroup(group.messages, running)
  const from = formatClock(info.from)
  const to = formatClock(info.to)
  const range = from === '' ? '' : from === to ? from : `${from}〜${to}`
  return h('details', { className: 'tool-group', 'data-conversation': 'tool-group' },
    h('summary', null,
      h('span', { className: 'tg-count' }, `ツール ${info.count} 件`),
      h('span', { className: 'tg-names' }, info.names.map((n) => (n.count > 1 ? `${n.name} ×${n.count}` : n.name)).join(' · ')),
      GROUP_SUMS.filter(([key]) => info.tally[key] > 0).map(([key, label, cls]) => h('span', { key, className: `tg-sum ${cls}`.trim() }, `${label} ${info.tally[key]}`)),
      range && h('time', { className: 'msg-time' }, range)),
    h('div', { className: 'tool-group-body' }, group.messages.map((m) => h(ToolRow, { key: m.id, message: m, running: running.has(m.id) }))))
}

// 利用者の発言と応答の本文は、文字として出す（HTML・Markdown を解釈しない。AC-007-6。React が文字として扱う）
export const ConversationMessage = ({ message, running }) => {
  if (message.role === 'tool') return h(ToolRow, { message, running })
  if (message.role === 'question') {
    return h('div', { className: 'msg qa', 'data-conversation': 'question' },
      h('small', null, h('span', { className: 'res-tag' }, '質問'), message.tool.result === 'rejected' && h('span', { className: 'tag-pend' }, '拒否'), h(Time, { at: message.at })),
      message.answers.map((a, i) => h('div', { key: i, className: 'qa-item' },
        h('div', { className: 'res-q' }, a.question), a.answer !== null && h('div', { className: 'res-a' }, a.answer))))
  }
  const user = message.role === 'user'
  // Claude の応答は Markdown として整形する（HTML は文字のまま。AC-007-6）。利用者の発言は、書いたとおりの文字で出す
  return h('div', { className: `msg${user ? ' user' : ' md-msg'}`, 'data-conversation': message.role, 'data-instruction-id': message.instructionId ?? undefined },
    h('small', null, user ? 'あなた' : 'Claude', message.source === 'dashboard' && h('span', { className: 'tag-src' }, 'ダッシュボードから'), h(Time, { at: message.at })),
    user ? message.text : h(Markdown, { text: message.text }),
    message.truncated && h('span', { className: 'truncated' }, '…（以下省略）'))
}

// 取得の状態: 会話ログから読んだ会話を、詳細を開いている間だけ、条件つきで繰り返し取得する（AC-007-10〜12）
const useConversation = ({ sessionId, fetchConversation }) => {
  const [conv, setConv] = useState(emptyConversation)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const etag = useRef(null)
  etag.current = conv.etag

  useEffect(() => {
    if (!fetchConversation) return undefined
    let stopped = false
    let busy = false
    const tick = async () => {
      if (stopped || busy || (typeof document !== 'undefined' && document.hidden)) return
      busy = true
      try {
        const result = await fetchConversation(sessionId, { etag: etag.current })
        if (stopped) return
        if (result.status === 'ok') setConv((prev) => applyLatest(prev, result))
        else if (result.status === 'error') setConv((prev) => withConversationError(prev, result.code))
        else setConv((prev) => (prev.error ? { ...prev, error: null } : prev))
      } finally {
        busy = false
      }
    }
    tick()
    const timer = setInterval(tick, CONVERSATION_POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [sessionId, fetchConversation])

  const loadOlder = useCallback(async () => {
    if (!fetchConversation || loadingOlder || conv.cursor === null) return false
    setLoadingOlder(true)
    try {
      const result = await fetchConversation(sessionId, { before: conv.cursor })
      if (result.status === 'ok') { setConv((prev) => prependOlder(prev, result)); return true }
      return false
    } finally {
      setLoadingOlder(false)
    }
  }, [sessionId, fetchConversation, loadingOlder, conv.cursor])

  return { conv, loadingOlder, loadOlder }
}

// ---- 下部（入力欄と状態の行） ----

// メッセージ入力欄（AC-UI-25, 26, 002-1, 002-4）。Enter で送信、Shift+Enter で改行。操作できないセッションでは無効にして「閲覧のみ」
export const Composer = ({ session, onSend }) => {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!session.controllable) {
    return h('textarea', { className: 'inst', rows: 1, disabled: true, placeholder: VIEW_ONLY_LABEL, 'aria-label': 'メッセージ', 'data-hint': 'not-controllable' })
  }
  const checked = validateInstruction(text)
  const over = text.length > MAX_INSTRUCTION
  const submit = async () => {
    if (!checked.ok || busy) return
    setBusy(true)
    try {
      const result = await onSend?.(session.sessionId, text)
      if (result?.ok) setText('')
    } finally {
      setBusy(false)
    }
  }
  return h('div', { className: 'composer-box' },
    h('textarea', {
      className: 'inst', rows: 1, value: text, placeholder: 'メッセージを入力', 'aria-label': 'メッセージ',
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); submit() }
      },
    }),
    over && h('p', { className: 'hint', 'data-hint': 'invalid' }, checked.reason),
  )
}

// 入力欄の下の状態の行（AC-UI-27）。返答待ちは札を出さない
export const StatusLine = ({ session, elapsedMs }) =>
  h('div', { className: 'status-line' },
    h('span', { className: 'sl-id', title: session.sessionId }, shortId(session.sessionId)),
    session.resumedFrom && h('span', { className: 'sl-resume', title: 'resume した会話。元の ID の記録を引き継いでいる' }, `再開（元 ${shortId(session.resumedFrom)}）`),
    h('span', { className: 'sl-elapsed' }, formatElapsed(elapsedMs)),
    SHORT_LABEL[session.state] && h('span', { className: `state chip-${session.state}` }, SHORT_LABEL[session.state]),
  )

// ---- 詳細（メイン） ----

// 一番下から離れているとみなす距離（px）。上の端の近くとみなす距離（px。ここまで来たら、前の会話を読み込む）
const AWAY_PX = 160
const LOAD_OLDER_PX = 300

export const Detail = ({ session, now, instructions, requestRecords, fetchConversation, onBack, onSend, onCancel, onDismiss, onRespond, onDismissRequest, scrollPositions }) => {
  const scroller = useRef(null)
  const [away, setAway] = useState(false)
  const awayRef = useRef(false)
  const { conv, loadingOlder, loadOlder } = useConversation({ sessionId: session.sessionId, fetchConversation })
  const requests = session.requests ?? []
  const pending = session.pending ?? []
  // ログに現れた指示は、「届きました」の記録を出さない（二重に出さない。AC-007-3）
  const delivered = deliveredInstructionIds(conv.messages)
  const sent = (instructions ? recordsFor(instructions, session.sessionId) : []).filter((r) => r.status !== 'held' && !delivered.has(r.id))
  const results = requestRecords ? requestRecordsFor(requestRecords, session.sessionId) : []
  // 結果の行と送った指示（できごと）は、会話ログのメッセージと、起きた時刻の順に、1 本に並べる（AC-007-25）
  const events = [
    ...sent.map((r) => ({ at: r.at, node: h(SentMessage, { key: `i-${r.id}`, record: r, onDismiss }) })),
    ...results.map((r) => ({ at: r.at, node: h(ResultLine, { key: `r-${r.id}`, record: r, onDismiss: onDismissRequest }) })),
  ]
  const running = runningToolIds(conv.messages)
  const timeline = groupTools(mergeTimeline(conv.messages, events, { hasMoreBefore: conv.cursor !== null }))

  // 位置を意図して変えるたびに進む番号。あとから「まだ自分の置いた位置のままか」を確かめるのに使う
  const posToken = useRef(0)
  const touch = () => ++posToken.current
  // 一番下へ。更新の直後は、画像・折り返しなどでまだ高さが確定しきっていないことがあるので、
  // 描画が済んでからもう一度合わせ直す（真の一番下まで届かせる）。その間に、利用者が動かした・他の処理が位置を変えていたら、触らない
  const scrollToBottom = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    const pinned = el.scrollTop
    const token = touch()
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0)
    // 置いたときのままか（利用者が動かしていない・他の処理が位置を変えていない）ときだけ、合わせ直す
    raf(() => {
      const el2 = scroller.current
      if (el2 && posToken.current === token && el2.scrollTop === pinned) el2.scrollTop = el2.scrollHeight
    })
  }
  // 一番下からの距離（px）。ページ分けで読み込み済みの量が変わっても、同じ意味になる（AC-UI-37）
  const distanceFromBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight
  // 現在の位置から、「一番下へ」ボタンの要否（away）を測り直す
  const syncAway = () => {
    const el = scroller.current
    if (!el) return
    const isAway = distanceFromBottom(el) > AWAY_PX
    awayRef.current = isAway
    setAway(isAway)
  }
  // 自分の操作や要求の出現（カード・結果・指示）が増えたときは一番下へ。開いたときも一番下へ（AC-UI-23）
  const count = requests.length + events.length + pending.length
  useLayoutEffect(scrollToBottom, [count])
  // 開いたとき（最初に読み込めたとき）に、覚えておいた位置まで戻している間だけ、目標の距離を持つ（AC-UI-37）
  const restoring = useRef(null)
  // 会話の新着・更新（新しい発言・ツールの結果が付くなど。etag は内容が変わるたびに変わる）は、一番下の近くにいるときだけ一番下へ。上を読んでいるときは動かさない
  // 開いたとき（最初に読み込めたとき）は、セッションごとに覚えておいた「一番下からの距離」に戻る。なければ一番下（既定）
  const seen = useRef({ loaded: false, etag: undefined })
  useLayoutEffect(() => {
    const first = !seen.current.loaded && conv.loaded
    if (first) {
      const distance = scrollPositions?.get(session.sessionId)
      if (distance != null && distance > 0) restoring.current = { distance }
      else scrollToBottom()
      syncAway()
    } else if (seen.current.etag !== conv.etag && !awayRef.current) {
      scrollToBottom()
    }
    seen.current = { loaded: seen.current.loaded || conv.loaded, etag: conv.etag }
  }, [conv.etag, conv.loaded])
  // セッションを切り替える・閉じるときに、最後のスクロール位置（一番下からの距離）を覚えておく（AC-UI-37）
  useEffect(() => () => {
    const el = scroller.current
    if (el) scrollPositions?.set(session.sessionId, distanceFromBottom(el))
  }, [session.sessionId])
  // 「さらに表示」で前に足したときは、いま見ている位置が動かないよう、増えた高さの分だけ足す
  const anchor = useRef(null)
  const oldest = conv.messages[0]?.id
  useLayoutEffect(() => {
    const el = scroller.current
    if (anchor.current && el) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
      touch()
      anchor.current = null
    }
    // 覚えておいた距離まで戻れたか（これ以上、前を読んでも届かないときは、読めた分だけで止める）
    if (restoring.current && el) {
      const have = el.scrollHeight - el.clientHeight
      if (have >= restoring.current.distance || conv.cursor === null) {
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - restoring.current.distance)
        touch()
        restoring.current = null
        syncAway()
      }
    }
  }, [oldest])
  const more = async () => {
    const el = scroller.current
    if (el) anchor.current = { top: el.scrollTop, height: el.scrollHeight }
    const ok = await loadOlder()
    if (!ok) anchor.current = null
  }
  // 上の端の近くまでスクロールしたら、前の会話を自動で読み込む（ボタンは使わない。AC-007-8）
  const loadIfNearTop = () => {
    const el = scroller.current
    if (el && conv.cursor !== null && !loadingOlder && el.scrollTop <= LOAD_OLDER_PX) more()
  }
  // 内容が画面に満たない・覚えておいた距離にまだ届かないときは、満たす（届く）まで自動で読み込む（同じ位置からの読み込みは 1 回だけ）
  const filledFor = useRef(null)
  useEffect(() => {
    const el = scroller.current
    if (!el || conv.cursor === null || loadingOlder || filledFor.current === conv.cursor) return
    const have = el.scrollHeight - el.clientHeight
    const need = restoring.current ? restoring.current.distance : LOAD_OLDER_PX
    if (have <= need) {
      filledFor.current = conv.cursor
      more()
    }
  }, [conv.cursor, conv.messages.length, loadingOlder])
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    syncAway()
    scrollPositions?.set(session.sessionId, distanceFromBottom(el))
    loadIfNearTop()
  }

  return h('div', { className: 'detail', ref: scroller, onScroll, 'data-session-id': session.sessionId },
    h('div', { className: 'd-top' },
      h('div', { className: 'float' },
        h('button', { type: 'button', className: 'back', 'aria-label': '一覧へ', title: '一覧へ', onClick: onBack },
          h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'M15 5l-7 7 7 7' }))),
        h('div', { className: 'd-head' }, h('h2', { title: session.cwd ?? '' }, projectName(session.cwd))),
        h('div', { className: 'd-meta1', title: session.account ?? '' }, accountName(session.account)),
      ),
    ),
    h('div', { className: 'd-body' },
      h('div', { className: 'talk' },
        loadingOlder && h('p', { className: 'conv-note', role: 'status', 'data-conversation-note': 'loading' }, '前の会話を読み込んでいます…'),
        conv.error && (conv.error === 'no-transcript'
          ? conv.messages.length === 0 && h('p', { className: 'conv-note', 'data-conversation-note': 'none' }, '会話の記録がまだありません')
          : h('p', { className: 'conv-note conv-error', role: 'status', 'data-conversation-note': 'error' }, '会話を読み込めません')),
        timeline.map((item) => {
          if (item.type === 'event') return item.node
          if (item.type === 'toolgroup') return h(ToolGroup, { key: item.id, group: item, running })
          return h(ConversationMessage, { key: item.message.id, message: item.message, running: running.has(item.message.id) })
        }),
        requests.map((r) =>
          r.kind === 'permission'
            ? h(PermissionCard, { key: r.id, sessionId: session.sessionId, request: r, onRespond })
            : h(QuestionCard, { key: r.id, sessionId: session.sessionId, request: r, onRespond })),
        pending.map((p) => h(PendingMessage, { key: `p-${p.id}`, sessionId: session.sessionId, pending: p, onCancel })),
      ),
    ),
    h('div', { className: 'dock' },
      h('button', {
        type: 'button', className: 'to-bottom', 'aria-label': '一番下へ', title: '一番下へ', hidden: !away,
        onClick: () => scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight, behavior: 'smooth' }),
      }, h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M5 9l7 7 7-7' }))),
      h('div', { className: 'float' },
        h('div', { className: 'composer' },
          h(Composer, { session, onSend }),
          h(StatusLine, { session, elapsedMs: now - session.stateSince }),
        ),
      ),
    ),
  )
}

// ---- サイドバー ----

const FilterIcon = () =>
  h('svg', { width: 20, height: 16, viewBox: '0 0 26 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M2 3h13l-5 6v7l-3-2V9z' }),
    h('path', { d: 'M21 3v14M18.5 14.5L21 17l2.5-2.5M18.5 5.5L21 3l2.5 2.5' }))

// 許可待ち・質問待ちの件数（バッジ）。折りたたんでいても出す（AC-UI-5）
const Badges = ({ counts }) =>
  h('span', { className: 'node-chips' },
    counts.permission > 0 && h('span', { className: 'chip badge badge-permission', 'aria-label': `許可待ち ${counts.permission} 件` }, counts.permission),
    counts.question > 0 && h('span', { className: 'chip badge badge-question', 'aria-label': `質問待ち ${counts.question} 件` }, counts.question),
  )

// サイドバーの目印（機能 008、AC-NT-12, 13）: 出来事があったセッションの行・折りたたんだ見出しに出す、小さな色の点
const MARK_TITLE = { complete: '完了した', permission: '許可待ちになった', question: '質問待ちになった' }
const MarkDot = ({ kind }) => Boolean(kind) && h('span', { className: `mark-dot mark-${kind}`, title: MARK_TITLE[kind], 'aria-hidden': true })

// セッションの行（AC-UI-11〜14, 17, 18）。1 行目: ID・経過時間・札、2 行目: 直近の発言
export const SessionRow = ({ session, elapsedMs, selected, onSelect, onRespond, markKind = null }) => {
  const prompt = formatPrompt(session.lastPrompt)
  const allow = sidebarAllowRequest(session)
  return h('li', {
    className: `sess st-${session.state}${session.controllable ? '' : ' nc'}${allow ? ' has-allow' : ''}`,
    'data-state': session.state, 'data-session-id': session.sessionId,
  },
    h('div', { className: 'sess-box' },
      h('button', {
        type: 'button', className: `sess-btn${selected ? ' sel' : ''}`, 'aria-current': selected ? 'true' : undefined, onClick: () => onSelect?.(session.sessionId),
      },
        h('span', { className: 'sess-id', title: session.sessionId }, shortId(session.sessionId)),
        h('span', { className: 'sess-time' }, formatElapsed(elapsedMs)),
        h('span', { className: 'sess-tags' },
          h(MarkDot, { kind: markKind }),
          SHORT_LABEL[session.state] && h('span', { className: `chip chip-${session.state}` }, SHORT_LABEL[session.state]),
          !session.controllable && h('span', { className: 'tag-nc' }, VIEW_ONLY_LABEL)),
        h('span', { className: 'sess-prompt', title: session.lastPrompt ?? '' }, prompt ?? '（発言なし）'),
      ),
      allow && h('button', {
        type: 'button', className: 'btn btn-allow sess-allow', onClick: () => onRespond?.(session.sessionId, allow.id, { behavior: 'allow' }),
      }, '許可'),
    ),
  )
}

const Node = ({ nodeKey, className, head, name, counts, collapsed, onToggle, children, mark = null }) =>
  h('li', { className: `${className}${collapsed ? ' collapsed' : ''}`, 'data-node': nodeKey },
    h('button', { type: 'button', className: `node-head${head ? ` ${head}` : ''}`, 'aria-expanded': !collapsed, onClick: () => onToggle?.(nodeKey) },
      h('span', { className: 'caret', 'aria-hidden': true }, '▾'),
      name,
      h('span', { className: 'node-total' }, counts.total),
      h(MarkDot, { kind: mark }),
      h(Badges, { counts }),
    ),
    // 折りたたんでいる間は、中身を描画しない
    !collapsed && h('ul', null, children),
  )

const SortButton = ({ value, onClick, label }) =>
  h('button', { type: 'button', className: 'sort-btn', onClick, 'aria-label': label }, value ? '↑ 昇順' : '↓ 降順')

const MenuIcon = () =>
  h('svg', { width: 20, height: 16, viewBox: '0 0 20 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', 'aria-hidden': true },
    h('path', { d: 'M3 3h14M3 8h14M3 13h14' }))

const SpeakerIcon = ({ muted }) =>
  h('svg', { width: 18, height: 16, viewBox: '0 0 24 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M3 7h4l5-4v14l-5-4H3z' }),
    muted ? h('path', { d: 'M16 7l5 6M21 7l-5 6' }) : h('path', { d: 'M16 7a4 4 0 010 6M18.5 4.5a8 8 0 010 11' }))

// メニューのパネル（機能 006 の AC-UI-31〜33、機能 008）: バージョン・音量とミュート・画面の点滅・続ける時間・Hub の終了
//  settings: 通知の設定（notify.mjs）。onSettings(patch): 設定の変更。onPreview('sound' | 'flash'): 試しに鳴らす・光らせる
export const MenuPanel = ({ version, settings = DEFAULT_SETTINGS, onSettings, onPreview, onQuit }) =>
  h('div', { className: 'panel', 'data-panel': 'menu' },
    h('div', { className: 'panel-sec' },
      h('div', { className: 'panel-row' }, h('span', null, 'バージョン'), h('span', { className: 'panel-val', 'data-version': true }, version ?? '—'))),
    h('div', { className: 'panel-sec' },
      h('div', { className: 'panel-row' },
        h('span', null, '音量'),
        h('span', { className: 'vol' },
          h('button', {
            type: 'button', className: 'sort-btn mute-btn', 'aria-pressed': settings.mute, 'aria-label': 'ミュート', title: 'ミュート',
            onClick: () => onSettings?.({ mute: !settings.mute }),
          }, h(SpeakerIcon, { muted: settings.mute })),
          h('input', {
            type: 'range', min: 0, max: 100, step: 5, value: settings.volume, disabled: settings.mute, 'aria-label': '音量',
            onChange: (e) => onSettings?.({ volume: Number(e.target.value) }),
            // 動かし終えたら、試しに鳴らす（AC-NT-9）
            onPointerUp: () => onPreview?.('sound'), onKeyUp: () => onPreview?.('sound'),
          }),
          h('span', { className: 'vol-num' }, settings.volume))),
      h('div', { className: 'panel-row' },
        h('span', null, '画面の点滅'),
        h('button', {
          type: 'button', className: 'switch', role: 'switch', 'aria-checked': settings.blink, 'aria-label': '画面の点滅',
          onClick: () => { onSettings?.({ blink: !settings.blink }); if (!settings.blink) onPreview?.('flash') },
        }, h('span', { className: 'knob' }))),
      h('div', { className: 'panel-row' },
        h('span', null, '続ける時間'),
        h('select', {
          className: 'sort-btn', 'aria-label': '点滅と音を続ける時間', value: settings.alertSec, disabled: settings.mute && !settings.blink,
          onChange: (e) => onSettings?.({ alertSec: Number(e.target.value) }),
        }, DURATIONS.map((d) => h('option', { key: d.sec, value: d.sec }, d.label))))),
    h('div', { className: 'panel-sec' },
      h('div', { className: 'panel-row' }, h('span', null, 'Hub'), h('button', { type: 'button', className: 'quit-btn', onClick: onQuit }, '終了…'))))

// Hub を終了する確認のモーダル（AC-UI-31, 34。機能 007、ADR 0020）。開いたとき、フォーカスは「やめる」。Esc・外側のクリックで閉じる
export const QuitDialog = ({ onClose, onShutdown }) => {
  const [phase, setPhase] = useState('confirm') // confirm | sending | done
  const [error, setError] = useState(null)
  const firstButton = useRef(null)
  useEffect(() => { firstButton.current?.focus() }, [phase])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'sending') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, onClose])
  const go = async () => {
    setPhase('sending')
    setError(null)
    const result = await onShutdown?.()
    if (result?.ok) setPhase('done')
    else { setError(result?.reason ?? '終了を要求できませんでした'); setPhase('confirm') }
  }
  return h('div', { className: 'modal-back', 'data-modal': 'quit', onMouseDown: (e) => { if (e.target === e.currentTarget && phase !== 'sending') onClose?.() } },
    h('div', { className: 'modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'quit-title' },
      phase === 'done'
        ? [
          h('h2', { key: 'title', id: 'quit-title' }, 'Hub を終了しました'),
          h('p', { key: 'note', className: 'modal-note', role: 'status' }, '起動するには coders-hub を実行してください。'),
          h('div', { key: 'actions', className: 'modal-actions' }, h('button', { type: 'button', ref: firstButton, onClick: onClose }, '閉じる')),
        ]
        : [
          h('h2', { key: 'title', id: 'quit-title' }, 'Hub を終了しますか？'),
          error && h('p', { key: 'error', className: 'modal-note', role: 'alert' }, error),
          h('div', { key: 'actions', className: 'modal-actions' },
            h('button', { type: 'button', ref: firstButton, disabled: phase === 'sending', onClick: onClose }, 'やめる'),
            h('button', { type: 'button', className: 'danger', disabled: phase === 'sending', onClick: go }, '終了する')),
        ]))
}

export const Sidebar = ({ sessions, ready = true, now, ui, onUi, onRespond, version = null, notify = null, marked = new Map() }) => {
  const tree = buildTree(sessions, ui)
  return h('aside', { className: 'side' },
    h('div', { className: 'side-head' },
      h('div', { className: 'head-row' },
        h('h1', null, 'Coders Hub'),
        h('button', {
          type: 'button', className: 'menu-btn', 'aria-expanded': ui.opts, 'aria-label': 'フィルター・ソート', title: 'フィルター・ソート',
          onClick: () => onUi?.({ opts: !ui.opts }),
        }, h(FilterIcon), ui.onlyControl && h('span', { className: 'dot', 'data-filtering': true })),
        h('button', {
          type: 'button', className: 'menu-btn', 'aria-expanded': ui.menu, 'aria-label': 'メニュー', title: 'メニュー',
          onClick: () => onUi?.({ menu: !ui.menu }),
        }, h(MenuIcon)),
      ),
      ui.opts && h('div', { className: 'panel' },
        h('div', { className: 'panel-sec' },
          h('div', { className: 'panel-row' },
            h('span', null, '操作できるものだけ'),
            h('button', {
              type: 'button', className: 'switch', role: 'switch', 'aria-checked': ui.onlyControl, 'aria-label': '操作できるものだけ',
              onClick: () => onUi?.({ onlyControl: !ui.onlyControl }),
            }, h('span', { className: 'knob' })))),
        h('div', { className: 'panel-sec' },
          h('div', { className: 'panel-row' },
            h('span', null, 'プロジェクト'),
            h(SortButton, { value: ui.dirSort === 'asc', label: 'プロジェクトの並び', onClick: () => onUi?.({ dirSort: ui.dirSort === 'asc' ? 'desc' : 'asc' }) })),
          h('div', { className: 'panel-row' },
            h('span', null, 'セッション'),
            h(SortButton, { value: ui.sessSort === 'early', label: 'セッションの並び', onClick: () => onUi?.({ sessSort: ui.sessSort === 'early' ? 'late' : 'early' }) })),
        ),
      ),
      ui.menu && h(MenuPanel, {
        version, settings: notify?.settings, onSettings: notify?.onSettings, onPreview: notify?.onPreview, onQuit: () => onUi?.({ quit: true }),
      }),
    ),
    h('div', { className: 'side-scroll' },
      tree.length === 0
        // 最初のスナップショットを受け取るまでは、「セッションがありません」を出さない
        ? ready && h('div', { className: 'none', role: 'status' }, sessions.length === 0 ? 'セッションがありません' : '該当するセッションがありません')
        : h('ul', { className: 'tree' },
          tree.map((acc) => h(Node, {
            key: acc.nodeKey, nodeKey: acc.nodeKey, className: 'acct', head: 'band', counts: acc.counts, collapsed: ui.collapsed.has(acc.nodeKey), onToggle: (k) => onUi?.({ toggle: k }),
            name: h('span', { className: 'acc-name', title: acc.key }, acc.name),
            mark: bestMark(acc.projects.flatMap((p) => p.sessions), marked),
          },
          acc.projects.map((p) => h(Node, {
            key: p.key, nodeKey: p.key, className: 'dir', counts: p.counts, collapsed: ui.collapsed.has(p.key), onToggle: (k) => onUi?.({ toggle: k }),
            name: h('span', { className: 'dir-name', title: p.cwd }, p.name),
            mark: bestMark(p.sessions, marked),
          },
          p.sessions.map((s) => h(SessionRow, {
            key: s.sessionId, session: s, elapsedMs: now - s.stateSince, selected: ui.selected === s.sessionId,
            onSelect: (id) => onUi?.({ selected: id, view: 'detail' }), onRespond, markKind: marked.get(s.sessionId) ?? null,
          }))))))),
    ),
  )
}

export const defaultUi = () => ({
  selected: null, view: 'list', opts: false, menu: false, quit: false, onlyControl: false, dirSort: 'asc', sessSort: 'early', collapsed: new Set(),
})

// state: client.mjs の状態、now: 補正済みの現在時刻（ミリ秒）、ui: 画面の状態（defaultUi）、onUi: 画面の状態の変更
export const App = ({ state, now, ui = defaultUi(), onUi, onSend, onCancel, onDismiss, onRespond, onDismissRequest, onShutdown, fetchConversation, notify = null, marked = new Map() }) => {
  // セッションごとのスクロール位置（AC-UI-37）。App は作り直されないので、このまま持ち続けられる
  const scrollPositions = useRef(new Map()).current
  const all = [...state.sessions.values()]
  const selected = ui.selected ? state.sessions.get(ui.selected) ?? null : null
  // 選んでいたセッションが閉じたら、詳細は空にして、スマホでは一覧に戻す
  const view = selected && ui.view === 'detail' ? 'detail' : 'list'
  return h('div', { className: 'shell' },
    !state.connected && h('div', { className: 'banner', role: 'alert' },
      state.ready ? 'Hub との接続が切れました。再接続しています…（表示は最後に受け取った内容です）' : 'Hub に接続しています…'),
    h('div', { className: `app view-${view}${state.connected ? '' : ' stale'}` },
      h(Sidebar, { sessions: all, ready: state.ready, now, ui, onUi, onRespond, version: state.version, notify, marked }),
      h('main', { className: 'main' },
        selected
          ? h(Detail, {
            key: selected.sessionId, session: selected, now, instructions: state.instructions, requestRecords: state.requestRecords,
            onBack: () => onUi?.({ view: 'list' }), fetchConversation, onSend, onCancel, onDismiss, onRespond, onDismissRequest, scrollPositions,
          })
          : h('div', { className: 'empty' },
            h('div', null, h('p', null, h('b', null, 'セッションを選んでください')), h('p', null, `要対応: ${all.filter(isAttention).length} 件`)))),
    ),
    // Hub を終了する確認（モーダル。AC-UI-31）
    ui.quit && h(QuitDialog, { onClose: () => onUi?.({ quit: false }), onShutdown }),
    // 通知の点滅（画面の縁。機能 008）。クリックを通す
    h('div', { id: 'flash', 'aria-hidden': true }),
  )
}
