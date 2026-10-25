import type { IntermediateText } from '@hamster-note/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IntermediateDocumentViewerProps } from '../components/IntermediateDocumentViewer'
import { isIntermediateText } from '../components/IntermediateDocumentViewer/IntermediateDocumentViewer'
import {
  fetchOcrContent,
  prefixOcrTextIds
} from '../components/IntermediateDocumentViewer/ocrContent'
import type { PDFDocumentProxy } from './pdfjsRuntime'

export type PdfOcrOptions = Pick<
  IntermediateDocumentViewerProps,
  | 'ocr'
  | 'extraOCR'
  | 'ocrTexts'
  | 'onOcrTextsChange'
  | 'onOcrError'
  | 'ocrDebug'
>

async function pageImage(document: PDFDocumentProxy, pageNumber: number) {
  const page = await document.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error(`OCR image is unavailable for page ${pageNumber}`)
    await page.render({ canvas, canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/png')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** One OCR request at a time, including requests invalidated while awaiting a provider. */
export function usePdfOcr(
  document: PDFDocumentProxy | null,
  renderedPages: readonly number[],
  visiblePages: readonly number[],
  options: PdfOcrOptions
) {
  const { ocr, ocrTexts, extraOCR } = options
  const enabled =
    ocr === true || (typeof ocr === 'object' && ocr.enabled === true)
  const manual = typeof ocr === 'object' ? ocr.pages : undefined
  const manualKey = manual ? JSON.stringify(manual) : undefined
  const visibleKey = JSON.stringify(visiblePages)
  const renderedKey = JSON.stringify(renderedPages)
  const targets = (manual ?? renderedPages).filter((page) =>
    visiblePages.includes(page)
  )
  const targetKey = JSON.stringify(targets)
  const latest = useRef(options)
  latest.current = options
  const active = useRef(false)
  const failed = useRef(new Set<number>())
  const [revision, setRevision] = useState(0)
  const [results, setResults] = useState<{
    document: PDFDocumentProxy | null
    texts: ReadonlyMap<number, readonly IntermediateText[]>
  }>({ document: null, texts: new Map() })
  const resultsRef = useRef(results)
  resultsRef.current = results

  useEffect(() => {
    failed.current.clear()
    setResults((current) => ({
      document,
      texts: new Map(
        [...current.texts].filter(
          ([page]) =>
            current.document === document &&
            enabled &&
            visiblePages.includes(page) &&
            (!manual || manual.includes(page))
        )
      )
    }))
  }, [document, enabled, manualKey, visibleKey])

  useEffect(() => {
    if (!document || !enabled || active.current) return
    const page = targets.find(
      (number) =>
        !ocrTexts?.[number] &&
        !(
          resultsRef.current.document === document &&
          resultsRef.current.texts.has(number)
        ) &&
        !failed.current.has(number)
    )
    if (page === undefined) return
    let cancelled = false
    active.current = true
    void (async () => {
      try {
        const image = await pageImage(document, page)
        if (cancelled) return
        const content = await fetchOcrContent(image, extraOCR)
        if (cancelled) return
        const texts = prefixOcrTextIds(content.filter(isIntermediateText), page)
        setResults((current) => ({
          document,
          texts: new Map(
            current.document === document ? current.texts : []
          ).set(page, texts)
        }))
        latest.current.onOcrTextsChange?.(page, texts)
      } catch (error) {
        if (!cancelled) {
          failed.current.add(page)
          latest.current.onOcrError?.(error, { pageNumber: page })
        }
      } finally {
        active.current = false
        if (!cancelled) setRevision((value) => value + 1)
        else wake.current?.()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [document, enabled, targetKey, ocrTexts, extraOCR, revision, renderedKey])

  // A cancelled request still owns the slot until its promise settles.
  const wake = useRef<(() => void) | null>(null)
  useEffect(() => {
    wake.current = () => setRevision((value) => value + 1)
    return () => {
      wake.current = null
    }
  }, [])

  return useMemo(() => {
    const texts = new Map<number, readonly IntermediateText[]>()
    if (!enabled) return texts
    for (const page of visiblePages) {
      if (manual && !manual.includes(page)) continue
      const value =
        ocrTexts?.[page] ??
        (results.document === document ? results.texts.get(page) : undefined)
      if (value) texts.set(page, value)
    }
    return texts
  }, [document, enabled, manualKey, visibleKey, results, ocrTexts])
}
