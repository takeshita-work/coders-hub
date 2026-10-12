// 配布物を作る（機能 007、ADR 0018・0022）。zip にはせず、リリースに個別の資産として添付するファイルを、dist/release/ に並べる。
//   npm run build:exe && npm run package
// ファイル: coders-hub.exe（バージョンなしの固定名）、config.example.json（設定の見本。読まれない）、README.txt、LICENSE、
//   THIRD_PARTY_NOTICES.txt（Node.js と束ねたパッケージのライセンス表示）、SHA256SUMS.txt（exe の SHA-256）
import { build } from 'esbuild'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const exe = path.join(root, 'dist/exe/coders-hub.exe')
if (!fs.existsSync(exe)) throw new Error('dist/exe/coders-hub.exe がありません。先に npm run build:exe を実行してください')

const outDir = path.join(root, 'dist/release')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// ---- 第三者のライセンス表示（Node.js と、束ねた npm パッケージ）----
// exe には Node.js の実行ファイルと、束ねた npm パッケージが含まれる。MIT などの条件（著作権表示とライセンス文を残す）を満たすため、
// 配布物に THIRD_PARTY_NOTICES.txt を入れる。束ねたパッケージは、esbuild の分析（metafile）から集める
const bundledPackages = async () => {
  const names = new Set()
  const common = { bundle: true, write: false, metafile: true, logLevel: 'silent', external: ['bufferutil', 'utf-8-validate'] }
  const targets = [
    { entryPoints: [path.join(root, 'src/cli/exe.mjs')], platform: 'node', format: 'cjs', define: { 'import.meta.url': '"file:///C:/x/y.mjs"', __CODERS_HUB_VERSION__: '"0"' } },
    { entryPoints: [path.join(root, 'src/web/main.mjs')], format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } },
  ]
  for (const t of targets) {
    const { metafile } = await build({ ...common, ...t })
    for (const input of Object.keys(metafile.inputs)) {
      const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll(path.sep, '/'))
      if (m) names.add(m[1])
    }
  }
  return [...names].sort()
}

const licenseTextOf = (dir) => {
  const file = fs.readdirSync(dir).find((n) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null
}

const writeNotices = async (file) => {
  const parts = ['Coders Hub の配布物（coders-hub.exe）に含まれる、第三者のソフトウェアのライセンス表示です。', '']
  // Node.js: 実行ファイルに含まれる（SEA）。ライセンス文は、Node の配布物の LICENSE
  const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE')
  parts.push('='.repeat(78), `Node.js ${process.version}`, '='.repeat(78))
  parts.push(fs.existsSync(nodeLicense) ? fs.readFileSync(nodeLicense, 'utf8').trim() : 'ライセンス: https://github.com/nodejs/node/blob/main/LICENSE', '')
  for (const name of await bundledPackages()) {
    const dir = path.join(root, 'node_modules', name)
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    parts.push('='.repeat(78), `${name} ${info.version}（${info.license ?? 'ライセンス不明'}）`, '='.repeat(78))
    parts.push(licenseTextOf(dir) ?? `ライセンス: ${info.license ?? '不明'}（${info.homepage ?? info.repository?.url ?? ''}）`, '')
  }
  fs.writeFileSync(file, parts.join('\r\n'))
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

fs.copyFileSync(exe, path.join(outDir, 'coders-hub.exe'))
fs.writeFileSync(path.join(outDir, 'README.txt'), fs.readFileSync(path.join(root, 'docs/release-readme.txt'), 'utf8').replaceAll('__VERSION__', pkg.version).replace(/\r?\n/g, '\r\n'))
for (const name of ['LICENSE', 'config.example.json']) {
  const file = path.join(root, name)
  if (!fs.existsSync(file)) throw new Error(`${name} がありません（配布物に入れます）`)
  fs.copyFileSync(file, path.join(outDir, name))
}
await writeNotices(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'))
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), `${sha256(path.join(outDir, 'coders-hub.exe'))}  coders-hub.exe\r\n`)

for (const name of fs.readdirSync(outDir).sort()) {
  console.log(`[package] ${name}（${(fs.statSync(path.join(outDir, name)).size / 1024 / 1024).toFixed(2)} MB）`)
}
console.log(`[package] SHA-256（exe）: ${sha256(path.join(outDir, 'coders-hub.exe'))}`)
