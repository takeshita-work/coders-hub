// 検証スパイク用（使い捨て）: probe-channels.mjs の許可中継を操作する。
// 使い方:
//   node spikes/probe-verdict.mjs state                 保留中の許可要求の一覧
//   node spikes/probe-verdict.mjs allow [request_id]    許可（ID を省略すると最新の要求）
//   node spikes/probe-verdict.mjs deny  [request_id]    拒否
const BASE = 'http://127.0.0.1:8770'
const [cmd, idArg] = process.argv.slice(2)

const state = async () => (await (await fetch(BASE + '/state')).json()).pending

if (cmd === 'state') {
  console.log(JSON.stringify(await state(), null, 2))
} else if (cmd === 'allow' || cmd === 'deny') {
  const id = idArg ?? (await state()).at(-1)?.request_id
  if (!id) {
    console.log('保留中の許可要求がありません')
    process.exit(1)
  }
  const res = await fetch(BASE + '/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: id, behavior: cmd }),
  })
  console.log(res.status, cmd, id)
} else {
  console.log('使い方: node spikes/probe-verdict.mjs <state|allow|deny> [request_id]')
  process.exit(1)
}
