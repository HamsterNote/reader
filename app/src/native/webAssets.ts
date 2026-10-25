/* eslint-disable @typescript-eslint/no-require-imports -- Metro 只能通过静态 require 打包资产 */
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import { fromByteArray, toByteArray } from 'base64-js'
import { strFromU8, unzipSync } from 'fflate'
import { assertSafeFileId } from '../../../src/host/fileIdentity'
import { resolveDocumentCacheUri } from '../../../src/host/documentCachePath'
import type { HostDocumentRecord } from '../../../src/host/readerDataStore'

const WEB_ROOT = `${FileSystem.documentDirectory ?? ''}webreader/`
const REQUIRED_ENTRIES = [
  'index.html',
  'asset-manifest.json',
  'assets/webview.js',
  'assets/webview.css',
  'foliate/epub.js',
  'pdfjs/pdf.worker.min.mjs',
  'pdfjs/pdf_viewer.css',
  'pdfjs/standard_fonts/LiberationSans-Regular.ttf'
] as const

export type PackagedWebReader = {
  readonly entryUrl: string
  readonly baseUrl: string
  readonly buildId: string
}

type WebAssetManifest = {
  readonly buildId: string
  readonly files: readonly { readonly path: string }[]
}

function readManifest(files: Record<string, Uint8Array>): WebAssetManifest {
  const raw = files['asset-manifest.json']
  if (!raw) throw new Error('打包资源缺少 asset-manifest.json')
  const manifest = JSON.parse(strFromU8(raw)) as unknown
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof Reflect.get(manifest, 'buildId') !== 'string' ||
    !Array.isArray(Reflect.get(manifest, 'files'))
  ) {
    throw new Error('asset-manifest.json 结构无效')
  }
  return manifest as WebAssetManifest
}

async function extractZip(asset: Asset): Promise<Record<string, Uint8Array>> {
  if (!asset.localUri) {
    await asset.downloadAsync()
  }
  const localUri = asset.localUri
  if (!localUri) throw new Error('无法下载打包的 Web 阅读资源')
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64
  })
  return unzipSync(toByteArray(base64))
}

async function writeFiles(
  targetDir: string,
  files: Record<string, Uint8Array>
): Promise<void> {
  await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true })
  const entries = Object.entries(files)
  // 清单最后写：它是解压完成的标记，进程中断后下次会重新解压。
  const marker = entries.find(([path]) => path === 'asset-manifest.json')
  const contentEntries = entries.filter(
    ([path]) => path !== 'asset-manifest.json'
  )
  for (const [relativePath, bytes] of contentEntries) {
    if (relativePath.endsWith('/')) continue
    if (relativePath.includes('..') || relativePath.startsWith('/')) {
      throw new Error(`非法资源路径：${relativePath}`)
    }
    const targetPath = `${targetDir}${relativePath}`
    const parent = targetPath.slice(0, targetPath.lastIndexOf('/') + 1)
    await FileSystem.makeDirectoryAsync(parent, { intermediates: true })
    await FileSystem.writeAsStringAsync(targetPath, fromByteArray(bytes), {
      encoding: FileSystem.EncodingType.Base64
    })
  }
  if (marker) {
    await FileSystem.writeAsStringAsync(
      `${targetDir}asset-manifest.json`,
      fromByteArray(marker[1]),
      { encoding: FileSystem.EncodingType.Base64 }
    )
  }
}

/**
 * 首次启动或资源版本变化时，把应用包内的 webreader.zip 解压到文档目录，
 * 之后 WebView 只从该目录加载（离线、自包含）。返回本地 entry URL。
 */
export async function preparePackagedWebReader(): Promise<PackagedWebReader> {
  const asset = Asset.fromModule(require('../../assets/webreader.zip'))
  const files = await extractZip(asset)
  const manifest = readManifest(files)
  for (const required of REQUIRED_ENTRIES) {
    if (!files[required]) {
      throw new Error(`Web 阅读资源不完整：缺少 ${required}`)
    }
  }

  const targetDir = `${WEB_ROOT}${manifest.buildId}/`
  const marker = `${targetDir}asset-manifest.json`
  const markerInfo = await FileSystem.getInfoAsync(marker)
  if (!markerInfo.exists) {
    await writeFiles(targetDir, files)
  }

  const entryUrl = `${targetDir}index.html`
  return { entryUrl, baseUrl: targetDir, buildId: manifest.buildId }
}

/** WKWebView can read only this document and its packaged engine assets. */
export async function stageReaderDocument(
  baseUrl: string,
  record: HostDocumentRecord
) {
  const fileId = assertSafeFileId(record.fileId)
  const buildId = baseUrl.split('/').filter(Boolean).at(-1)
  if (!buildId || !/^[a-f0-9]{16}$/.test(buildId))
    throw new Error('Invalid reading asset directory')
  const target = `${FileSystem.documentDirectory ?? ''}reader-sessions/${fileId}/${buildId}/`
  const marker = await FileSystem.getInfoAsync(`${target}session-ready`)
  if (!marker.exists) {
    await FileSystem.deleteAsync(target, { idempotent: true })
    await FileSystem.makeDirectoryAsync(target.slice(0, -buildId.length - 1), {
      intermediates: true
    })
    await FileSystem.copyAsync({ from: baseUrl, to: target })
    await FileSystem.writeAsStringAsync(`${target}session-ready`, buildId)
  }
  const publicationUrl = `${target}publication.${record.format}`
  const publication = await FileSystem.getInfoAsync(publicationUrl)
  if (
    !publication.exists ||
    (record.size > 0 && publication.size !== record.size)
  ) {
    const pending = `${publicationUrl}.pending`
    await FileSystem.deleteAsync(pending, { idempotent: true })
    await FileSystem.copyAsync({
      from: resolveDocumentCacheUri(
        FileSystem.documentDirectory,
        fileId,
        record.format
      ),
      to: pending
    })
    await FileSystem.deleteAsync(publicationUrl, { idempotent: true })
    await FileSystem.moveAsync({ from: pending, to: publicationUrl })
  }
  return { baseUrl: target, entryUrl: `${target}index.html`, publicationUrl }
}

export async function removeStagedDocument(fileId: string): Promise<void> {
  await FileSystem.deleteAsync(
    `${FileSystem.documentDirectory ?? ''}reader-sessions/${assertSafeFileId(fileId)}/`,
    { idempotent: true }
  )
}
