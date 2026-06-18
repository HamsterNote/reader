import { DocxParser } from '@hamster-note/docx-parser'
import { MarkdownParser } from '@hamster-note/markdown-parser'
import { PdfParser } from '@hamster-note/pdf-parser'
import type {
  BackgroundQuality,
  ReaderPageRange,
  ReaderSavedSelection,
  ReaderSavedSelectionComment,
  ReaderSelectedTextSegment,
  ReaderSelectionOverlayRect
} from '@hamster-note/reader'
import {
  buildSavedSelection,
  getSelectionOverlayRects,
  Reader
} from '@hamster-note/reader'
import '@hamster-note/reader/style.css'
import { TxtParser } from '@hamster-note/txt-parser'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized
} from '@hamster-note/types'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

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

export const SUPPORTED_FILE_TYPE_LABEL = 'PDF, TXT, DOCX, Markdown'

export const UNSUPPORTED_FILE_TYPE_MESSAGE =
  'Unsupported file type. Supported: PDF, TXT, DOCX, Markdown.'

export type SupportedParserLabel = 'PDF' | 'TXT' | 'DOCX' | 'Markdown'

export type ParseUploadedDocumentResult =
  | {
      status: 'parsed'
      label: SupportedParserLabel
      document: ReaderDocument | undefined
    }
  | { status: 'failed'; label: SupportedParserLabel; error: string }
  | { status: 'unsupported'; error: string }

export function getFileExtension(fileName: string): string | null {
  if (fileName.length === 0) return null

  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex < 0 || lastDotIndex === fileName.length - 1) return null

  return fileName.slice(lastDotIndex + 1).toLowerCase()
}

