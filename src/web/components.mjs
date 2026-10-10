// 画面の部品（表示のみ。状態は props で受け取る）。JSX は使わず createElement で書く（ビルドなしでテストできる）。
import { createElement as h, useState } from 'react'
import {
  INSTRUCTION_LABEL, MAX_INSTRUCTION, NOT_CONTROLLABLE_REASON, PREVIEW_COLLAPSE_CHARS, REQUEST_LABEL, STATE_LABEL, buildAnswers,
  collapsePreview, countStates, emptyDraft, formatElapsed, formatPrompt, groupByAccount, holdNotice, isFinal, parsePreview,
  previewLength, projectName, recordsFor, requestRecordsFor, setOther, shortId, toggleOption, validateAnswers, validateInstruction,
} from './logic.mjs'

const FILTERS = [
  { value: 'all', label: 'すべて' },
  { value: 'attention', label: '要対応のみ' },
]

export const Summary = ({ counts, filter, onFilter }) =>
  h('header', { className: 'summary' },
    h('h1', null, 'Coders Hub'),
    h('div', { className: 'counts', 'aria-label': '件数' },
      h('span', { className: 'count count-permission', 'data-count': 'permission' }, `許可待ち ${counts.permission}`),
      h('span', { className: 'count count-question', 'data-count': 'question' }, `質問待ち ${counts.question}`),
      h('span', { className: 'count count-waiting', 'data-count': 'waiting' }, `返答待ち ${counts.waiting}`),
      h('span', { className: 'count count-working', 'data-count': 'working' }, `作業中 ${counts.working}`),
    ),
    h('div', { className: 'filters', role: 'group', 'aria-label': '表示の絞り込み' },
      FILTERS.map((f) =>
        h('button', {
          key: f.value, type: 'button', className: 'filter', 'aria-pressed': filter === f.value,
          onClick: () => onFilter?.(f.value),
        }, f.label)),
    ),
  )

// 指示の入力欄（AC-002-1, 002-4, 002-5）。操作できないセッションでは、理由だけを出す
export const Composer = ({ session, onSend }) => {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!session.controllable) {
    return h('p', { className: 'hint', 'data-hint': 'not-controllable' }, NOT_CONTROLLABLE_REASON)
  }
  const checked = validateInstruction(text)
  const over = text.length > MAX_INSTRUCTION
  const notice = holdNotice(session)
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
  return h('div', { className: 'composer' },
    notice && h('p', { className: 'hint', 'data-hint': 'hold' }, notice),
    h('textarea', {
      className: 'composer-input', rows: 3, value: text, 'aria-label': '指示', placeholder: 'このセッションへの指示（Ctrl+Enter で送信）',
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent?.isComposing) { e.preventDefault(); submit() }
      },
    }),
    h('div', { className: 'composer-actions' },
      h('span', { className: over ? 'counter counter-over' : 'counter' }, `${text.length} / ${MAX_INSTRUCTION}`),
      !checked.ok && text.trim() !== '' && h('span', { className: 'hint', 'data-hint': 'invalid' }, checked.reason),
      h('button', { type: 'button', className: 'send', disabled: !checked.ok || busy, onClick: submit }, busy ? '送信中…' : '送信'),
    ),
  )
}

// 保留中の指示と、送った指示の結果（AC-002-6, 003-3）
export const Instructions = ({ pending, records, onCancel, onDismiss, sessionId }) =>
  h('ul', { className: 'instructions' },
    pending.map((p) =>
      h('li', { key: `p-${p.id}`, className: 'instruction instruction-held', 'data-instruction-status': 'held' },
        h('span', { className: 'instruction-status' }, INSTRUCTION_LABEL.held),
        h('span', { className: 'instruction-text', title: p.preview }, p.preview),
        h('button', { type: 'button', className: 'instruction-action', onClick: () => onCancel?.(sessionId, p.id) }, '取り消し'),
      )),
    // 保留中のものは pending 側に出すので、ここでは出さない
    records.filter((r) => r.status !== 'held').map((r) =>
      h('li', { key: `r-${r.id}`, className: `instruction instruction-${r.status}`, 'data-instruction-status': r.status },
        h('span', { className: 'instruction-status' }, INSTRUCTION_LABEL[r.status] ?? r.status),
        h('span', { className: 'instruction-text', title: r.preview ?? '' }, r.preview ?? ''),
        r.reason && h('span', { className: 'instruction-reason' }, r.reason),
        isFinal(r.status) && h('button', {
          type: 'button', className: 'instruction-action', 'aria-label': '結果を閉じる', onClick: () => onDismiss?.(r.id),
        }, '×'),
      )),
  )

