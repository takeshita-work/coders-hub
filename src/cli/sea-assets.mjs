// exe（Node の SEA）に埋め込んだ、画面のファイル。名前の一覧は、マニフェスト（manifest.json）に持つ。
// SEA でなければ null（開発時は、dist/web のフォルダを読む）
import { getAsset, isSea } from 'node:sea'

export const loadSeaAssets = () => {
  if (!isSea()) return null
  const names = JSON.parse(getAsset('manifest.json', 'utf8'))
  const files = new Map(names.map((name) => [name, Buffer.from(getAsset(name))]))
  return { get: (rel) => files.get(rel) ?? null }
}
