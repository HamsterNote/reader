#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const index = process.argv.indexOf('--target')
if (index < 0 || !process.argv[index + 1])
  throw new Error('Pass --target <consumer-public-directory>')
const source = fileURLToPath(new URL('./pdf-runtime/', import.meta.url))
const target = resolve(process.argv[index + 1], 'pdf-runtime')
const assertPath = (path, directory = false) => {
  const parent = dirname(path)
  if (parent !== path) assertPath(parent, true)
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink())
    throw new Error('PDF target symlinks are forbidden')
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error('Invalid PDF target file type')
}
const assertContained = (path) => {
  const suffix = relative(target, path)
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`))
    throw new Error('PDF target escapes runtime directory')
}
const manifest = JSON.parse(
  readFileSync(resolve(source, 'manifest.json'), 'utf8')
)
const assets = []
for (const file of manifest.files) {
  if (
    typeof file.path !== 'string' ||
    !file.path
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'
      ) ||
    file.path.startsWith('/')
  )
    throw new Error('Invalid PDF asset path')
  const from = resolve(source, file.path)
  const bytes = readFileSync(from)
  if (
    bytes.length !== file.size ||
    createHash('sha256').update(bytes).digest('hex') !== file.sha256
  )
    throw new Error('PDF asset integrity check failed')
  assets.push({ path: file.path, bytes })
}
assets.push({
  path: 'manifest.json',
  bytes: readFileSync(resolve(source, 'manifest.json'))
})
// Reject the entire destination before creating directories or replacing files.
assertPath(target, true)
for (const file of assets) {
  const to = resolve(target, file.path)
  assertContained(to)
  assertPath(to)
}
for (const file of assets) {
  const to = resolve(target, file.path)
  assertPath(to)
  mkdirSync(dirname(to), { recursive: true })
  assertPath(to)
  assertContained(realpathSync(dirname(to)))
  const temporary = resolve(dirname(to), `.pdf-sync-${randomUUID()}`)
  try {
    writeFileSync(temporary, file.bytes, { flag: 'wx' })
    renameSync(temporary, to)
  } finally {
    rmSync(temporary, { force: true })
  }
}
console.log(
  `Synchronized PDF.js ${manifest.pdfjsVersion}: ${manifest.files.length} assets`
)
