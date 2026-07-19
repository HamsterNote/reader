import type { DrawingTool, DrawingValue } from '@hamster-note/painting'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { type ReactNode, type Ref, useCallback, useRef, useState } from 'react'

import type {
  ReaderAnnotationHistoryChangeDetail,
  ReaderAnnotationHistoryOptions,
  ReaderAnnotationHistoryValue,
  ReaderHighlightPopover,
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderSelectionTool
} from '../types/selection'
import type {
  ReaderInteractionMode,
  ReaderPageRange,
  ReaderSelectedTextSegment,
  ReaderTextSelectionDetail,
  ReaderTouchPanMode
} from './IntermediateDocumentViewer'
import { IntermediateDocumentViewer } from './IntermediateDocumentViewer'
import { IntermediateDocumentTextViewer } from './IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import {
  DefaultHighlightPopover,
  DefaultSelectionPopover
} from './DefaultPopover'
import type { IntermediateDocumentRenderTimingCallback } from './IntermediateDocumentViewer/renderTiming'
import type {
  ReaderPagePaintingMap,
  ReaderPageRectSelectionMap,
  ReaderPageTextSelectionMap,
  ReaderPageTool
} from './Page'

export type ReaderRenderMode = 'layout' | 'text'

export type ReaderProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  className?: string
  emptyText?: string
  onFileUpload?: (file: File) => void
  overscanPages?: number
  pageRange?: ReaderPageRange
  ocr?: boolean | { enabled?: boolean }
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  renderMode?: ReaderRenderMode
  onTextSelectionChange?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  onTextSelectionEnd?: (
    text: IntermediateText,
    detail: ReaderTextSelectionDetail
  ) => void
  onSelectText?: (
    selection: Selection,
    segments: ReaderSelectedTextSegment[],
    extractedText: string
  ) => void
  interactionMode?: ReaderInteractionMode
  touchPanMode?: ReaderTouchPanMode
  scale?: number
  defaultScale?: number
  onScaleChange?: (
    scale: number,
    detail: {
      source: 'wheel' | 'pinch'
      focalPoint?: { x: number; y: number }
    }
  ) => void
  minScale?: number
  maxScale?: number
  maxLoadedPages?: number
  ranges?: ReaderSelectionRange[]
  defaultRanges?: ReaderSelectionRange[]
  selectedRangeId?: string | null
  defaultSelectedRangeId?: string | null
  onSelect?: (range: ReaderSelectionRange) => void
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  onLinkedSelect?: (range: ReaderSelectionRange) => void
  onLinkedUpdateRange?: (range: ReaderSelectionRange) => void
  onLinkedSelectRange?: (id: string | null) => void
  onSelectRange?: (id: string | null) => void
  onUpdateRange?: (range: ReaderSelectionRange) => void
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  onHighlight?: (range: ReaderSelectionRange) => void
  /** 删除指定 range 的回调（供默认 highlightPopover 的删除按钮使用） */
  onRemoveRange?: (id: string) => void
  /** 全局高亮颜色变更回调（供默认 popover 的颜色选择器使用） */
  onHighlightColorChange?: (color: string) => void
  highlightColor?: string
  selectionColor?: string
  selectionPopover?: ReactNode
  highlightPopover?: ReaderHighlightPopover
  onCommentHighlight?: (
    highlight: ReaderSelectionRange
  ) => Promise<ReaderSelectionRange>
  autoHighlight?: boolean
  selectionRef?: Ref<ReaderSelectionRef>
  overlayRectType?: ReaderSelectionOverlayRectType
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  annotationHistory?: boolean | ReaderAnnotationHistoryOptions
  onAnnotationHistoryChange?: (
    next: ReaderAnnotationHistoryValue,
    detail: ReaderAnnotationHistoryChangeDetail
  ) => void
  initialLoadedPages?: number
  pageLoadConcurrency?: number
  pageLoadEnterDelayMs?: number
  pageUnloadDelayMs?: number
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
  containMarginX?: number
  containMarginTop?: number
  containMarginBottom?: number
  /** @deprecated Use `containMarginTop` and `containMarginBottom`. */
  containMarginY?: number
  /** 是否显示布局模式的页面浏览侧栏，默认 false */
  showPageBrowser?: boolean
  /** 页面浏览侧栏被左滑关闭时触发。 */
  onPageBrowserClose?: () => void
  /** 主题色（CSS color），用于 page-browser 选中项的 outline。默认 '#2563eb'。 */
  themeColor?: string
  /** 每个 rangeId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRangeId?: Readonly<Record<string, number>>
  /** 每个 rectId 对应的评论数量，传入 page-browser 高亮列表展示评论计数徽章。 */
  commentCountByRectId?: Readonly<Record<string, number>>
  onPageLoadStatusChange?: (loadedPageNumbers: number[]) => void
  selectedTool?: ReaderPageTool
  paintingTool?: DrawingTool
  /** 绘制图形的描边颜色，默认 '#2563eb' */
  drawingStrokeColor?: string
  pagePaintings?: ReaderPagePaintingMap
  defaultPagePaintings?: ReaderPagePaintingMap
  /** @deprecated Use the linked `ranges` API. */
  pageTextSelections?: ReaderPageTextSelectionMap
  /** @deprecated Use `defaultRanges`. */
  defaultPageTextSelections?: ReaderPageTextSelectionMap
  /** @deprecated Use the page-scoped `rects` API. */
  pageRectSelections?: ReaderPageRectSelectionMap
  /** @deprecated Initialize `rects` in the host. */
  defaultPageRectSelections?: ReaderPageRectSelectionMap
  onPagePaintingChange?: (
    pageId: string,
    nextValue: DrawingValue,
    nextPaintings: ReaderPagePaintingMap
  ) => void
  onPagePaintingsChange?: (nextPaintings: ReaderPagePaintingMap) => void
  /** @deprecated Use `onSelect` and `onUpdateRange`. */
  onPageTextSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRange[],
    nextPageSelections: ReaderPageTextSelectionMap
  ) => void
  /** @deprecated Use `onCreateRect` and `onUpdateRect`. */
  onPageRectSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRect[],
    nextPageSelections: ReaderPageRectSelectionMap
  ) => void
}

