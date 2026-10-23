import { resolve } from 'node:path'

import { assertWebviewAssets } from './webview-assets.mjs'

const root = resolve(process.argv[2] ?? 'webview-dist')

try {
  const manifest = assertWebviewAssets(root)
  console.log(
    `webview assets OK: ${manifest.files.length} files, build ${manifest.buildId}`
  )
} catch (error) {
  console.error(`webview assets invalid: ${error.message}`)
  process.exitCode = 1
}
