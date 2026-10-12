// セットアップの文面は、spec（setup-flow.md）が正。steps.mjs の出力と一致することを確かめる（ADR 0027）。AC-011-8
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildSetupSteps, renderSteps } from '../src/setup/steps.mjs'

const FLOW = fs.readFileSync(new URL('../specs/30-features/007-distribution/setup-flow.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// setup-flow.md を読む。`### 番号. id: 見出し` の直後の、1 つ目のコードブロックが本文、2 つ目がコピーできる内容
const parseFlow = (text) => {
  const sections = text.split(/^### /m).slice(1)
  return sections.map((raw) => {
    const section = raw.split(/^## /m)[0] // 最後の手順の後ろに、別の節が続くときは、そこまで
    const [head] = section.split('\n', 1)
    const m = head.match(/^(\d+)\. ([\w-]+): (.+)$/)
    assert.ok(m, `見出しの形が違う: ${head}`)
    const blocks = [...section.matchAll(/```\w*\n([\s\S]*?)\n```/g)].map((b) => b[1])
    assert.ok(blocks.length >= 1 && blocks.length <= 2, `${m[2]}: コードブロックは 1〜2 個（本文・コピー）`)
    return { number: Number(m[1]), id: m[2], title: m[3], body: blocks[0].split('\n'), copy: blocks[1] }
  })
}

// 「## 例の前提」の値（exe のパス・ポート）
const parsePremise = (text) => {
  const section = text.split(/^## 例の前提/m)[1]?.split(/^## /m)[0] ?? ''
  const pick = (label) => section.match(new RegExp(`^- ${label}: \`([^\`]+)\``, 'm'))?.[1]
  const premise = { exePath: pick('exe のパス'), internalPort: Number(pick('内部 API のポート')), uiPort: Number(pick('画面のポート')) }
  assert.ok(premise.exePath && premise.internalPort && premise.uiPort, '「例の前提」に、exe のパス・ポートがある')
  return premise
}

const MARK = '[配布版のみ] '
const toStep = (step) => ({ id: step.id, title: step.title, body: step.body, ...(step.copy === undefined ? {} : { copy: step.copy }) })

describe('setup-flow.md と steps.mjs の一致（ADR 0027）', () => {
  const flow = parseFlow(FLOW)
  const premise = parsePremise(FLOW)

  it('手順の番号は、1 から順に並ぶ', () => {
    assert.deepEqual(flow.map((s) => s.number), flow.map((_, i) => i + 1))
    assert.ok(flow.length >= 1)
  })

  it('配布版: 見出し・本文・コピーできる内容が、すべて一致する（「配布版のみ」の印は、表示に含めない）', () => {
    const expected = flow.map((step) => toStep({ ...step, body: step.body.map((l) => (l.startsWith(MARK) ? l.slice(MARK.length) : l)) }))
    assert.deepEqual(buildSetupSteps(premise), expected)
  })

  it('開発時（exe なし）: 「配布版のみ」の行が出ない。見出しと本文は、ほかの行が一致し（登録のコマンドの行だけは、node で起動するファイルを指す）、コピーできる内容の有無も同じ', () => {
    const dev = buildSetupSteps({ paths: { hook: 'D:\\x\\hook.mjs', askHook: 'D:\\x\\ask-hook.mjs', channel: 'D:\\x\\channel.mjs' }, uiPort: premise.uiPort, internalPort: premise.internalPort })
    const isAdd = (line) => /^\s*claude mcp add /.test(line)
    const mask = (lines) => lines.map((l) => (isAdd(l) ? '<claude mcp add>' : l))
    assert.deepEqual(dev.map((s) => [s.id, s.title, mask(s.body)]), flow.map((s) => [s.id, s.title, mask(s.body.filter((l) => !l.startsWith(MARK)))]))
    assert.ok(dev.find((s) => s.id === 'register').body.some((l) => l.trim() === 'claude mcp add --scope user coders-hub -- node "D:\\x\\channel.mjs" --channel'))
    assert.deepEqual(dev.map((s) => s.copy !== undefined), flow.map((s) => s.copy !== undefined))
  })

  it('例の前提のとおり、登録のコマンド（本文の、項目の下）と、フックの JSON に、exe のパスが入っている（具体的な値のまま、書いてある）', () => {
    const register = flow.find((s) => s.id === 'register')
    const commands = register.body.filter((l) => /^\s+(\$env:|claude )/.test(l)).map((l) => l.trim())
    assert.deepEqual(commands, [
      '$env:CLAUDE_CONFIG_DIR = "$HOME\\.claude-account"',
      `claude mcp add --scope user coders-hub -- "${premise.exePath}" channel --channel`,
      'claude mcp list',
      'claude mcp remove --scope user coders-hub',
    ])
    assert.equal(register.copy, undefined, '登録の手順は、項目の下にコマンドを書く。まとめてコピーするブロックは、置かない')
    const exe = premise.exePath.replaceAll('\\', '/')
    const { hooks } = JSON.parse(flow.find((s) => s.id === 'hooks').copy)
    assert.equal(hooks.Stop[0].hooks[0].command, `"${exe}" hook`)
    assert.equal(hooks.PermissionRequest[1].hooks[0].command, `"${exe}" ask-hook`)
    assert.equal(hooks.PermissionRequest[1].matcher, 'AskUserQuestion')
  })

  it('フックの枠: 1 行が 1 イベント（6 イベント）で、そのまま貼れる。{ "hooks": { ... } } の形で、先頭は { と "hooks": {', () => {
    const lines = flow.find((s) => s.id === 'hooks').copy.split('\n')
    assert.deepEqual([lines[0], lines[1], lines.at(-2), lines.at(-1)], ['{', '  "hooks": {', '  }', '}'])
    assert.equal(lines.length - 4, 6, 'イベントは 6 行')
    for (const line of lines.slice(2, -2)) assert.match(line, /^ {4}"\w+": \[.*\],?$/)
  })

  it('setup のテキストは、手順を「# 番号. 見出し」で並べたもの', () => {
    const text = renderSteps(buildSetupSteps(premise))
    flow.forEach((s) => assert.ok(text.includes(`# ${s.number}. ${s.title}`)))
  })
})
