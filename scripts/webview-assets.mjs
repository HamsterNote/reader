import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** 构建产物中必须存在的路径；缺失即构建失败。 */
export const REQUIRED_WEBVIEW_FILES = [
  'index.html',
  'assets/webview.js',
  'assets/webview.css',
  'foliate/epub.js',
  'foliate/epubcfi.js',
  'foliate/paginator.js',
  'foliate/overlayer.js',
  'foliate/progress.js',
  'foliate/text-walker.js',
  'foliate/fixed-layout.js',
  'foliate/LICENSE',
  'pdfjs/pdf.worker.min.mjs',
  'pdfjs/pdf_viewer.mjs',
  'pdfjs/pdf_viewer.css',
  'pdfjs/standard_fonts/LiberationSans-Regular.ttf',
  'pdfjs/standard_fonts/FoxitSerif.pfb',
  'pdfjs/cmaps/Adobe-GB1-UCS2.bcmap',
  'pdfjs/cmaps/UniGB-UCS2-H.bcmap'
]

const CONTENT_TYPE_BY_EXTENSION = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ttf': 'font/ttf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8'
}

export function contentTypeFor(path) {
  const extension = path.slice(path.lastIndexOf('.'))
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function walk(root, directory = root) {
  const entries = []
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name)
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      entries.push(...walk(root, absolute))
    } else if (stats.isFile()) {
      entries.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  return entries.sort()
}

/**
 * 生成 manifest 并校验必填资源。buildId 由全部文件内容哈希得出，
 * 应用端据此判断是否需要重新解压。
 */
export function createWebviewManifest(root) {
  const paths = walk(root).filter(
    (path) => path !== 'asset-manifest.json' && !path.endsWith('.map')
  )
  const files = paths.map((path) => {
    const buffer = readFileSync(join(root, path))
    return {
      path,
      size: buffer.byteLength,
      sha256: sha256(buffer),
      contentType: contentTypeFor(path)
    }
  })
  const buildId = sha256(
    files.map((file) => `${file.path}:${file.sha256}`).join('\n')
  ).slice(0, 16)
  const manifest = {
    version: 1,
    buildId,
    entry: 'index.html',
    required: REQUIRED_WEBVIEW_FILES,
    files
  }
  return manifest
}

export function assertWebviewAssets(root) {
  const manifestPath = join(root, 'asset-manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`缺少 asset-manifest.json：${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const listed = new Map(
    (Array.isArray(manifest.files) ? manifest.files : []).map((file) => [
      file.path,
      file
    ])
  )
  for (const required of REQUIRED_WEBVIEW_FILES) {
    const absolute = resolve(root, required)
    if (!absolute.startsWith(resolve(root) + sep)) {
      throw new Error(`资源路径越界：${required}`)
    }
    if (!existsSync(absolute)) {
      throw new Error(`缺少必需资源：${required}`)
    }
    const entry = listed.get(required)
    if (!entry) {
      throw new Error(`清单未登记必需资源：${required}`)
    }
    const buffer = readFileSync(absolute)
    if (buffer.byteLength !== entry.size) {
      throw new Error(`资源大小不匹配：${required}`)
    }
    if (sha256(buffer) !== entry.sha256) {
      throw new Error(`资源哈希不匹配：${required}`)
    }
  }
  return manifest
}
