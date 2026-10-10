// 会話ログ（JSONL）から、渡した指示がどう扱われたかを判定する（機能 002、ADR 0013）。
// 補助用途のみ（NFR-008）。読めない・見つからない場合は null を返す。
//
// 実機の記録（2026-10-09）:
//  - 指示として処理された: type=user・origin.kind=channel の記録（本文にタグ <channel ... id="ID">）
//  - 作業中に重なった: queue-operation が enqueue → remove になり、attachment（queued_command）として記録される
//    （「NOT from your user」の注意書きで渡され、モデルは従わない）

const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''))

// text: 会話ログの末尾部分。id: 指示の ID。戻り値: 'confirmed' | 'missed' | null
export const findDelivery = (text, id) => {
  const needle = `id=\\"${id}\\"` // JSON 文字列の中では引用符がエスケープされる
  const plain = `id="${id}"`
  let missed = false
  for (const line of String(text ?? '').split('\n')) {
    if (!line.includes(needle) && !line.includes(plain)) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.type === 'user' && entry.origin?.kind === 'channel' && asText(entry.message?.content).includes(plain)) {
      return 'confirmed'
    }
    if (entry?.type === 'queue-operation' && entry.operation === 'remove' && asText(entry.content).includes(plain)) missed = true
    if (entry?.type === 'attachment' && entry.attachment?.type === 'queued_command' && asText(entry.attachment.prompt).includes(plain)) {
      missed = true
    }
  }
  return missed ? 'missed' : null
}
