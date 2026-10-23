import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { build } from 'vite'

import {
  assertWebviewAssets,
  createWebviewManifest
} from './webview-assets.mjs'

const root = process.cwd()
const outDir = resolve(root, 'webview-dist')
const pdfjsRoot = resolve(root, 'node_modules/pdfjs-dist')
const foliateRoot = resolve(root, 'vendor/foliate-js')
const appAssetsDir = resolve(root, 'app/assets')
const zipPath = join(appAssetsDir, 'webreader.zip')

async function copyDirectory(source, target) {
  await cp(source, target, { recursive: true })
}

async function makeEntryClassic() {
  const indexPath = join(outDir, 'index.html')
  const html = await readFile(indexPath, 'utf8')
  // 构建产物是 IIFE；file:// 下 ES module 会被 CORS 拦截，因此把 Vite
  // 注入的 module script 改回 classic script（不含 import/export）。
  const classic = html
    .replace(/<script type="module" crossorigin /g, '<script defer ')
    .replace(/<script type="module" /g, '<script defer ')
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(/ crossorigin/g, '')
  await writeFile(indexPath, classic)
}

async function prepareStaticAssets() {
  await mkdir(join(outDir, 'foliate'), { recursive: true })
  await copyDirectory(foliateRoot, join(outDir, 'foliate'))

  await mkdir(join(outDir, 'pdfjs'), { recursive: true })
  await cp(
    join(pdfjsRoot, 'build/pdf.worker.min.mjs'),
    join(outDir, 'pdfjs/pdf.worker.min.mjs')
  )
  await cp(
    join(pdfjsRoot, 'web/pdf_viewer.mjs'),
    join(outDir, 'pdfjs/pdf_viewer.mjs')
  )
  await cp(
    join(pdfjsRoot, 'web/pdf_viewer.css'),
    join(outDir, 'pdfjs/pdf_viewer.css')
  )
  await cp(join(pdfjsRoot, 'LICENSE'), join(outDir, 'pdfjs/LICENSE'))
  await copyDirectory(
    join(pdfjsRoot, 'standard_fonts'),
    join(outDir, 'pdfjs/standard_fonts')
  )
  await copyDirectory(join(pdfjsRoot, 'cmaps'), join(outDir, 'pdfjs/cmaps'))
  await copyDirectory(
    join(pdfjsRoot, 'web/images'),
    join(outDir, 'pdfjs/images')
  )
}

async function createZip() {
  const manifest = assertWebviewAssets(outDir)
  const zip = new JSZip()
  for (const file of manifest.files) {
    zip.file(file.path, await readFile(join(outDir, file.path)))
  }
  zip.file('asset-manifest.json', JSON.stringify(manifest, null, 2))
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  await mkdir(appAssetsDir, { recursive: true })
  await writeFile(zipPath, buffer)
  await writeFile(
    join(appAssetsDir, 'webreader-manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  return { manifest, size: buffer.byteLength }
}

async function main() {
  await build({
    configFile: resolve(root, 'vite.webview.config.ts'),
    logLevel: 'info'
  })
  await prepareStaticAssets()
  await makeEntryClassic()
  const manifest = createWebviewManifest(outDir)
  await writeFile(
    join(outDir, 'asset-manifest.json'),
    JSON.stringify(manifest, null, 2)
  )
  assertWebviewAssets(outDir)
  const { size } = await createZip()
  console.log(
    `webreader.zip: ${(size / 1024).toFixed(1)} KiB, build ${manifest.buildId}, ${manifest.files.length} files`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
