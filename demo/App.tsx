import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  BackgroundQuality,
  ReaderPageRange,
  ReaderSavedSelection,
  ReaderSelectedTextSegment,
  ReaderSelectionOverlayRect
} from '@hamster-note/reader'
import {
  buildSavedSelection,
  getSelectionOverlayRects,
  Reader
} from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import { useCallback, useRef, useState } from 'react'

/** 当前活跃选区的快照，用于构建保存选区 */
type LiveSelectionSnapshot = {
  selection: Selection
  text: string
  segments: ReaderSelectedTextSegment[]
  extractedText: string
  rects: ReaderSelectionOverlayRect[]
  pageSizes: Map<number, { width: number; height: number }>
}

type PageSize = { width: number; height: number }

type PageSizeValue = Partial<PageSize> & Partial<{ x: number; y: number }>

type DocumentWithPageSizes = {
  getPageSizeByPageNumber: (pageNumber: number) => PageSizeValue | undefined
}

type ReaderDocument = IntermediateDocument | IntermediateDocumentSerialized

// localStorage 键名
const STORAGE_KEY = 'hamster-reader-saved-selections'

const DEFAULT_PAGE_SIZE: PageSize = { width: 612, height: 792 }

// ---------------------------------------------------------------------------
// 验证与构建辅助函数
// ---------------------------------------------------------------------------

/**
 * 验证值是否为有效的保存选区
 * 规则：version === 1，id/text 为字符串，start/end 为含 pageNumber 的对象，
 * segments/visual 为数组。可选字段不做校验。
 */
export function isValidReaderSavedSelection(
  value: unknown
): value is ReaderSavedSelection {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) return false
  if (typeof obj.id !== 'string') return false
  if (typeof obj.text !== 'string') return false
  if (typeof obj.start !== 'object' || obj.start === null) return false
  if (typeof (obj.start as Record<string, unknown>).pageNumber !== 'number')
    return false
  if (typeof obj.end !== 'object' || obj.end === null) return false
  if (typeof (obj.end as Record<string, unknown>).pageNumber !== 'number')
    return false
  if (!Array.isArray(obj.segments)) return false
  if (!Array.isArray(obj.visual)) return false
  return true
}

function getSegmentPageNumber(segment: ReaderSelectedTextSegment): number {
  return segment.pageNumber ?? 1
}

function getDocumentPageSize(
  document: ReaderDocument | null,
  pageNumber: number
): PageSize {
  if (
    document &&
    'getPageSizeByPageNumber' in document &&
    typeof document.getPageSizeByPageNumber === 'function'
  ) {
    const value = (document as DocumentWithPageSizes).getPageSizeByPageNumber(
      pageNumber
    )
    const width = value?.width ?? value?.x
    const height = value?.height ?? value?.y
    if (
      typeof width === 'number' &&
      typeof height === 'number' &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height }
    }
  }

  return DEFAULT_PAGE_SIZE
}

/** 从 segment.polygon 派生整段 page-level rects。
 *  仅用于 viewerRoot 不可用的回退场景（如单测 mock）。
 *  polygon 顺序假设为 [TL, TR, BR, BL]（Reader 库内的约定）。 */
