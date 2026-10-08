// 画面をビルドする（ADR 0008: esbuild）。出力: dist/web/（Hub が配信する）
//   npm run build
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist/web')

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

await build({
  entryPoints: [path.join(root, 'src/web/main.mjs')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})

for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src/web', file), path.join(out, file))
}
console.log('built:', out)
