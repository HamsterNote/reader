import './webview.css'

import type { BridgeRestorePayload } from '../../src/bridge/protocol'
import { createWebBridgeClient } from './bridgeClient'
import { listenHostMessages } from './hostMessageChannel'
import { createPdfWorkerFromAsset } from './pdfWorker'

type HostBootstrap = {
  readonly sessionId: string
  readonly sourceToken: string
}

type CheckResult = {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

declare global {
  interface Window {
    __READER_HOST__?: HostBootstrap
    ReactNativeWebView?: {
      readonly postMessage: (raw: string) => void
    }
  }
}

const connection = document.getElementById('connection')
const documentInfo = document.getElementById('document-info')
const restoreInfo = document.getElementById('restore-info')
const pendingInfo = document.getElementById('pending-info')
const sessionLabel = document.getElementById('session-label')
const selfCheckButton = document.getElementById(
  'run-self-check'
) as HTMLButtonElement | null
const selfCheckResults = document.getElementById('self-check-results')

function setStatus(text: string, kind: 'ok' | 'error' | 'idle'): void {
  if (!connection) return
  connection.textContent = text
  connection.className = `badge ${kind === 'idle' ? '' : kind}`
}

function summarizeSnapshot(payload: BridgeRestorePayload): string {
  const data = payload.data
  if (data === null || typeof data !== 'object') {
    return `revision ${payload.revision}，无历史数据`
  }
  const record = data as Record<string, unknown>
  const highlights = record['highlights']
  if (highlights !== null && typeof highlights === 'object') {
    const h = highlights as Record<string, unknown>
    const ranges = Array.isArray(h['ranges']) ? h['ranges'].length : 0
    const rects = Array.isArray(h['rects']) ? h['rects'].length : 0
    const paintings =
      h['paintings'] !== null && typeof h['paintings'] === 'object'
        ? Object.keys(h['paintings'] as Record<string, unknown>).length
        : 0
    return `revision ${payload.revision}，高亮 ${ranges}、矩形 ${rects}、绘图页 ${paintings}`
  }
  return `revision ${payload.revision}，已收到宿主快照`
}

function renderChecks(results: readonly CheckResult[]): void {
  if (!selfCheckResults) return
  selfCheckResults.replaceChildren(
    ...results.map((result) => {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = result.name
      const status = document.createElement('span')
      status.className = result.ok ? 'ok' : 'error'
      status.textContent = result.ok
        ? `通过 · ${result.detail}`
        : `失败 · ${result.detail}`
      item.append(name, status)
      return item
    })
  )
}

async function fetchAsset(relativePath: string): Promise<Response> {
  const url = new URL(relativePath, location.href).href
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${relativePath} HTTP ${response.status}`)
  }
  return response
}

async function runSelfCheck(): Promise<void> {
  if (!selfCheckButton) return
  selfCheckButton.disabled = true
  setStatus('自检中…', 'idle')
  const results: CheckResult[] = []
  const check = async (
    name: string,
    task: () => Promise<string>
  ): Promise<void> => {
    const root = document.getElementById('app')
    if (root) root.dataset.checkState = name
    try {
      results.push({ name, ok: true, detail: await task() })
    } catch (error) {
      results.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  }

  await check('资源清单', async () => {
    const response = await fetchAsset('asset-manifest.json')
    const manifest = (await response.json()) as { files?: unknown[] }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new Error('清单为空')
    }
    return `${manifest.files.length} 个文件`
  })
  await check('PDF worker 脚本', async () => {
    const response = await fetchAsset('pdfjs/pdf.worker.min.mjs')
    const text = await response.text()
    if (!text.includes('GlobalWorkerOptions') && text.length < 1000) {
      throw new Error('worker 内容异常')
    }
    return `${Math.round(text.length / 1024)} KiB`
  })
  await check('PDF viewer CSS', async () => {
    const response = await fetchAsset('pdfjs/pdf_viewer.css')
    const text = await response.text()
    if (!text.includes('.pdfViewer')) throw new Error('缺少 .pdfViewer 样式')
    return `${Math.round(text.length / 1024)} KiB`
  })
  await check('PDF 标准字体', async () => {
    await fetchAsset('pdfjs/standard_fonts/LiberationSans-Regular.ttf')
    return 'LiberationSans'
  })
  await check('Foliate ESM', async () => {
    const response = await fetchAsset('foliate/epub.js')
    const source = await response.text()
    if (!source.includes('export') || !source.includes('class EPUB')) {
      throw new Error('epub.js 内容异常')
    }
    return `${Math.round(source.length / 1024)} KiB`
  })
  await check('PDF module worker 启动', async () => {
    const worker = await createPdfWorkerFromAsset()
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 1200)
        worker.addEventListener('error', (event) => {
          clearTimeout(timer)
          reject(new Error(event.message || 'worker 加载失败'))
        })
      })
      return '已启动'
    } finally {
      worker.terminate()
    }
  })

  renderChecks(results)
  if (document.getElementById('app')) {
    document.getElementById('app')?.setAttribute('data-check-done', 'true')
  }
  const failed = results.filter((result) => !result.ok).length
  setStatus(
    failed === 0 ? '自检通过' : `${failed} 项失败`,
    failed === 0 ? 'ok' : 'error'
  )
  selfCheckButton.disabled = false
}

function boot(): void {
  const host = window.__READER_HOST__
  const postMessage = window.ReactNativeWebView?.postMessage
  if (!host || !postMessage) {
    setStatus('未在宿主内运行', 'error')
    if (documentInfo) {
      documentInfo.textContent =
        '此页面需要在 Expo 应用的 WebView 中加载；直接打开浏览器时没有宿主桥接。'
    }
    return
  }

  if (sessionLabel) {
    sessionLabel.textContent = `会话 ${host.sessionId.slice(0, 8)}`
  }
  const bridge = createWebBridgeClient({
    sessionId: host.sessionId,
    sourceToken: host.sourceToken,
    post: (raw) => postMessage(raw),
    onOpen: (payload) => {
      setStatus('已连接', 'ok')
      if (documentInfo) {
        documentInfo.textContent = `${payload.document.format.toUpperCase()} · ${payload.document.fileId}`
      }
    },
    onRestore: (payload) => {
      if (restoreInfo) restoreInfo.textContent = summarizeSnapshot(payload)
      if (pendingInfo) pendingInfo.textContent = '已恢复宿主最后确认的数据'
    },
    onError: (payload) => {
      setStatus(`错误：${payload.code}`, 'error')
      if (pendingInfo) pendingInfo.textContent = payload.message
    },
    onDispose: () => {
      setStatus('会话已关闭', 'idle')
    }
  })

  // Android 的 MessageEvent 派发到 document 且不冒泡，iOS 派发到 window；
  // listenHostMessages 同时挂两个目标并按事件去重。
  listenHostMessages((data) => {
    bridge.handleMessage(data)
  })

  bridge.start()
  selfCheckButton?.addEventListener('click', () => {
    void runSelfCheck()
  })
}

boot()

// 设备/无头环境可用 index.html?selftest=1 自动跑一次资源自检。
if (new URLSearchParams(location.search).get('selftest') === '1') {
  void runSelfCheck()
}
