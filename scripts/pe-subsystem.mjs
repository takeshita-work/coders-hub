// Windows の実行ファイル（PE）のサブシステムを書き換える。3 = コンソール、2 = GUI（ウィンドウなし）。
// GUI にすると、ダブルクリックでコンソールのウィンドウが出ない。パイプ経由の標準入出力は、GUI でも使える（ADR 0020）。
export const SUBSYSTEM_GUI = 2
export const SUBSYSTEM_CONSOLE = 3

const subsystemOffset = (buf) => {
  if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('Windows の実行ファイルではありません')
  const pe = buf.readUInt32LE(0x3c)
  if (pe + 24 + 70 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('PE ヘッダーが見つかりません')
  return pe + 24 + 68
}

export const readSubsystem = (buf) => buf.readUInt16LE(subsystemOffset(buf))

// buf を直接書き換える。変更前の値が from でなければ、エラー
export const setSubsystem = (buf, to, from = SUBSYSTEM_CONSOLE) => {
  const at = subsystemOffset(buf)
  const current = buf.readUInt16LE(at)
  if (current !== from) throw new Error(`サブシステムが想定（${from}）と違います: ${current}`)
  buf.writeUInt16LE(to, at)
  return buf
}
