// 画面の部品（表示のみ。状態は props で受け取る）。JSX は使わず createElement で書く（ビルドなしでテストできる）。
// 仕様: specs/30-features/006-dashboard-layout/spec.md（ADR 0015）。見た目の基準は specs/20-design/screens/mockup/index.html
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CONVERSATION_POLL_MS, INSTRUCTION_LABEL, MAX_INSTRUCTION, PREVIEW_COLLAPSE_CHARS, REQUEST_LABEL, SHORT_LABEL, TOOL_RESULT_LABEL, VIEW_ONLY_LABEL,
  accountName, applyLatest, buildAnswers, buildTree, collapsePreview, deliveredInstructionIds, emptyConversation, emptyDraft, formatClock,
  formatElapsed, formatPrompt, isAttention, isFinal, parsePreview, prependOlder, previewLength, projectName, recordsFor, requestRecordsFor,
  setOther, shortId, sidebarAllowRequest, toggleOption, validateAnswers, validateInstruction, withConversationError,
} from './logic.mjs'

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

// 利用者の発言と応答の本文は、文字として出す（HTML・Markdown を解釈しない。AC-007-6。React が文字として扱う）
export const ConversationMessage = ({ message, running }) => {
  if (message.role === 'tool') {
    const label = message.tool.result ? TOOL_RESULT_LABEL[message.tool.result] : running ? '実行中' : '結果なし'
    return h('div', { className: `tool-line${message.tool.result ? ` tool-${message.tool.result}` : ''}`, 'data-conversation': 'tool' },
      h('span', { className: 'tool-name' }, message.tool.name), h('span', { className: 'tool-result' }, label), h(Time, { at: message.at }))
  }
  if (message.role === 'question') {
    return h('div', { className: 'msg qa', 'data-conversation': 'question' },
      h('small', null, h('span', { className: 'res-tag' }, '質問'), message.tool.result === 'rejected' && h('span', { className: 'tag-pend' }, '拒否'), h(Time, { at: message.at })),
      message.answers.map((a, i) => h('div', { key: i, className: 'qa-item' },
        h('div', { className: 'res-q' }, a.question), a.answer !== null && h('div', { className: 'res-a' }, a.answer))))
  }
  const user = message.role === 'user'
  return h('div', { className: `msg${user ? ' user' : ''}`, 'data-conversation': message.role, 'data-instruction-id': message.instructionId ?? undefined },
    h('small', null, user ? 'あなた' : 'Claude', message.source === 'dashboard' && h('span', { className: 'tag-src' }, 'ダッシュボードから'), h(Time, { at: message.at })),
    message.text,
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
    h('span', { className: 'sl-elapsed' }, formatElapsed(elapsedMs)),
    SHORT_LABEL[session.state] && h('span', { className: `state chip-${session.state}` }, SHORT_LABEL[session.state]),
  )

// ---- 詳細（メイン） ----

// 一番下から離れているとみなす距離（px）
const AWAY_PX = 160

export const Detail = ({ session, now, instructions, requestRecords, fetchConversation, onBack, onSend, onCancel, onDismiss, onRespond, onDismissRequest }) => {
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
  // 結果の行と送った指示は、起きた順に並べる
  const events = [
    ...sent.map((r) => ({ at: r.at ?? 0, node: h(SentMessage, { key: `i-${r.id}`, record: r, onDismiss }) })),
    ...results.map((r) => ({ at: r.at ?? 0, node: h(ResultLine, { key: `r-${r.id}`, record: r, onDismiss: onDismissRequest }) })),
  ].sort((a, b) => a.at - b.at)

  const scrollToBottom = () => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight }
  // 自分の操作や要求の出現（カード・結果・指示）が増えたときは一番下へ。開いたときも一番下へ（AC-UI-23）
  const count = requests.length + events.length + pending.length
  useLayoutEffect(scrollToBottom, [count])
  // 会話の新着は、一番下の近くにいるときだけ一番下へ。上を読んでいるときは動かさない。最初に読み込めたときは、一番下へ
  const newest = conv.messages.at(-1)?.id
  const seen = useRef({ loaded: false, newest: undefined })
  useLayoutEffect(() => {
    const first = !seen.current.loaded && conv.loaded
    if (first || (seen.current.newest !== newest && !awayRef.current)) scrollToBottom()
    seen.current = { loaded: seen.current.loaded || conv.loaded, newest }
  }, [newest, conv.loaded])
  // 「さらに表示」で前に足したときは、いま見ている位置が動かないよう、増えた高さの分だけ足す
  const anchor = useRef(null)
  const oldest = conv.messages[0]?.id
  useLayoutEffect(() => {
    const el = scroller.current
    if (anchor.current && el) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height)
      anchor.current = null
    }
  }, [oldest])
  const more = async () => {
    const el = scroller.current
    if (el) anchor.current = { top: el.scrollTop, height: el.scrollHeight }
    const ok = await loadOlder()
    if (!ok) anchor.current = null
  }
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const isAway = el.scrollHeight - el.scrollTop - el.clientHeight > AWAY_PX
    awayRef.current = isAway
    setAway(isAway)
  }

  // 末尾のツールの行（あとに発言や応答がない）は、実行中として出す
  const tailStart = conv.messages.findLastIndex((m) => m.role !== 'tool') + 1
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
        conv.cursor !== null && h('button', { type: 'button', className: 'btn more', disabled: loadingOlder, onClick: more }, loadingOlder ? '読み込んでいます…' : 'さらに表示'),
        conv.error && (conv.error === 'no-transcript'
          ? conv.messages.length === 0 && h('p', { className: 'conv-note', 'data-conversation-note': 'none' }, '会話の記録がまだありません')
          : h('p', { className: 'conv-note conv-error', role: 'status', 'data-conversation-note': 'error' }, '会話を読み込めません')),
        conv.messages.map((m, i) => h(ConversationMessage, { key: m.id, message: m, running: i >= tailStart })),
        requests.map((r) =>
          r.kind === 'permission'
            ? h(PermissionCard, { key: r.id, sessionId: session.sessionId, request: r, onRespond })
            : h(QuestionCard, { key: r.id, sessionId: session.sessionId, request: r, onRespond })),
        events.map((e) => e.node),
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

