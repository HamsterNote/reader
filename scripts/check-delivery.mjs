import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import { assertWebviewAssets } from './webview-assets.mjs'

const repo = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(repo, '../ham91-delivery-'))
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
try {
  const packed = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', temporary])
  )[0]
  const unpacked = resolve(temporary, 'package')
  await mkdir(unpacked)
  run('tar', [
    '-xzf',
    resolve(temporary, packed.filename),
    '-C',
    unpacked,
    '--strip-components=1'
  ])
  await symlink(
    resolve(repo, 'node_modules'),
    resolve(unpacked, 'node_modules'),
    'dir'
  )
  const modules = resolve(temporary, 'consumer/node_modules')
  await mkdir(resolve(modules, '@hamster-note'), { recursive: true })
  await symlink(unpacked, resolve(modules, '@hamster-note/reader'), 'dir')
  for (const name of ['react', 'react-dom'])
    await symlink(
      resolve(repo, 'node_modules', name),
      resolve(modules, name),
      'dir'
    )
  const consumer = resolve(temporary, 'consumer')
  await writeFile(
    resolve(consumer, 'package.json'),
    JSON.stringify({ type: 'module' })
  )
  await writeFile(
    resolve(consumer, 'index.html'),
    '<div id="root"></div><script type="module" src="/main.js"></script>'
  )
  await writeFile(
    resolve(consumer, 'main.js'),
    `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Reader } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
const document = { id: 'old-consumer', title: 'Old API', pages: [{ id: 'page-1', number: 1, width: 100, height: 150, content: [] }] }
createRoot(window.document.getElementById('root')).render(React.createElement(Reader, { document }))
`
  )
  await build({
    root: consumer,
    configFile: false,
    logLevel: 'warn',
    build: { outDir: resolve(temporary, 'consumer-dist') }
  })
  await writeFile(
    resolve(consumer, 'ssr.mjs'),
    `
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { Reader } from '@hamster-note/reader'
const html = renderToString(React.createElement(Reader, { document: { id: 'old', title: 'Old API', pages: [] } }))
assert(html.includes('reader-root'))
`
  )
  await symlink(
    resolve(repo, 'node_modules'),
    resolve(temporary, 'node_modules'),
    'dir'
  )
  const ssrOutput = resolve(temporary, 'ssr-dist')
  await build({
    root: consumer,
    configFile: false,
    logLevel: 'warn',
    ssr: { noExternal: true },
    build: {
      ssr: resolve(consumer, 'ssr.mjs'),
      outDir: ssrOutput,
      rollupOptions: {
        external: [
          'react',
          'react-dom',
          'react-dom/server',
          /^pdfjs-dist(?:\/|$)/
        ]
      }
    }
  })
  run(process.execPath, [resolve(ssrOutput, 'ssr.js')])
  console.log(
    'Packed legacy consumer: public package/style.css imports, Vite client build and bundled SSR passed (using installed dependency versions).'
  )

  const broken = resolve(temporary, 'broken-webview')
  await cp(resolve(repo, 'webview-dist'), broken, { recursive: true })
  const manifest = JSON.parse(
    await readFile(resolve(broken, 'asset-manifest.json'), 'utf8')
  )
  const required = manifest.required.find((path) => path.endsWith('.wasm'))
  assert(required, 'expected bundled WASM asset')
  await rm(resolve(broken, required))
  assert.throws(() => assertWebviewAssets(broken))
  console.log(`Missing required asset correctly rejected: ${required}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
