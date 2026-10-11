// Claude の応答の Markdown の整形（機能 004、ADR 0017）。AC-007-6
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, renderMarkdown } from '../src/web/markdown.mjs'

const html = (text) => renderToStaticMarkup(h(Markdown, { text }))

describe('Markdown の整形（AC-007-6）', () => {
  it('見出し・段落・強調・取り消し線', () => {
    const out = html('# 大見出し\n\n本文の **太字** と *斜体* と ~~消す~~')
    assert.match(out, /class="md-h md-h1"[^>]*>大見出し</)
    assert.match(out, /<strong>太字<\/strong>/)
    assert.match(out, /<em>斜体<\/em>/)
    assert.match(out, /<del>消す<\/del>/)
  })

  it('箇条書き（順序つき・入れ子・タスク）', () => {
    const out = html('- 一つ目\n  - 入れ子\n- 二つ目\n\n1. はじめ\n2. つぎ\n\n- [x] 済み\n- [ ] 未')
    assert.equal((out.match(/<ul/g) ?? []).length, 3)
    assert.match(out, /<ol/)
    assert.match(out, /class="md-task"/)
    assert.match(out, /type="checkbox"[^>]*checked=""/)
  })

  it('コードブロック（言語つき）とインラインコード。ブロックの中の Markdown は解釈しない', () => {
    const out = html('`code` と\n\n```js\nconst a = **b**\n```')
    assert.match(out, /<code class="md-code">code<\/code>/)
    assert.match(out, /<pre class="md-pre" data-lang="js"><span class="md-lang">js<\/span><code>const a = \*\*b\*\*<\/code><\/pre>/)
  })

  it('引用・区切り線・表（配置つき）', () => {
    const out = html('> 引用\n\n---\n\n| 名前 | 値 |\n|:--|--:|\n| a | 1 |')
    assert.match(out, /<blockquote class="md-quote">/)
    assert.match(out, /<hr class="md-hr"\/>/)
    assert.match(out, /<th style="text-align:left">名前<\/th>/)
    assert.match(out, /<td style="text-align:right">1<\/td>/)
    assert.match(out, /class="md-table-wrap"/)
  })

  it('改行は保たれる（単独の改行も <br>）', () => {
    assert.match(html('一行目\n二行目'), /一行目<br\/>二行目/)
  })

  it('リンクは http(s)・mailto だけ。新しいタブで開き、opener を渡さない。javascript: などはリンクにしない', () => {
    const out = html('[安全](https://example.com/a) [危険](javascript:alert(1)) [メール](mailto:a@example.com) [データ](data:text/html,x)')
    assert.match(out, /<a href="https:\/\/example.com\/a" target="_blank" rel="noopener noreferrer"/)
    assert.match(out, /href="mailto:a@example.com"/)
    assert.doesNotMatch(out, /javascript:|data:text/)
    assert.match(out, /危険/)
  })

  it('画像は読み込まない（代わりの文字だけを出す）', () => {
    const out = html('![図の説明](https://example.com/x.png)')
    assert.doesNotMatch(out, /<img|src=/)
    assert.match(out, /図の説明/)
  })

  it('文章の中の HTML は、解釈されず、文字として出る（スクリプト・イベント属性・iframe）', () => {
    const out = html('<script>alert(1)</script>\n\n文中の <b onclick="x()">タグ</b> と <iframe src="x"></iframe>\n\n<div>ブロック</div>')
    for (const re of [/<script/, /<b /, /<iframe/, /<div>/, /onclick="x/]) assert.doesNotMatch(out, re)
    assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(out, /&lt;b onclick=&quot;x\(\)&quot;&gt;/)
  })

  it('壊れた Markdown・空の本文でも、例外にならない', () => {
    assert.doesNotThrow(() => html('```\n閉じていない\n\n| 表 |\n|--'))
    assert.doesNotThrow(() => html(''))
    assert.doesNotThrow(() => html(null))
    assert.ok(renderMarkdown('**x'))
  })

  it('長い 1 語やコードは、そのまま保たれる（折り返しは CSS）', () => {
    const long = 'a'.repeat(300)
    assert.match(html(`長い ${long}`), new RegExp(long))
  })
})
