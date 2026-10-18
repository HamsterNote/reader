import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const upstream = dirname(require.resolve('pdfjs-dist/package.json'))
const metadata = JSON.parse(
  readFileSync(join(upstream, 'package.json'), 'utf8')
)
const declared = JSON.parse(readFileSync('package.json', 'utf8')).dependencies[
  'pdfjs-dist'
]
if (metadata.version !== declared)
  throw new Error('PDF.js must match its exact declared version')
const target = resolve('dist/pdf-runtime')
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory())
      copyTree(join(from, entry.name), join(to, entry.name))
    else if (entry.isFile())
      copyFileSync(join(from, entry.name), join(to, entry.name))
    else throw new Error('Unexpected non-file PDF runtime asset')
  }
}
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
  copyTree(join(upstream, directory), join(target, directory))
copyFileSync(
  join(upstream, 'build/pdf.worker.min.mjs'),
  join(target, 'pdf.worker.min.mjs')
)
copyFileSync(join(upstream, 'LICENSE'), join(target, 'LICENSE'))
copyFileSync('src/pdf/pdf.css', join(target, 'pdf.css'))
copyFileSync('scripts/sync-pdf-runtime.mjs', 'dist/sync-pdf-runtime.mjs')
const mime = (name) => {
  if (name.endsWith('.js') || name.endsWith('.mjs')) return 'text/javascript'
  if (name.endsWith('.wasm')) return 'application/wasm'
  if (name.endsWith('.css')) return 'text/css'
  return 'application/octet-stream'
}
const files = []
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path)
    else {
      const name = relative(target, path).replaceAll('\\', '/')
      const bytes = readFileSync(path)
      files.push({
        path: name,
        mimeType: mime(name),
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
    }
  }
}
walk(target)
files.sort((left, right) => left.path.localeCompare(right.path))
writeFileSync(
  join(target, 'manifest.json'),
  JSON.stringify(
    { version: 1, pdfjsVersion: metadata.version, files },
    null,
    2
  ) + '\n'
)
console.log(`Staged PDF.js ${metadata.version}: ${files.length} exact assets`)