// 許可要求の入力の表示（AC-004-1）。長いときは折りたたむ。claude が省略して渡したときは、省略があることと文字数を示す
export const RequestInput = ({ preview }) => {
  const [expanded, setExpanded] = useState(false)
  const { omitted } = parsePreview(preview)
  const long = previewLength(preview) > PREVIEW_COLLAPSE_CHARS
  const shown = expanded || !long ? preview : collapsePreview(preview)
  return h('div', { className: 'request-input-wrap' },
    h('pre', { className: 'request-input', 'data-collapsed': long && !expanded }, shown),
    omitted > 0 && h('p', { className: 'hint', 'data-hint': 'elided' },
      `入力が長いため、途中が省略されています（省略: ${omitted} 文字）。全文は確認できません。内容に確信が持てないときは、拒否してください`),
    long && h('button', { type: 'button', className: 'request-toggle', 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) },
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
  return h('li', { className: 'request request-permission', 'data-request-kind': 'permission', 'data-request-id': request.id },
    h('div', { className: 'request-head' },
      h('span', { className: 'request-tool' }, request.toolName),
      request.description && h('span', { className: 'request-description' }, request.description),
    ),
    h(RequestInput, { preview: request.inputPreview }),
    h('div', { className: 'request-actions' },
      h('button', { type: 'button', className: 'allow', disabled: busy, onClick: () => answer('allow') }, '許可'),
      h('button', { type: 'button', className: 'deny', disabled: busy, onClick: () => answer('deny') }, '拒否'),
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
  return h('li', { className: 'request request-question', 'data-request-kind': 'question', 'data-request-id': request.id },
    questions.map((q, qi) =>
      h('fieldset', { key: qi, className: 'question', 'data-multi': q.multiSelect },
        h('legend', null,
          q.header && h('span', { className: 'question-header' }, q.header),
          h('span', { className: 'question-text' }, q.question),
          q.multiSelect && h('span', { className: 'hint' }, '（複数選択）'),
        ),
        q.options.map((o, oi) =>
          h('label', { key: oi, className: 'option' },
            h('input', {
              type: q.multiSelect ? 'checkbox' : 'radio', name: `${request.id}-${qi}`, checked: draft[qi].selected.includes(o.label),
              onChange: () => setDraft(toggleOption(draft, qi, q, o.label)),
            }),
            h('span', { className: 'option-label' }, o.label),
            o.description && h('span', { className: 'option-description' }, o.description),
          )),
        h('label', { className: 'option option-other' },
          h('span', { className: 'option-label' }, 'その他'),
          h('input', {
            type: 'text', className: 'other-input', 'aria-label': `${q.header || q.question}の自由入力`, value: draft[qi].other,
            onChange: (e) => setDraft(setOther(draft, qi, q, e.target.value)),
          }),
        ),
      )),
    h('div', { className: 'request-actions' },
      h('button', { type: 'button', className: 'send', disabled: !checked.ok || busy, onClick: submit }, busy ? '送信中…' : '回答する'),
      !checked.ok && h('span', { className: 'hint', 'data-hint': 'invalid' }, checked.reason),
      error && h('span', { className: 'hint request-error', role: 'alert' }, error),
    ),
  )
}

// 応答待ちの要求と、閉じた要求の結果（AC-005-5, 005-6）
export const Requests = ({ sessionId, requests, records, onRespond, onDismiss }) =>
  h('ul', { className: 'requests' },
    requests.map((r) =>
      r.kind === 'permission'
        ? h(PermissionCard, { key: r.id, sessionId, request: r, onRespond })
        : h(QuestionCard, { key: r.id, sessionId, request: r, onRespond })),
    records.map((r) =>
      h('li', { key: `r-${r.id}`, className: `request-result request-result-${r.status}`, 'data-request-status': r.status },
        h('span', { className: 'request-status' }, REQUEST_LABEL[r.status] ?? r.status),
        r.summary && h('span', { className: 'request-summary', title: r.summary }, r.summary),
        r.reason && h('span', { className: 'instruction-reason' }, r.reason),
        h('button', { type: 'button', className: 'instruction-action', 'aria-label': '結果を閉じる', onClick: () => onDismiss?.(r.id) }, '×'),
      )),
  )

export const Row = ({ session, elapsedMs, records = [], requestRecords = [], onSend, onCancel, onDismiss, onRespond, onDismissRequest }) => {
  const [open, setOpen] = useState(false)
  const prompt = formatPrompt(session.lastPrompt)
  const pending = session.pending ?? []
  const requests = session.requests ?? []
  const shown = records.filter((r) => r.status !== 'held')
  return h('li', {
    className: `row state-${session.state}`, 'data-state': session.state, 'data-session-id': session.sessionId,
  },
    h('span', { className: 'badge' }, STATE_LABEL[session.state] ?? session.state),
    h('span', { className: 'elapsed' }, formatElapsed(elapsedMs)),
    h('span', { className: 'project', title: session.cwd ?? '' }, projectName(session.cwd)),
    prompt
      ? h('span', { className: 'prompt', title: session.lastPrompt }, prompt)
      : h('span', { className: 'prompt prompt-empty' }, '（発言なし）'),
    h('code', { className: 'session-id', title: session.sessionId }, shortId(session.sessionId)),
    h('button', {
      type: 'button', className: session.controllable ? 'send-toggle' : 'send-toggle send-toggle-off', 'aria-expanded': open,
      onClick: () => setOpen(!open),
    }, '指示を送る'),
    (open || pending.length > 0 || shown.length > 0 || requests.length > 0 || requestRecords.length > 0) && h('div', { className: 'row-extra' },
      (requests.length > 0 || requestRecords.length > 0) &&
        h(Requests, { sessionId: session.sessionId, requests, records: requestRecords, onRespond, onDismiss: onDismissRequest }),
      open && h(Composer, { session, onSend }),
      (pending.length > 0 || shown.length > 0) &&
        h(Instructions, { pending, records: shown, onCancel, onDismiss, sessionId: session.sessionId }),
    ),
  )
}

export const Group = ({ group, collapsed, onToggle, now, instructions, requestRecords, onSend, onCancel, onDismiss, onRespond, onDismissRequest }) => {
  const { counts } = group
  return h('section', { className: 'group', 'data-account': group.key },
    h('button', {
      type: 'button', className: 'group-header', 'aria-expanded': !collapsed, onClick: () => onToggle?.(group.key),
    },
      h('span', { className: 'chevron', 'aria-hidden': true }, collapsed ? '▸' : '▾'),
      h('span', { className: 'group-name', title: group.key }, group.name),
      h('span', { className: 'group-total' }, `${counts.total} 件`),
      // 折りたたんでいても要対応の件数を見せる（AC-008-4）
      counts.permission > 0 && h('span', { className: 'chip chip-permission' }, `許可待ち ${counts.permission}`),
      counts.question > 0 && h('span', { className: 'chip chip-question' }, `質問待ち ${counts.question}`),
      counts.waiting > 0 && h('span', { className: 'chip chip-waiting' }, `返答待ち ${counts.waiting}`),
    ),
    !collapsed && h('ul', { className: 'rows' },
      group.sessions.map((s) => h(Row, {
        key: s.sessionId, session: s, elapsedMs: now - s.stateSince,
        records: instructions ? recordsFor(instructions, s.sessionId) : [],
        requestRecords: requestRecords ? requestRecordsFor(requestRecords, s.sessionId) : [],
        onSend, onCancel, onDismiss, onRespond, onDismissRequest,
      }))),
  )
}

// state: client.mjs の状態、now: 補正済みの現在時刻（ミリ秒）
export const App = ({ state, now, filter, collapsed = new Set(), onFilter, onToggle, onSend, onCancel, onDismiss, onRespond, onDismissRequest }) => {
  const sessions = [...state.sessions.values()]
  const counts = countStates(sessions)
  const groups = groupByAccount(sessions, filter)
  return h('div', { className: 'app' },
    h(Summary, { counts, filter, onFilter }),
    !state.connected && h('div', { className: 'banner', role: 'alert' },
      state.ready ? 'Hub との接続が切れました。再接続しています…（表示は最後に受け取った内容です）' : 'Hub に接続しています…'),
    h('main', { className: state.connected ? 'groups' : 'groups stale' },
      !state.ready
        ? null
        : sessions.length === 0
          ? h('p', { className: 'empty' }, 'セッションがありません')
          : groups.length === 0
            ? h('p', { className: 'empty' }, '要対応のセッションはありません')
            : groups.map((g) => h(Group, {
              key: g.key, group: g, collapsed: collapsed.has(g.key), onToggle, now,
              instructions: state.instructions, requestRecords: state.requestRecords, onSend, onCancel, onDismiss, onRespond, onDismissRequest,
            }))),
  )
}
