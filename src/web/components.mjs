// 画面の部品（表示のみ。状態は props で受け取る）。JSX は使わず createElement で書く（ビルドなしでテストできる）。
import { createElement as h } from 'react'
import {
  STATE_LABEL, countStates, formatElapsed, formatPrompt, groupByAccount, projectName, shortId,
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

export const Row = ({ session, elapsedMs }) => {
  const prompt = formatPrompt(session.lastPrompt)
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
  )
}

export const Group = ({ group, collapsed, onToggle, now }) => {
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
      counts.waiting > 0 && h('span', { className: 'chip chip-waiting' }, `返答待ち ${counts.waiting}`),
    ),
    !collapsed && h('ul', { className: 'rows' },
      group.sessions.map((s) => h(Row, { key: s.sessionId, session: s, elapsedMs: now - s.stateSince }))),
  )
}

// state: client.mjs の状態、now: 補正済みの現在時刻（ミリ秒）
export const App = ({ state, now, filter, collapsed = new Set(), onFilter, onToggle }) => {
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
            : groups.map((g) => h(Group, { key: g.key, group: g, collapsed: collapsed.has(g.key), onToggle, now }))),
  )
}