export const SUPPORTED_UPLOAD_ACCEPT =
  '.pdf,application/pdf,.txt,text/plain,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,text/markdown,text/x-markdown'

export const SUPPORTED_UPLOAD_COPY = 'PDF, TXT, DOCX, and Markdown'

const documentHasPages = (
  document:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!document) {
    return false
  }

  if (Array.isArray((document as IntermediateDocumentSerialized).pages)) {
    return (document as IntermediateDocumentSerialized).pages.length > 0
  }

  return (document as IntermediateDocument).pageCount > 0
}

interface UploadedFile {
  name: string
  size: number
  type: string
}

function getLinkedRanges(
  selectionsByPage: ReaderPageTextSelectionMap
): ReaderSelectionRange[] {
  return Object.entries(selectionsByPage).flatMap(([pageId, selections]) =>
    selections.map((selection) => ({
      id: selection.id,
      text: selection.text,
      start: { selectionId: pageId, offset: selection.start },
      end: { selectionId: pageId, offset: selection.end },
      createdAt: selection.createdAt,
      overlayRectType: selection.overlayRectType,
      rectsBySelectionId: { [pageId]: [...(selection.rects ?? [])] },
      markerStyle: selection.markerStyle,
      selectionStyle: selection.selectionStyle
    }))
  )
}

function getPageTextSelection(range: ReaderSelectionRange): SelectionRange {
  const pageId = range.start.selectionId
  return {
    id: range.id,
    text: range.text,
    start: range.start.offset,
    end: range.end.offset,
    createdAt: range.createdAt,
    overlayRectType: range.overlayRectType,
    rects: [...(range.rectsBySelectionId[pageId] ?? [])],
    markerStyle: range.markerStyle,
    selectionStyle: range.selectionStyle
  }
}

function getPageRects(
  selectionsByPage: ReaderPageRectSelectionMap
): ReaderSelectionRectangle[] {
  return Object.entries(selectionsByPage).flatMap(([pageId, selections]) =>
    selections.map((selection) => ({ ...selection, selectionId: pageId }))
  )
}

