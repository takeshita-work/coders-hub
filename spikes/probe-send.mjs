// 検証スパイク用（使い捨て）: probe-channels.mjs の /send へ、検証用の通知を送る。
// 使い方: node spikes/probe-send.mjs <meta|order|special|long|plain> [本文]
const BASE = 'http://127.0.0.1:8770'
const send = async (content, meta) => {
  const res = await fetch(BASE + '/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, meta }),
  })
  console.log(res.status, JSON.stringify(content).slice(0, 80), meta ? JSON.stringify(meta) : '')
}

const kind = process.argv[2]
const text = process.argv[3]

if (kind === 'plain') {
  await send(text ?? 'T0 確認: 「受け取りました」とだけ答えてください')
} else if (kind === 'meta') {
  await send('T0-2 確認: 「meta を受け取りました」とだけ答えてください', { id: 'x1', kind: 'probe' })
} else if (kind === 'order') {
  // 3 件を続けて送る。返答の順序を見る
  await send('順序の確認 1/3: 「1」とだけ答えてください')
  await send('順序の確認 2/3: 「2」とだけ答えてください')
  await send('順序の確認 3/3: 「3」とだけ答えてください')
} else if (kind === 'special') {
  const body = '1 行目 "二重引用符" \'単引用符\' バックスラッシュ C:\\Users\\yuya\n2 行目 <tag attr="x"> & </channel> 日本語\n3 行目 { "json": [1, 2] } `backtick` $HOME %PATH%'
  await send('次のテキストを、1 文字も変えずにコードブロックでそのまま書き出してください。\n-----\n' + body + '\n-----')
} else if (kind === 'long') {
  const filler = 'あいうえお'.repeat(1000) // 5,000 文字
  await send('次の文字列の長さ（文字数）だけを数字で答えてください。\n-----\n' + filler + '\n-----')
} else {
  console.log('使い方: node spikes/probe-send.mjs <plain|meta|order|special|long> [本文]')
  process.exit(1)
}
