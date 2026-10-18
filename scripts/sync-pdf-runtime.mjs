#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const index = process.argv.indexOf('--target')
if (index < 0 || !process.argv[index + 1])
  throw new Error('Pass --target <consumer-public-directory>')
const source = fileURLToPath(new URL('./pdf-runtime/', import.meta.url))
const target = resolve(process.argv[index + 1], 'pdf-runtime')
const manifest = JSON.parse(
  readFileSync(resolve(source, 'manifest.json'), 'utf8')
)
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
}
for (const file of manifest.files) {
  const to = resolve(target, file.path)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(resolve(source, file.path), to)
}
copyFileSync(resolve(source, 'manifest.json'), resolve(target, 'manifest.json'))
console.log(
  `Synchronized PDF.js ${manifest.pdfjsVersion}: ${manifest.files.length} assets`
)
