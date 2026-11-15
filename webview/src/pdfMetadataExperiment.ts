import type { ReaderDocumentDiagnostics } from '../../src/host/openReaderDocument'
import type { PdfLoadDiagnostics } from '../../src/pdf/pdfLoadDiagnostics'
import type { PDFPageProxy } from '../../src/pdf/pdfjsRuntime'
import type { PdfMetadataExperimentConfig } from './pdfMetadataExperimentConfig'

/** Only instantiated by an explicitly enabled WebView diagnostic build. */
export function createPdfMetadataExperiment(
  config: PdfMetadataExperimentConfig,
  diagnostics: PdfLoadDiagnostics
) {
  const controller = new AbortController()
  const { signal } = controller
  let panel: HTMLElement | undefined
  const removePanel = () => {
    panel?.remove()
    panel = undefined
  }
  const pause = (checkpoint: 'open' | 'complete'): Promise<void> => {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      panel = document.createElement('section')
      panel.dataset.pdfMetadataCheckpoint = checkpoint
      panel.setAttribute('role', 'region')
      panel.setAttribute('aria-label', 'PDF 元数据诊断')
      panel.style.cssText =
        'position:fixed;inset:16px;z-index:10000;background:#fff;color:#222;padding:20px;overflow:auto;'
      const heading = document.createElement('h2')
      heading.textContent = 'PDF 元数据诊断'
      const status = document.createElement('p')
      status.textContent =
        checkpoint === 'open'
          ? `PDF 已打开，尚未开始全页元数据。批量：${config.batchSize}（0 为原始并发）。`
          : '全页元数据已完成，会话与元数据仍保留。阅读树未挂载，第二个显示会话未打开。'
      const resume = document.createElement('button')
      resume.textContent =
        checkpoint === 'open' ? '开始元数据' : '结束实验并释放'
      const cancel = document.createElement('button')
      cancel.textContent = '取消实验'
      const abort = () => {
        removePanel()
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      resume.onclick = () => {
        signal.removeEventListener('abort', abort)
        removePanel()
        diagnostics.event(`metadata-only-${checkpoint}-resumed`)
        resolve()
      }
      cancel.onclick = () => controller.abort()
      panel.append(heading, status, resume, cancel)
      document.body.append(panel)
      diagnostics.event(`metadata-only-${checkpoint}-paused`, {
        batchSize: config.batchSize
      })
    })
  }
  diagnostics.event('metadata-experiment-config', {
    batchSize: config.batchSize,
    metadataOnly: config.metadataOnly
  })
  const openOptions: ReaderDocumentDiagnostics = {
    signal,
    ...(config.metadataOnly
      ? {
          afterPdfOpen: () => pause('open'),
          afterPdfMetadata: () => pause('complete')
        }
      : {}),
    // 0 leaves the original Promise.all inside createPdfTextModeDocument intact.
    ...(config.batchSize === 0
      ? {}
      : {
          loadPdfPages: async (pdf) => {
            const pages: PDFPageProxy[] = []
            for (
              let start = 0;
              start < pdf.numPages;
              start += config.batchSize
            ) {
              signal.throwIfAborted()
              pages.push(
                ...(await Promise.all(
                  Array.from(
                    {
                      length: Math.min(config.batchSize, pdf.numPages - start)
                    },
                    (_, offset) => pdf.getPage(start + offset + 1)
                  )
                ))
              )
            }
            signal.throwIfAborted()
            return pages
          }
        })
  }
  return {
    openOptions,
    metadataOnly: config.metadataOnly,
    signal,
    cancel: () => {
      controller.abort()
      removePanel()
    }
  }
}
