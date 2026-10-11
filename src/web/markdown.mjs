// Claude の応答の Markdown を、React の要素に整形する（機能 004、ADR 0017）。
// marked は字句解析（トークン化）にだけ使い、HTML は作らない。画面には、トークンから React の要素を組み立てて出す
// （dangerouslySetInnerHTML を使わない）ので、文章の中の HTML は、解釈されず、文字として出る（AC-007-6）。
import { createElement as h, memo, useMemo } from 'react'
import { marked } from 'marked'

// リンクは http(s) と mailto だけ。javascript: などは、リンクにせず、文字だけを出す
const safeHref = (href) => (/^(https?:\/\/|mailto:)/i.test(String(href ?? '').trim()) ? String(href).trim() : null)

const inline = (tokens, key = '') => (tokens ?? []).map((t, i) => renderInline(t, `${key}${i}`))

function renderInline(t, key) {
  switch (t.type) {
    case 'strong': return h('strong', { key }, inline(t.tokens, `${key}.`))
    case 'em': return h('em', { key }, inline(t.tokens, `${key}.`))
    case 'del': return h('del', { key }, inline(t.tokens, `${key}.`))
    case 'codespan': return h('code', { key, className: 'md-code' }, t.text)
    case 'br': return h('br', { key })
    case 'link': {
      const href = safeHref(t.href)
      const children = inline(t.tokens, `${key}.`)
      return href ? h('a', { key, href, target: '_blank', rel: 'noopener noreferrer', className: 'md-link' }, children) : h('span', { key }, children)
    }
    case 'image': return h('span', { key, className: 'md-image' }, t.text || t.href) // 画像は読み込まない。代わりの文字だけを出す
    case 'escape': return t.text
    case 'html': return t.raw // 文章の中の HTML は、解釈せず、文字として出す
    case 'text': return t.tokens?.length ? h('span', { key }, inline(t.tokens, `${key}.`)) : (t.text ?? '')
    default: return t.raw ?? ''
  }
}

const HEADING_LEVEL = (depth) => `md-h md-h${Math.min(depth, 4)}`

function renderBlock(t, key) {
  switch (t.type) {
    case 'space': return null
    case 'heading': return h('div', { key, className: HEADING_LEVEL(t.depth), role: 'heading', 'aria-level': Math.min(t.depth + 2, 6) }, inline(t.tokens, `${key}.`))
    case 'paragraph': return h('p', { key, className: 'md-p' }, inline(t.tokens, `${key}.`))
    case 'text': return h('p', { key, className: 'md-p' }, t.tokens ? inline(t.tokens, `${key}.`) : t.text)
    case 'code':
      return h('pre', { key, className: 'md-pre', 'data-lang': t.lang || undefined }, t.lang && h('span', { className: 'md-lang' }, t.lang), h('code', null, t.text))
    case 'blockquote': return h('blockquote', { key, className: 'md-quote' }, blocks(t.tokens, `${key}.`))
    case 'hr': return h('hr', { key, className: 'md-hr' })
    case 'list': {
      const Tag = t.ordered ? 'ol' : 'ul'
      return h(Tag, { key, className: 'md-list', start: t.ordered && t.start !== 1 ? t.start : undefined },
        t.items.map((item, i) => h('li', { key: i, className: item.task ? 'md-task' : undefined },
          item.task && h('input', { type: 'checkbox', checked: Boolean(item.checked), readOnly: true, disabled: true, 'aria-label': item.checked ? '完了' : '未完了' }),
          blocks(item.tokens, `${key}.${i}.`))))
    }
    case 'table':
      return h('div', { key, className: 'md-table-wrap' },
        h('table', { className: 'md-table' },
          h('thead', null, h('tr', null, t.header.map((c, i) => h('th', { key: i, style: { textAlign: t.align[i] ?? undefined } }, inline(c.tokens, `${key}.h${i}.`))))),
          h('tbody', null, t.rows.map((row, r) => h('tr', { key: r }, row.map((c, i) => h('td', { key: i, style: { textAlign: t.align[i] ?? undefined } }, inline(c.tokens, `${key}.${r}.${i}.`))))))))
    case 'html': return h('p', { key, className: 'md-p' }, t.raw) // HTML は、解釈せず、文字として出す
    case 'def': return null
    default: return t.raw ? h('p', { key, className: 'md-p' }, t.raw) : null
  }
}

const blocks = (tokens, key = '') => (tokens ?? []).map((t, i) => renderBlock(t, `${key}${i}`)).filter(Boolean)

// 字句解析。壊れた入力でも、例外にせず、文字のまま出す
export const lex = (text) => {
  try {
    return marked.lexer(String(text ?? ''), { gfm: true, breaks: true })
  } catch {
    return null
  }
}

export const renderMarkdown = (text) => {
  const tokens = lex(text)
  return tokens ? blocks(tokens) : h('p', { className: 'md-p' }, String(text ?? ''))
}

// メッセージの本文。同じ本文は、再描画のたびに、解析し直さない
export const Markdown = memo(({ text }) => {
  const content = useMemo(() => renderMarkdown(text), [text])
  return h('div', { className: 'md' }, content)
})