export function getParserErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function parseUploadedDocument(
  file: File,
  pages: number[] | undefined
): Promise<ParseUploadedDocumentResult> {
  switch (getFileExtension(file.name)) {
    case 'pdf':
      try {
        const document = await PdfParser.encode(
          file,
          pages ? { pages } : undefined
        )
        return { status: 'parsed', label: 'PDF', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'PDF',
          error: getParserErrorMessage(error)
        }
      }
    case 'txt':
      try {
        const document = await TxtParser.encode(file)
        return { status: 'parsed', label: 'TXT', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'TXT',
          error: getParserErrorMessage(error)
        }
      }
    case 'docx':
      try {
        const document = await DocxParser.encodeToIntermediate(file)
        return { status: 'parsed', label: 'DOCX', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'DOCX',
          error: getParserErrorMessage(error)
        }
      }
    case 'md':
    case 'markdown':
      try {
        const document = await MarkdownParser.encode(file)
        return { status: 'parsed', label: 'Markdown', document }
      } catch (error) {
        return {
          status: 'failed',
          label: 'Markdown',
          error: getParserErrorMessage(error)
        }
      }
    default:
      return { status: 'unsupported', error: UNSUPPORTED_FILE_TYPE_MESSAGE }
  }
}

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

  // 评论弹窗开关。点击浮动评论按钮后置 true。
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false)
  // 评论按钮浮动位置（视口坐标，px）。null 表示不渲染按钮。
  // 数据来源：选中 overlay path 的 boundingClientRect（可跨多 path）。
  const [commentButtonPosition, setCommentButtonPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  // 评论输入框草稿
  const [commentDraft, setCommentDraft] = useState('')
  // 弹窗内容滚动到底部用，保证发送后能看到新评论
  const commentListRef = useRef<HTMLUListElement | null>(null)

  // 当前激活选区的快捷查找
  const activeSelection = useMemo<ReaderSavedSelection | null>(() => {
    if (!activeSavedSelectionId) return null
    return (
      savedSelections.find(
        (selection) => selection.id === activeSavedSelectionId
      ) ?? null
    )
  }, [activeSavedSelectionId, savedSelections])

  /**
   * 计算选中 overlay 浮动评论按钮的目标位置：
   * - 取 [data-saved-selection-id={id}] 所有 path 的 boundingClientRect
   * - 选其中 top 最小（最靠上）的那个矩形作为锚点
   * - 按钮放在该矩形 top 上方 12px、水平居中
   * 当 activeSavedSelectionId 变化或滚动/窗口尺寸变化时重新计算。
   */
  useLayoutEffect(() => {
    if (!activeSavedSelectionId) {
      setCommentButtonPosition(null)
      return
    }

    let rafId = 0
    const recompute = () => {
      const paths = window.document.querySelectorAll<SVGPathElement>(
        `path[data-saved-selection-id='${CSS.escape(activeSavedSelectionId)}']`
      )
      if (paths.length === 0) {
        setCommentButtonPosition(null)
        return
      }
      let topmost: DOMRect | null = null
      paths.forEach((path) => {
        const rect = path.getBoundingClientRect()
        // 跳过尺寸为 0 的不可见 path
        if (rect.width === 0 || rect.height === 0) return
        if (!topmost || rect.top < topmost.top) {
          topmost = rect
        }
      })
      if (!topmost) {
        setCommentButtonPosition(null)
        return
      }
      // 必须显式断言，否则 TS 在闭包中将 topmost 推断为 never
      const anchor = topmost as DOMRect
      setCommentButtonPosition({
        left: anchor.left + anchor.width / 2,
        top: anchor.top
      })
    }

    // 初次计算用 rAF，等 React 提交完 overlay DOM 后再读取布局
    rafId = window.requestAnimationFrame(recompute)
    const handleScrollOrResize = () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      rafId = window.requestAnimationFrame(recompute)
    }
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [activeSavedSelectionId])

  // 切换选区时重置评论草稿；激活选区被清空时关闭弹窗
  useEffect(() => {
    setCommentDraft('')
    if (!activeSavedSelectionId) {
      setIsCommentDialogOpen(false)
    }
  }, [activeSavedSelectionId])

  // 弹窗打开后滚动评论列表到底部，便于查看最新评论
  const activeCommentCount = activeSelection?.comments?.length ?? 0
  useEffect(() => {
    if (!isCommentDialogOpen) return
    const node = commentListRef.current
    if (node && activeCommentCount >= 0) {
      node.scrollTop = node.scrollHeight
    }
  }, [isCommentDialogOpen, activeCommentCount])

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
      const selectedPages = buildParserPages()
      const result = await parseUploadedDocument(file, selectedPages)

      if (requestId !== requestIdRef.current) {
        return
      }

      if (result.status === 'unsupported') {
        setParseError(result.error)
        setDocument(null)
        return
      }

      if (result.status === 'failed') {
        setParseError(`Failed to parse ${result.label}: ${result.error}`)
        setDocument(null)
        return
      }

      if (result.document === undefined) {
        setParseError(
          `Failed to parse ${result.label}: received undefined result`
        )
        setDocument(null)
        return
      }

      setDocument(result.document)
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return
      }

      setParseError(`Failed to parse file: ${getParserErrorMessage(error)}`)
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

  /**
   * 发送评论：
   * 1. 仅当存在 activeSelection 且 trimmed 草稿非空时执行
   * 2. 将新 comment 追加到 activeSelection.comments，调用 handleSavedSelectionEdit
   *    复用现有持久化路径（替换数组 + 写 localStorage）
   * 3. 成功后清空草稿
   */
  const handleSendComment = useCallback(() => {
    if (!activeSelection) return
    const trimmed = commentDraft.trim()
    if (trimmed.length === 0) return
    const newComment: ReaderSavedSelectionComment = {
      id: generateId(),
      text: trimmed,
      createdAt: Date.now()
    }
    const nextSelection: ReaderSavedSelection = {
      ...activeSelection,
      comments: [...(activeSelection.comments ?? []), newComment]
    }
    handleSavedSelectionEdit(activeSelection.id, nextSelection)
    setCommentDraft('')
  }, [activeSelection, commentDraft, handleSavedSelectionEdit])

  /**
   * textarea 键盘交互：
   * - Enter（无 Shift、未输入法组词）→ 发送（阻止默认换行）
   * - Shift+Enter → 默认换行行为
   * - Esc → 关闭弹窗
   */
  const handleCommentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsCommentDialogOpen(false)
        return
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault()
        handleSendComment()
      }
    },
    [handleSendComment]
  )

  // 用于禁用发送按钮的草稿空白判断
  const isCommentDraftEmpty = commentDraft.trim().length === 0
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
        <h2>Upload {SUPPORTED_FILE_TYPE_LABEL}</h2>
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
      {/*
        浮动评论按钮：仅当有激活选区且按钮位置已计算时渲染。
        position:fixed 配合视口坐标，向上偏移 12px 让按钮悬浮在 overlay 上方；
        transform 让按钮中心对齐 overlay 顶部水平中心。
      */}
      {activeSavedSelectionId &&
        commentButtonPosition &&
        !isCommentDialogOpen && (
          <button
            type='button'
            onClick={() => setIsCommentDialogOpen(true)}
            data-testid='comment-floating-button'
            style={{
              position: 'fixed',
              left: `${commentButtonPosition.left}px`,
              top: `${commentButtonPosition.top - 12}px`,
              transform: 'translate(-50%, -100%)',
              padding: '6px 12px',
              borderRadius: '999px',
              border: '1px solid #e5e7eb',
              background: '#ffffff',
              color: '#374151',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
              cursor: 'pointer',
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              zIndex: 1000
            }}
          >
            <span aria-hidden='true'>💬</span>
            <span>评论</span>
            {activeCommentCount > 0 && (
              <span
                data-testid='comment-floating-button-count'
                style={{
                  background: '#f59e0b',
                  color: '#ffffff',
                  borderRadius: '999px',
                  padding: '0 6px',
                  fontSize: '11px',
                  lineHeight: '16px',
                  minWidth: '16px',
                  textAlign: 'center'
                }}
              >
                {activeCommentCount}
              </span>
            )}
          </button>
        )}
      {/*
        评论弹窗：受控显示。点击 backdrop 或按 Esc 关闭；
        backdrop 用 button 而不是带 role 的 div 以满足 jsx-a11y 规则。
        dialog body 通过 stopPropagation 阻止冒泡到 backdrop。
      */}
      {isCommentDialogOpen && activeSelection && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100
          }}
        >
          <button
            type='button'
            aria-label='关闭评论弹窗'
            onClick={() => setIsCommentDialogOpen(false)}
            data-testid='comment-dialog-backdrop'
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              background: 'rgba(17, 24, 39, 0.45)'
            }}
          />
          <div
            role='dialog'
            aria-modal='true'
            aria-label='选区评论'
            style={{
              position: 'relative',
              width: 'min(480px, 92vw)',
              maxHeight: 'min(560px, 80vh)',
              background: '#ffffff',
              borderRadius: '12px',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.24)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            data-testid='comment-dialog'
          >
            <header
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
              >
                <strong style={{ fontSize: '14px', color: '#111827' }}>
                  评论 ({activeCommentCount})
                </strong>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6b7280',
                    maxWidth: '360px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={activeSelection.text}
                >
                  {activeSelection.text || '(空白选区)'}
                </span>
              </div>
              <button
                type='button'
                onClick={() => setIsCommentDialogOpen(false)}
                aria-label='关闭'
                data-testid='comment-dialog-close'
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: '18px',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '4px 8px'
                }}
              >
                ×
              </button>
            </header>
            <ul
              ref={commentListRef}
              data-testid='comment-list'
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '12px 16px',
                overflowY: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                background: '#f9fafb'
              }}
            >
              {activeCommentCount === 0 && (
                <li
                  data-testid='comment-empty'
                  style={{
                    fontSize: '13px',
                    color: '#9ca3af',
                    textAlign: 'center',
                    padding: '24px 8px'
                  }}
                >
                  还没有评论，写下第一条吧。
                </li>
              )}
              {activeSelection.comments?.map((comment) => (
                <li
                  key={comment.id}
                  data-testid='comment-item'
                  style={{
                    background: '#ffffff',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    border: '1px solid #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#9ca3af'
                    }}
                  >
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      color: '#374151',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {comment.text}
                  </span>
                </li>
              ))}
            </ul>
            <footer
              style={{
                padding: '12px 16px',
                borderTop: '1px solid #e5e7eb',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                background: '#ffffff'
              }}
            >
              <textarea
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                onKeyDown={handleCommentKeyDown}
                placeholder='写下你的评论… (Enter 发送，Shift+Enter 换行)'
                data-testid='comment-input'
                rows={3}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  padding: '8px 10px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px'
                }}
              >
                <button
                  type='button'
                  onClick={() => setIsCommentDialogOpen(false)}
                  data-testid='comment-cancel-button'
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                    background: '#ffffff',
                    color: '#374151',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  取消
                </button>
                <button
                  type='button'
                  onClick={handleSendComment}
                  disabled={isCommentDraftEmpty}
                  data-testid='comment-send-button'
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: isCommentDraftEmpty ? '#cbd5e1' : '#3b82f6',
                    color: '#ffffff',
                    cursor: isCommentDraftEmpty ? 'not-allowed' : 'pointer',
                    fontSize: '13px'
                  }}
                >
                  发送
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