// セッションの行（AC-UI-11〜14, 17, 18）。1 行目: ID・経過時間・札、2 行目: 直近の発言
export const SessionRow = ({ session, elapsedMs, selected, onSelect, onRespond }) => {
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

const Node = ({ nodeKey, className, head, name, counts, collapsed, onToggle, children }) =>
  h('li', { className: `${className}${collapsed ? ' collapsed' : ''}`, 'data-node': nodeKey },
    h('button', { type: 'button', className: `node-head${head ? ` ${head}` : ''}`, 'aria-expanded': !collapsed, onClick: () => onToggle?.(nodeKey) },
      h('span', { className: 'caret', 'aria-hidden': true }, '▾'),
      name,
      h('span', { className: 'node-total' }, counts.total),
      h(Badges, { counts }),
    ),
    // 折りたたんでいる間は、中身を描画しない
    !collapsed && h('ul', null, children),
  )

const SortButton = ({ value, onClick, label }) =>
  h('button', { type: 'button', className: 'sort-btn', onClick, 'aria-label': label }, value ? '↑ 昇順' : '↓ 降順')

export const Sidebar = ({ sessions, ready = true, now, ui, onUi, onRespond }) => {
  const tree = buildTree(sessions, ui)
  return h('aside', { className: 'side' },
    h('div', { className: 'side-head' },
      h('div', { className: 'head-row' },
        h('h1', null, 'Coders Hub'),
        h('button', {
          type: 'button', className: 'menu-btn', 'aria-expanded': ui.opts, 'aria-label': 'フィルター・ソート', title: 'フィルター・ソート',
          onClick: () => onUi?.({ opts: !ui.opts }),
        }, h(FilterIcon), ui.onlyControl && h('span', { className: 'dot', 'data-filtering': true })),
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
    ),
    h('div', { className: 'side-scroll' },
      tree.length === 0
        // 最初のスナップショットを受け取るまでは、「セッションがありません」を出さない
        ? ready && h('div', { className: 'none', role: 'status' }, sessions.length === 0 ? 'セッションがありません' : '該当するセッションがありません')
        : h('ul', { className: 'tree' },
          tree.map((acc) =>
            h(Node, {
              key: acc.nodeKey, nodeKey: acc.nodeKey, className: 'acct', head: 'band', counts: acc.counts, collapsed: ui.collapsed.has(acc.nodeKey), onToggle: (k) => onUi?.({ toggle: k }),
              name: h('span', { className: 'acc-name', title: acc.key }, acc.name),
            },
            acc.projects.map((p) =>
              h(Node, {
                key: p.key, nodeKey: p.key, className: 'dir', counts: p.counts, collapsed: ui.collapsed.has(p.key), onToggle: (k) => onUi?.({ toggle: k }),
                name: h('span', { className: 'dir-name', title: p.cwd }, p.name),
              },
              p.sessions.map((s) => h(SessionRow, {
                key: s.sessionId, session: s, elapsedMs: now - s.stateSince, selected: ui.selected === s.sessionId,
                onSelect: (id) => onUi?.({ selected: id, view: 'detail' }), onRespond,
              }))))))),
    ),
  )
}

export const defaultUi = () => ({
  selected: null, view: 'list', opts: false, onlyControl: false, dirSort: 'asc', sessSort: 'early', collapsed: new Set(),
})

// state: client.mjs の状態、now: 補正済みの現在時刻（ミリ秒）、ui: 画面の状態（defaultUi）、onUi: 画面の状態の変更
export const App = ({ state, now, ui = defaultUi(), onUi, onSend, onCancel, onDismiss, onRespond, onDismissRequest, fetchConversation }) => {
  const all = [...state.sessions.values()]
  const selected = ui.selected ? state.sessions.get(ui.selected) ?? null : null
  // 選んでいたセッションが閉じたら、詳細は空にして、スマホでは一覧に戻す
  const view = selected && ui.view === 'detail' ? 'detail' : 'list'
  return h('div', { className: 'shell' },
    !state.connected && h('div', { className: 'banner', role: 'alert' },
      state.ready ? 'Hub との接続が切れました。再接続しています…（表示は最後に受け取った内容です）' : 'Hub に接続しています…'),
    h('div', { className: `app view-${view}${state.connected ? '' : ' stale'}` },
      h(Sidebar, { sessions: all, ready: state.ready, now, ui, onUi, onRespond }),
      h('main', { className: 'main' },
        selected
          ? h(Detail, {
            key: selected.sessionId, session: selected, now, instructions: state.instructions, requestRecords: state.requestRecords,
            onBack: () => onUi?.({ view: 'list' }), fetchConversation, onSend, onCancel, onDismiss, onRespond, onDismissRequest,
          })
          : h('div', { className: 'empty' },
            h('div', null, h('p', null, h('b', null, 'セッションを選んでください')), h('p', null, `要対応: ${all.filter(isAttention).length} 件`)))),
    ),
  )
}
