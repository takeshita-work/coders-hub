// 配布版の exe（coders-hub.exe）を作る（機能 007、ADR 0018）。出力: dist/exe/coders-hub.exe
//   npm run build:exe
// 手順: 画面をビルド → esbuild で CommonJS の 1 本に束ねる → Node の SEA の blob を作る → node.exe に注入 → 動作確認。
// SEA のメインは CommonJS のみ（Node 22）。そのため、各入口は、最上位の await を使わずに書いてある。
import { build } from 'esbuild'
import { inject } from 'postject'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist/exe')
const web = path.join(root, 'dist/web')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const log = (...a) => console.log('[build-exe]', ...a)

// SEA の注入の目印（Node の公式の値）
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

const run = (command, args, options = {}) => {
  const r = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options })
  if (r.status !== 0) throw new Error(`${command} ${args.join(' ')} が失敗しました（${r.status}）`)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// 1. 画面をビルドする
log('画面をビルド')
run(process.execPath, [path.join(root, 'scripts/build-web.mjs')])

// 2. 画面のファイル（埋め込む）。ソースマップは含めない
const webFiles = fs.readdirSync(web).filter((n) => fs.statSync(path.join(web, n)).isFile() && !n.endsWith('.map'))
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(webFiles))
log('埋め込む画面のファイル:', webFiles.join(', '))

// 3. 束ねる。import.meta.url は、実在しない固定の URL に置き換える（束ねたあとは、ファイルの場所が意味を持たない。src/shared/entry.mjs）
const bundle = path.join(out, 'coders-hub.cjs')
await build({
  entryPoints: [path.join(root, 'src/cli/exe.mjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  external: ['bufferutil', 'utf-8-validate'], // ws の任意の依存（なくても動く）
  define: {
    'import.meta.url': JSON.stringify('file:///C:/__coders_hub_bundle__/main.mjs'),
    __CODERS_HUB_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'warning',
})
log('束ねた:', `${(fs.statSync(bundle).size / 1024).toFixed(0)} KB`)

// 4. SEA の blob を作る
const assets = { 'manifest.json': path.join(out, 'manifest.json') }
for (const name of webFiles) assets[name] = path.join(web, name)
const seaConfig = path.join(out, 'sea-config.json')
const blob = path.join(out, 'sea-prep.blob')
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, assets }, null, 2))
run(process.execPath, ['--experimental-sea-config', seaConfig])

// 5. node.exe を複製して、blob を注入する
const exe = path.join(out, 'coders-hub.exe')
fs.copyFileSync(process.execPath, exe)
await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: SEA_FUSE })
log('作成:', exe, `${(fs.statSync(exe).size / 1024 / 1024).toFixed(0)} MB`)

// 6. 動作確認: バージョンが、package.json と一致する
const r = spawnSync(exe, ['version'], { encoding: 'utf8' })
if (r.status !== 0 || r.stdout.trim() !== pkg.version) throw new Error(`exe の動作確認に失敗しました: ${r.stdout} ${r.stderr}`)
log(`version: ${r.stdout.trim()}（OK）`)

// 中間ファイルは残さない
for (const f of [bundle, seaConfig, blob, path.join(out, 'manifest.json')]) fs.rmSync(f, { force: true })