function normalizeAnnotationHistoryOptions(
  annotationHistory: boolean | ReaderAnnotationHistoryOptions | undefined
): ReaderAnnotationHistoryOptions {
  if (annotationHistory === true) {
    return { enabled: true }
  }

  if (annotationHistory === false || annotationHistory === undefined) {
    return { enabled: false }
  }

  return {
    enabled: annotationHistory.enabled ?? true,
    resetKey: annotationHistory.resetKey
  }
}

export function Reader({
  document,
  className,
  emptyText = 'No document',
  onFileUpload,
  overscanPages,
  pageRange,
  ocr,
  onOcrError,
  renderMode,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  scale,
  defaultScale,
  onScaleChange,
  minScale,
  maxScale,
  maxLoadedPages,
  interactionMode,
  touchPanMode,
  ranges,
  defaultRanges,
  selectedRangeId,
  defaultSelectedRangeId,
  onSelect,
  onLinkedDataChange,
  onLinkedSelect,
  onLinkedUpdateRange,
  onLinkedSelectRange,
  onSelectRange,
  onUpdateRange,
  onSelectionStart,
  onSelectionEnd,
  onHighlight,
  onRemoveRange,
  onHighlightColorChange,
  highlightColor,
  selectionColor,
  selectionPopover,
  highlightPopover,
  onCommentHighlight,
  autoHighlight,
  selectionRef,
  overlayRectType = 'percent',
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  annotationHistory,
  onAnnotationHistoryChange,
  initialLoadedPages,
  pageLoadConcurrency,
  pageLoadEnterDelayMs,
  pageUnloadDelayMs,
  onIntermediateDocumentRenderTiming,
  containMarginX,
  containMarginTop,
  containMarginBottom,
  containMarginY,
  showPageBrowser,
  onPageBrowserClose,
  themeColor,
  commentCountByRangeId,
  commentCountByRectId,
  selectedTool,
  paintingTool = 'pen',
  drawingStrokeColor = '#2563eb',
  pagePaintings,
  defaultPagePaintings,
  pageTextSelections,
  defaultPageTextSelections,
  pageRectSelections,
  defaultPageRectSelections,
  onPagePaintingChange,
  onPagePaintingsChange,
  onPageTextSelectionsChange,
  onPageRectSelectionsChange,
  onPageLoadStatusChange
}: ReaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [internalPagePaintings, setInternalPagePaintings] =
    useState<ReaderPagePaintingMap>(defaultPagePaintings ?? {})
  const [internalPageTextSelections, setInternalPageTextSelections] =
    useState<ReaderPageTextSelectionMap>(defaultPageTextSelections ?? {})
  const [internalPageRectSelections, setInternalPageRectSelections] =
    useState<ReaderPageRectSelectionMap>(defaultPageRectSelections ?? {})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const defaultSelectionRef = useRef<ReaderSelectionRef>(null)
  const resolvedPagePaintings = pagePaintings ?? internalPagePaintings
  const pagePaintingsRef = useRef(resolvedPagePaintings)
  pagePaintingsRef.current = resolvedPagePaintings
  const resolvedPageTextSelections =
    pageTextSelections ?? internalPageTextSelections
  const resolvedPageRectSelections =
    pageRectSelections ?? internalPageRectSelections
  const pageTextSelectionsRef = useRef(resolvedPageTextSelections)
  pageTextSelectionsRef.current = resolvedPageTextSelections
  const pageRectSelectionsRef = useRef(resolvedPageRectSelections)
  pageRectSelectionsRef.current = resolvedPageRectSelections
  const resolvedRanges =
    ranges ??
    (Object.keys(resolvedPageTextSelections).length > 0
      ? getLinkedRanges(resolvedPageTextSelections)
      : undefined)
  const resolvedRects =
    rects ??
    (Object.keys(resolvedPageRectSelections).length > 0
      ? getPageRects(resolvedPageRectSelections)
      : undefined)
  const resolvedSelectionTool =
    tool ?? (selectedTool === 'rect-selection' ? 'rect' : 'text')
  const normalizedAnnotationHistory =
    normalizeAnnotationHistoryOptions(annotationHistory)
  const usesPageTextSelectionCompatibility =
    pageTextSelections !== undefined ||
    defaultPageTextSelections !== undefined ||
    onPageTextSelectionsChange !== undefined
  const usesPageRectSelectionCompatibility =
    pageRectSelections !== undefined ||
    defaultPageRectSelections !== undefined ||
    onPageRectSelectionsChange !== undefined

  const handleSelectionRef = useCallback(
    (value: ReaderSelectionRef | null) => {
      defaultSelectionRef.current = value

      if (typeof selectionRef === 'function') {
        selectionRef(value)
      } else if (selectionRef) {
        selectionRef.current = value
      }
    },
    [selectionRef]
  )
  const popoverSelectionRef =
    selectionRef && typeof selectionRef !== 'function'
      ? selectionRef
      : defaultSelectionRef
  const resolvedSelectionRef =
    typeof selectionRef === 'function'
      ? handleSelectionRef
      : (selectionRef ?? defaultSelectionRef)

  const handleFile = useCallback(
    (file: File) => {
      const fileInfo: UploadedFile = {
        name: file.name,
        size: file.size,
        type: file.type
      }
      setUploadedFile(fileInfo)
      onFileUpload?.(file)
    },
    [onFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        handleFile(files[0])
      }
    },
    [handleFile]
  )

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFile(files[0])
      }
    },
    [handleFile]
  )

  const handlePagePaintingChange = useCallback(
    (pageId: string, nextValue: DrawingValue) => {
      const nextPaintings: ReaderPagePaintingMap = {
        ...pagePaintingsRef.current,
        [pageId]: nextValue
      }
      pagePaintingsRef.current = nextPaintings

      if (pagePaintings === undefined) {
        setInternalPagePaintings(nextPaintings)
      }

      onPagePaintingChange?.(pageId, nextValue, nextPaintings)
      onPagePaintingsChange?.(nextPaintings)
    },
    [onPagePaintingChange, onPagePaintingsChange, pagePaintings]
  )

  const handleSelect = useCallback(
    (range: ReaderSelectionRange) => {
      onSelect?.(range)
      if (
        !usesPageTextSelectionCompatibility ||
        range.start.selectionId !== range.end.selectionId
      ) {
        return
      }
      const pageId = range.start.selectionId
      const nextPageSelections = {
        ...pageTextSelectionsRef.current,
        [pageId]: [
          ...(pageTextSelectionsRef.current[pageId] ?? []),
          getPageTextSelection(range)
        ]
      }
      pageTextSelectionsRef.current = nextPageSelections
      if (pageTextSelections === undefined) {
        setInternalPageTextSelections(nextPageSelections)
      }
      onPageTextSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageTextSelectionsChange,
      onSelect,
      pageTextSelections,
      usesPageTextSelectionCompatibility
    ]
  )

  const handleUpdateRange = useCallback(
    (range: ReaderSelectionRange) => {
      onUpdateRange?.(range)
      if (
        !usesPageTextSelectionCompatibility ||
        range.start.selectionId !== range.end.selectionId
      ) {
        return
      }
      const pageId = range.start.selectionId
      const nextSelection = getPageTextSelection(range)
      const nextPageSelections = {
        ...pageTextSelectionsRef.current,
        [pageId]: (pageTextSelectionsRef.current[pageId] ?? []).map(
          (selection) =>
            selection.id === nextSelection.id ? nextSelection : selection
        )
      }
      pageTextSelectionsRef.current = nextPageSelections
      if (pageTextSelections === undefined) {
        setInternalPageTextSelections(nextPageSelections)
      }
      onPageTextSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageTextSelectionsChange,
      onUpdateRange,
      pageTextSelections,
      usesPageTextSelectionCompatibility
    ]
  )

  const handleCreateRect = useCallback(
    (rectangle: ReaderSelectionRectangle) => {
      onCreateRect?.(rectangle)
      if (!usesPageRectSelectionCompatibility || !rectangle.selectionId) return
      const pageId = rectangle.selectionId
      const nextPageSelections = {
        ...pageRectSelectionsRef.current,
        [pageId]: [...(pageRectSelectionsRef.current[pageId] ?? []), rectangle]
      }
      pageRectSelectionsRef.current = nextPageSelections
      if (pageRectSelections === undefined) {
        setInternalPageRectSelections(nextPageSelections)
      }
      onPageRectSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onCreateRect,
      onPageRectSelectionsChange,
      pageRectSelections,
      usesPageRectSelectionCompatibility
    ]
  )

  const handleUpdateRect = useCallback(
    (rectangle: ReaderSelectionRectangle) => {
      onUpdateRect?.(rectangle)
      if (!usesPageRectSelectionCompatibility || !rectangle.selectionId) return
      const pageId = rectangle.selectionId
      const nextPageSelections = {
        ...pageRectSelectionsRef.current,
        [pageId]: (pageRectSelectionsRef.current[pageId] ?? []).map(
          (selection) => (selection.id === rectangle.id ? rectangle : selection)
        )
      }
      pageRectSelectionsRef.current = nextPageSelections
      if (pageRectSelections === undefined) {
        setInternalPageRectSelections(nextPageSelections)
      }
      onPageRectSelectionsChange?.(
        pageId,
        nextPageSelections[pageId],
        nextPageSelections
      )
    },
    [
      onPageRectSelectionsChange,
      onUpdateRect,
      pageRectSelections,
      usesPageRectSelectionCompatibility
    ]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const rootClassName = className
    ? `hamster-reader ${className}`
    : 'hamster-reader'

  const handleDefaultCommentHighlight = useCallback(
    async (range: ReaderSelectionRange) => {
      const result = await onCommentHighlight?.(range)
      if (selectedRangeId === range.id) {
        onSelectRange?.(null)
      }
      return result ?? range
    },
    [onCommentHighlight, selectedRangeId, onSelectRange]
  )

  const showUploadZone = !document && !uploadedFile
  const showFileInfo = !document && uploadedFile
  const hasDocumentPages = documentHasPages(document)
  const showDocumentContent = document?.title ?? emptyText
  const renderDocumentContent = () => {
    if (hasDocumentPages) {
      if (renderMode === 'text') {
        return (
          <IntermediateDocumentTextViewer
            document={document}
            pageRange={pageRange}
            className={className}
            maxLoadedPages={maxLoadedPages}
            initialLoadedPages={initialLoadedPages}
            pageLoadConcurrency={pageLoadConcurrency}
            pageLoadEnterDelayMs={pageLoadEnterDelayMs}
            pageUnloadDelayMs={pageUnloadDelayMs}
            onTextSelectionChange={onTextSelectionChange}
            onTextSelectionEnd={onTextSelectionEnd}
            onSelectText={onSelectText}
            onIntermediateDocumentRenderTiming={
              onIntermediateDocumentRenderTiming
            }
          />
        )
      }

      return (
        <IntermediateDocumentViewer
          document={document}
          overscan={overscanPages}
          pageRange={pageRange}
          ocr={ocr}
          onOcrError={onOcrError}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
          scale={scale}
          defaultScale={defaultScale}
          onScaleChange={onScaleChange}
          minScale={minScale}
          maxScale={maxScale}
          maxLoadedPages={maxLoadedPages}
          interactionMode={interactionMode}
          touchPanMode={touchPanMode}
          ranges={resolvedRanges}
          defaultRanges={defaultRanges}
          selectedRangeId={selectedRangeId}
          defaultSelectedRangeId={defaultSelectedRangeId}
          onSelect={handleSelect}
          onLinkedDataChange={onLinkedDataChange}
          onLinkedSelect={onLinkedSelect}
          onLinkedUpdateRange={onLinkedUpdateRange}
          onLinkedSelectRange={onLinkedSelectRange}
          onSelectRange={onSelectRange}
          onUpdateRange={handleUpdateRange}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onHighlight={onHighlight}
          highlightColor={highlightColor}
          selectionColor={selectionColor}
          selectionPopover={
            selectionPopover ?? (
              <DefaultSelectionPopover
                selectionRef={popoverSelectionRef}
                highlightColor={highlightColor}
                onHighlightColorChange={onHighlightColorChange}
                selectedRangeId={selectedRangeId}
                ranges={resolvedRanges}
                onUpdateRange={handleUpdateRange}
                onRemoveRange={onRemoveRange}
              />
            )
          }
          highlightPopover={
            highlightPopover ??
            ((highlight) => (
              <DefaultHighlightPopover
                selectionRef={popoverSelectionRef}
                highlightColor={highlightColor}
                onHighlightColorChange={onHighlightColorChange}
                selectedRangeId={highlight.id}
                ranges={resolvedRanges}
                onUpdateRange={handleUpdateRange}
                onRemoveRange={onRemoveRange}
                onCommentHighlight={
                  onCommentHighlight ? handleDefaultCommentHighlight : undefined
                }
              />
            ))
          }
          onCommentHighlight={highlightPopover ? onCommentHighlight : undefined}
          autoHighlight={autoHighlight}
          selectionRef={resolvedSelectionRef}
          overlayRectType={overlayRectType}
          tool={resolvedSelectionTool}
          rects={resolvedRects}
          selectedRectId={selectedRectId}
          onCreateRect={handleCreateRect}
          onSelectRect={onSelectRect}
          onUpdateRect={handleUpdateRect}
          annotationHistory={normalizedAnnotationHistory}
          onAnnotationHistoryChange={onAnnotationHistoryChange}
          initialLoadedPages={initialLoadedPages}
          pageLoadConcurrency={pageLoadConcurrency}
          pageLoadEnterDelayMs={pageLoadEnterDelayMs}
          pageUnloadDelayMs={pageUnloadDelayMs}
          onIntermediateDocumentRenderTiming={
            onIntermediateDocumentRenderTiming
          }
          containMarginX={containMarginX}
          containMarginTop={containMarginTop}
          containMarginBottom={containMarginBottom}
          containMarginY={containMarginY}
          selectedTool={selectedTool}
          paintingTool={paintingTool}
          drawingStrokeColor={drawingStrokeColor}
          pagePaintings={resolvedPagePaintings}
          onPagePaintingChange={handlePagePaintingChange}
          showPageBrowser={showPageBrowser}
          onPageBrowserClose={onPageBrowserClose}
          themeColor={themeColor}
          commentCountByRangeId={commentCountByRangeId}
          commentCountByRectId={commentCountByRectId}
          onPageLoadStatusChange={onPageLoadStatusChange}
        />
      )
    }

    return showUploadZone ? emptyText : showDocumentContent
  }

  return (
    <div className={rootClassName} data-testid='reader-root'>
      {showUploadZone && (
        <button
          type='button'
          className={`hamster-reader__upload-zone ${isDragging ? 'hamster-reader__upload-zone--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          data-testid='upload-zone'
        >
          <input
            ref={fileInputRef}
            type='file'
            accept={SUPPORTED_UPLOAD_ACCEPT}
            onChange={handleInputChange}
            className='hamster-reader__file-input'
            data-testid='file-input'
          />
          <div className='hamster-reader__upload-content'>
            <svg
              className='hamster-reader__upload-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              aria-label='Upload'
            >
              <title>Upload icon</title>
              <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
              <polyline points='17 8 12 3 7 8' />
              <line x1='12' y1='3' x2='12' y2='15' />
            </svg>
            <p className='hamster-reader__upload-text'>
              {isDragging
                ? 'Drop document here'
                : 'Click or drag document to upload'}
            </p>
            <p className='hamster-reader__upload-hint'>
              Supports PDF, TXT, DOCX, and Markdown files
            </p>
          </div>
        </button>
      )}

      {showDocumentContent && !showFileInfo && (
        <div className='hamster-reader__content' data-testid='reader-content'>
          {renderDocumentContent()}
        </div>
      )}

      {showFileInfo && (
        <div className='hamster-reader__file-info' data-testid='file-info'>
          <svg
            className='hamster-reader__file-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-label='File'
          >
            <title>File icon</title>
            <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
            <polyline points='14 2 14 8 20 8' />
          </svg>
          <div className='hamster-reader__file-details'>
            <p className='hamster-reader__file-name'>{uploadedFile.name}</p>
            <p className='hamster-reader__file-meta'>
              {formatFileSize(uploadedFile.size)} •{' '}
              {uploadedFile.type || 'unknown type'}
            </p>
          </div>
          <button
            type='button'
            className='hamster-reader__upload-another'
            onClick={handleClick}
            data-testid='upload-another-btn'
          >
            Upload Another
          </button>
        </div>
      )}
    </div>
  )
}