function derivePolygonRects(
  segments: ReaderSelectedTextSegment[]
): ReaderSelectionOverlayRect[] {
  const rects: ReaderSelectionOverlayRect[] = []
  for (const segment of segments) {
    const polygon = segment.polygon
    if (!polygon || polygon.length < 4) continue
    const xs = polygon.map(([x]) => x)
    const ys = polygon.map(([, y]) => y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const width = Math.max(...xs) - x
    const height = Math.max(...ys) - y
    if (width <= 0 || height <= 0) continue
    rects.push({
      pageNumber: getSegmentPageNumber(segment),
      x,
      y,
      width,
      height
    })
  }
  return rects
}

function buildPageSizeMap(
  document: ReaderDocument | null,
  segments: ReaderSelectedTextSegment[],
  rects: ReaderSelectionOverlayRect[]
): Map<number, PageSize> {
  const pageNumbers = new Set<number>()
  for (const segment of segments) pageNumbers.add(getSegmentPageNumber(segment))
  for (const rect of rects) pageNumbers.add(rect.pageNumber)
  if (pageNumbers.size === 0) pageNumbers.add(1)

  return new Map(
    Array.from(pageNumbers, (pageNumber) => [
      pageNumber,
      getDocumentPageSize(document, pageNumber)
    ])
  )
}

/** 生成唯一 ID（优先 crypto.randomUUID，回退到时间戳+随机串） */
function generateId(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID()
    }
  } catch {
    // 忽略，使用回退方案
  }
  // 安全回退：仅用于 demo 本地生成非加密唯一 ID，不涉安全敏感场景
  // eslint-disable-next-line sonarjs/pseudo-random
  return `sel-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ---------------------------------------------------------------------------
// App 组件
// ---------------------------------------------------------------------------

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [document, setDocument] = useState<
    IntermediateDocument | IntermediateDocumentSerialized | null
  >(null)
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [pageRangeStart, setPageRangeStart] = useState<number>(1)
  const [pageRangeEnd, setPageRangeEnd] = useState<number>(3)
  const [usePageRange, setUsePageRange] = useState<boolean>(false)
  const [backgroundQuality, setBackgroundQuality] =
    useState<BackgroundQuality>('medium')
  const requestIdRef = useRef(0)

  // 保存选区相关状态
  const [savedSelections, setSavedSelections] = useState<
    ReaderSavedSelection[]
  >([])
  const [savedSelectionStatus, setSavedSelectionStatus] = useState<
    string | null
  >(null)
  const [activeSavedSelectionId, setActiveSavedSelectionId] = useState<
    string | null
  >(null)
  const [lastLiveSelection, setLastLiveSelection] =
    useState<LiveSelectionSnapshot | null>(null)

  const buildPageRange = useCallback((): ReaderPageRange | undefined => {
    if (!usePageRange) {
      return undefined
    }
    return { start: pageRangeStart, end: pageRangeEnd }
  }, [usePageRange, pageRangeStart, pageRangeEnd])

  const buildParserPages = useCallback((): number[] | undefined => {
    if (!usePageRange) {
      return undefined
    }
    const start = Math.trunc(pageRangeStart)
    const end = Math.trunc(pageRangeEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return undefined
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [usePageRange, pageRangeStart, pageRangeEnd])

  const handleFileUpload = async (file: File) => {
    setUploadedFile(file)
    setParseError(null)

    const requestId = ++requestIdRef.current
    setIsParsing(true)

    try {
      const pages = buildParserPages()
      const result = await PdfParser.encode(file, pages ? { pages } : undefined)

      if (requestId !== requestIdRef.current) {
        return
      }

      if (result === undefined) {
        setParseError('Failed to parse PDF: received undefined result')
        setDocument(null)
      } else {
        setDocument(result)
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) {
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      setParseError(`Failed to parse PDF: ${message}`)
      setDocument(null)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsParsing(false)
      }
    }
  }

  /** 捕获 onSelectText 回调中的选区数据 */
  const handleSelectText = useCallback(
    (
      selection: Selection,
      segments: ReaderSelectedTextSegment[],
      extractedText: string
    ) => {
      // demo 自行通过 DOM 查询拿到 viewerRoot/pageRefs，不依赖 onSelectText 扩展签名
      const viewerRoot = window.document.querySelector<HTMLElement>(
        '[data-testid="intermediate-document-viewer"]'
      )
      const pageRefs = new Map<number, HTMLDivElement>()
      if (viewerRoot) {
        const pageNodes = viewerRoot.querySelectorAll<HTMLDivElement>(
          '[data-testid^="intermediate-page-"]'
        )
        pageNodes.forEach((node: HTMLDivElement) => {
          const match = node.dataset.testid?.match(/intermediate-page-(\d+)/)
          if (match) pageRefs.set(Number(match[1]), node)
        })
      }
      const capturedRects =
        viewerRoot && !selection.isCollapsed
          ? getSelectionOverlayRects(selection, viewerRoot, pageRefs)
          : []
      // Fallback：当真实 DOM 不可用（如测试 / mock），从 segment.polygon 派生整段 page-level rects。
      // 生产路径上 viewerRoot 一定存在，capturedRects 不会为空。
      const effectiveRects =
        capturedRects.length > 0 ? capturedRects : derivePolygonRects(segments)
      setLastLiveSelection({
        selection,
        text: extractedText,
        segments,
        extractedText,
        rects: effectiveRects,
        pageSizes: buildPageSizeMap(document, segments, effectiveRects)
      })
    },
    [document]
  )

  /** 保存当前选区到 localStorage */
  const handleSaveSelection = useCallback(() => {
    if (!lastLiveSelection) {
      setSavedSelectionStatus('没有当前选区，无法保存')
      return
    }

    const id = generateId()
    const liveSelection = window.getSelection()
    const fallbackSelection = {
      toString: () => lastLiveSelection.text,
      isCollapsed: false,
      rangeCount: 0
    } as unknown as Selection
    let selectionForSave: Selection
    if (!lastLiveSelection.selection.isCollapsed) {
      selectionForSave = lastLiveSelection.selection
    } else if (liveSelection && !liveSelection.isCollapsed) {
      selectionForSave = liveSelection
    } else {
      selectionForSave = fallbackSelection
    }
    const pageSizes =
      lastLiveSelection.pageSizes.size > 0
        ? lastLiveSelection.pageSizes
        : buildPageSizeMap(
            document,
            lastLiveSelection.segments,
            lastLiveSelection.rects
          )
    const savedSelection = buildSavedSelection({
      id,
      document: document?.id,
      selection: selectionForSave,
      segments: lastLiveSelection.segments,
      rects: lastLiveSelection.rects,
      pageSizes
    })

    // 替换已有同 ID 项或追加
    const existingIndex = savedSelections.findIndex((s) => s.id === id)
    const nextSelections =
      existingIndex >= 0
        ? savedSelections.map((s, i) =>
            i === existingIndex ? savedSelection : s
          )
        : [...savedSelections, savedSelection]

    setSavedSelections(nextSelections)
    setActiveSavedSelectionId(id)

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSelections))
      setSavedSelectionStatus(`已标记选区 (ID: ${id.slice(0, 8)}…)`)
    } catch {
      setSavedSelectionStatus('保存失败：无法写入 localStorage')
    }
  }, [document, lastLiveSelection, savedSelections])

  /** 从 localStorage 加载已保存的选区 */
  const handleLoadSelections = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) {
        setSavedSelectionStatus('没有找到已保存的选区')
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        setSavedSelectionStatus('加载失败：JSON 解析错误')
        return
      }

      if (!Array.isArray(parsed)) {
        setSavedSelectionStatus('加载失败：存储数据格式错误（非数组）')
        return
      }

      const validSelections = parsed.filter(isValidReaderSavedSelection)
      setSavedSelections(validSelections)
      setActiveSavedSelectionId((currentId) =>
        currentId &&
        validSelections.some((selection) => selection.id === currentId)
          ? currentId
          : null
      )
      setSavedSelectionStatus(`已加载 ${validSelections.length} 个有效选区`)
    } catch {
      setSavedSelectionStatus('加载失败：无法读取 localStorage')
    }
  }, [])

  const handleSavedSelectionEdit = useCallback(
    (id: string, nextSelection: ReaderSavedSelection) => {
      const existingIndex = savedSelections.findIndex((s) => s.id === id)
      const nextSelections =
        existingIndex >= 0
          ? savedSelections.map((selection, index) =>
              index === existingIndex ? nextSelection : selection
            )
          : [...savedSelections, nextSelection]

      setSavedSelections(nextSelections)

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSelections))
        setSavedSelectionStatus(`已更新选区 (ID: ${id.slice(0, 8)}…)`)
      } catch {
        setSavedSelectionStatus('更新失败：无法写入 localStorage')
      }
    },
    [savedSelections]
  )

  const handleDeleteActiveSelection = useCallback(() => {
    if (!activeSavedSelectionId) {
      setSavedSelectionStatus('请先点击已标记选区')
      return
    }

    const nextSelections = savedSelections.filter(
      (selection) => selection.id !== activeSavedSelectionId
    )
    if (nextSelections.length === savedSelections.length) {
      setSavedSelectionStatus('未找到当前选区，无法删除')
      setActiveSavedSelectionId(null)
      return
    }

    setSavedSelections(nextSelections)
    setActiveSavedSelectionId(null)

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSelections))
      setSavedSelectionStatus(
        `已删除选区 (ID: ${activeSavedSelectionId.slice(0, 8)}…)`
      )
    } catch {
      setSavedSelectionStatus('删除失败：无法写入 localStorage')
    }
  }, [activeSavedSelectionId, savedSelections])

  return (
    <main data-testid='reader-demo-root'>
      <h1>Hamster Reader Demo</h1>
      {isParsing && (
        <section style={{ marginBottom: '24px' }}>
          <h2>Parsing...</h2>
          <p>Loading PDF content...</p>
        </section>
      )}
      {parseError && (
        <section style={{ marginBottom: '24px', color: 'red' }}>
          <h2>Parse Error</h2>
          <p>{parseError}</p>
        </section>
      )}
      {document && (
        <section style={{ marginBottom: '24px' }}>
          <h2>Parsed Document</h2>
          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>Background Quality:</span>
              <select
                value={backgroundQuality}
                onChange={(e) =>
                  setBackgroundQuality(e.target.value as BackgroundQuality)
                }
                style={{ padding: '4px 8px' }}
                data-testid='background-quality-select'
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </label>
          </div>
          {/* 保存/加载选区按钮及状态 */}
          <div
            style={{
              marginBottom: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center'
            }}
          >
            <button
              type='button'
              onClick={handleSaveSelection}
              data-testid='save-selection-button'
              style={{ padding: '4px 12px' }}
            >
              标记当前选区
            </button>
            <button
              type='button'
              onClick={handleLoadSelections}
              data-testid='load-selections-button'
              style={{ padding: '4px 12px' }}
            >
              加载已保存选区
            </button>
            <button
              type='button'
              onClick={handleDeleteActiveSelection}
              disabled={!activeSavedSelectionId}
              data-testid='delete-selection-button'
              style={{ padding: '4px 12px' }}
            >
              删除当前标记
            </button>
            {savedSelectionStatus && (
              <span
                data-testid='selection-status'
                style={{ fontSize: '14px', color: '#666' }}
              >
                {savedSelectionStatus}
              </span>
            )}
          </div>
          <Reader
            document={document}
            pageRange={buildPageRange()}
            renderMode='direct'
            backgroundQuality={backgroundQuality}
            ocr
            selectionOverlay={{
              opacity: 0.28,
              enabled: true
            }}
            onTextSelectionChange={() => {}}
            onTextSelectionEnd={() => {}}
            onSelectText={handleSelectText}
            savedSelections={savedSelections}
            onSavedSelectionEdit={handleSavedSelectionEdit}
            activeSavedSelectionId={activeSavedSelectionId}
            onActiveSavedSelectionChange={setActiveSavedSelectionId}
          />
          <p style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
            Rendered with the direct text layer to demonstrate the custom
            selection overlay (pink default)
          </p>
        </section>
      )}
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload PDF</h2>
        <div style={{ marginBottom: '16px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '12px'
            }}
          >
            <input
              type='checkbox'
              checked={usePageRange}
              onChange={(e) => setUsePageRange(e.target.checked)}
              data-testid='page-range-toggle'
            />
            <span>Enable page range</span>
          </label>
          {usePageRange && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span>Start:</span>
                <input
                  type='number'
                  min={1}
                  value={pageRangeStart}
                  onChange={(e) =>
                    setPageRangeStart(Math.max(1, Number(e.target.value) || 1))
                  }
                  style={{ width: '60px', padding: '4px' }}
                  data-testid='page-range-start'
                />
              </label>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span>End:</span>
                <input
                  type='number'
                  min={1}
                  value={pageRangeEnd}
                  onChange={(e) =>
                    setPageRangeEnd(Math.max(1, Number(e.target.value) || 1))
                  }
                  style={{ width: '60px', padding: '4px' }}
                  data-testid='page-range-end'
                />
              </label>
            </div>
          )}
        </div>
        <Reader
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
          onSelectText={() => {}}
        />
      </section>
      {uploadedFile && !isParsing && (
        <section>
          <h2>Last Uploaded File</h2>
          <p>Name: {uploadedFile.name}</p>
          <p>Size: {uploadedFile.size} bytes</p>
          <p>Type: {uploadedFile.type}</p>
        </section>
      )}
    </main>
  )
}
