// 画面の部品（表示のみ。状態は props で受け取る）。JSX は使わず createElement で書く（ビルドなしでテストできる）。
import { createElement as h, useState } from 'react'
import {
  INSTRUCTION_LABEL, MAX_INSTRUCTION, NOT_CONTROLLABLE_REASON, STATE_LABEL, countStates, formatElapsed, formatPrompt, groupByAccount,
  holdNotice, isFinal, projectName, recordsFor, shortId, validateInstruction,
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

export const Row = ({ session, elapsedMs, records = [], onSend, onCancel, onDismiss }) => {
  const [open, setOpen] = useState(false)
  const prompt = formatPrompt(session.lastPrompt)
  const pending = session.pending ?? []
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
    (open || pending.length > 0 || shown.length > 0) && h('div', { className: 'row-extra' },
      open && h(Composer, { session, onSend }),
      (pending.length > 0 || shown.length > 0) &&
        h(Instructions, { pending, records: shown, onCancel, onDismiss, sessionId: session.sessionId }),
    ),
  )
}

export const Group = ({ group, collapsed, onToggle, now, instructions, onSend, onCancel, onDismiss }) => {
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
        onSend, onCancel, onDismiss,
      }))),
  )
}

// state: client.mjs の状態、now: 補正済みの現在時刻（ミリ秒）
export const App = ({ state, now, filter, collapsed = new Set(), onFilter, onToggle, onSend, onCancel, onDismiss }) => {
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
              instructions: state.instructions, onSend, onCancel, onDismiss,
            }))),
  )
}
