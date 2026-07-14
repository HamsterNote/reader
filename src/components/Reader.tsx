import type { DrawingTool, DrawingValue } from '@hamster-note/painting'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { type ReactNode, type Ref, useCallback, useRef, useState } from 'react'

import type {
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
import type { IntermediateDocumentRenderTimingCallback } from './IntermediateDocumentViewer/renderTiming'
import { IntermediateDocumentViewer } from './IntermediateDocumentViewer'
import { IntermediateDocumentTextViewer } from './IntermediateDocumentViewer/IntermediateDocumentTextViewer'
import {
  Page,
  type ReaderPagePaintingMap,
  type ReaderPageRectSelectionMap,
  type ReaderPageTextSelectionMap,
  type ReaderPageTool
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
    detail: { source: 'wheel' | 'pinch'; focalPoint?: { x: number; y: number } }
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
  highlightColor?: string
  selectionColor?: string
  selectionPopover?: ReactNode
  highlightPopover?: ReactNode
  autoHighlight?: boolean
  selectionRef?: Ref<ReaderSelectionRef>
  overlayRectType?: ReaderSelectionOverlayRectType
  tool?: ReaderSelectionTool
  rects?: ReaderSelectionRectangle[]
  selectedRectId?: string | null
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  onSelectRect?: (id: string | null) => void
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  initialLoadedPages?: number
  pageLoadConcurrency?: number
  pageLoadEnterDelayMs?: number
  pageUnloadDelayMs?: number
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
  containMarginX?: number
  containMarginY?: number
  /** 是否显示布局模式的页面浏览侧栏，默认 false */
  showPageBrowser?: boolean
  selectedTool?: ReaderPageTool
  paintingTool?: DrawingTool
  pagePaintings?: ReaderPagePaintingMap
  defaultPagePaintings?: ReaderPagePaintingMap
  pageTextSelections?: ReaderPageTextSelectionMap
  defaultPageTextSelections?: ReaderPageTextSelectionMap
  pageRectSelections?: ReaderPageRectSelectionMap
  defaultPageRectSelections?: ReaderPageRectSelectionMap
  onPagePaintingChange?: (
    pageId: string,
    nextValue: DrawingValue,
    nextPaintings: ReaderPagePaintingMap
  ) => void
  onPagePaintingsChange?: (nextPaintings: ReaderPagePaintingMap) => void
  onPageTextSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRange[],
    nextPageSelections: ReaderPageTextSelectionMap
  ) => void
  onPageRectSelectionsChange?: (
    pageId: string,
    nextSelections: readonly SelectionRect[],
    nextPageSelections: ReaderPageRectSelectionMap
  ) => void
}

type ReaderLegacyCompatibilityProps = Pick<
  ReaderProps,
  | 'selectedTool'
  | 'pagePaintings'
  | 'defaultPagePaintings'
  | 'pageTextSelections'
  | 'defaultPageTextSelections'
  | 'pageRectSelections'
  | 'defaultPageRectSelections'
  | 'onPagePaintingChange'
  | 'onPagePaintingsChange'
  | 'onPageTextSelectionsChange'
  | 'onPageRectSelectionsChange'
>

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

const getSerializedPages = (
  document:
    | IntermediateDocument
    | IntermediateDocumentSerialized
    | null
    | undefined
) => {
  if (!document) {
    return null
  }

  if (Array.isArray((document as IntermediateDocumentSerialized).pages)) {
    return (document as IntermediateDocumentSerialized).pages
  }

  return null
}

const shouldUseLegacyPageMode = ({
  document,
  selectedTool,
  pagePaintings,
  defaultPagePaintings,
  pageTextSelections,
  defaultPageTextSelections,
  pageRectSelections,
  defaultPageRectSelections,
  onPagePaintingChange,
  onPagePaintingsChange,
  onPageTextSelectionsChange,
  onPageRectSelectionsChange
}: { document: ReaderProps['document'] } & ReaderLegacyCompatibilityProps) => {
  const hasLegacyProp =
    selectedTool !== undefined ||
    pagePaintings !== undefined ||
    defaultPagePaintings !== undefined ||
    pageTextSelections !== undefined ||
    defaultPageTextSelections !== undefined ||
    pageRectSelections !== undefined ||
    defaultPageRectSelections !== undefined ||
    onPagePaintingChange !== undefined ||
    onPagePaintingsChange !== undefined ||
    onPageTextSelectionsChange !== undefined ||
    onPageRectSelectionsChange !== undefined

  return hasLegacyProp && getSerializedPages(document) !== null
}

interface UploadedFile {
  name: string
  size: number
  type: string
}

function assertNever(value: never): never {
  throw new Error(`Unexpected reader page tool: ${value}`)
}

function getToolLabel(tool: ReaderPageTool): string {
  switch (tool) {
    case 'text-selection':
      return 'Text selection'
    case 'rect-selection':
      return 'Rect selection'
    case 'drawing':
      return 'Drawing'
    default:
      return assertNever(tool)
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
  highlightColor,
  selectionColor,
  selectionPopover,
  highlightPopover,
  autoHighlight,
  selectionRef,
  overlayRectType = 'percent',
  tool,
  rects,
  selectedRectId,
  onCreateRect,
  onSelectRect,
  onUpdateRect,
  initialLoadedPages,
  pageLoadConcurrency,
  pageLoadEnterDelayMs,
  pageUnloadDelayMs,
  onIntermediateDocumentRenderTiming,
  containMarginX,
  containMarginY,
  showPageBrowser,
  selectedTool,
  paintingTool = 'pen',
  pagePaintings,
  defaultPagePaintings,
  pageTextSelections,
  defaultPageTextSelections,
  pageRectSelections,
  defaultPageRectSelections,
  onPagePaintingChange,
  onPagePaintingsChange,
  onPageTextSelectionsChange,
  onPageRectSelectionsChange
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
  const resolvedSelectedTool = selectedTool ?? 'text-selection'

  const resolvedPagePaintings = pagePaintings ?? internalPagePaintings
  const resolvedPageTextSelections =
    pageTextSelections ?? internalPageTextSelections
  const resolvedPageRectSelections =
    pageRectSelections ?? internalPageRectSelections

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
        ...resolvedPagePaintings,
        [pageId]: nextValue
      }

      if (pagePaintings === undefined) {
        setInternalPagePaintings(nextPaintings)
      }

      onPagePaintingChange?.(pageId, nextValue, nextPaintings)
      onPagePaintingsChange?.(nextPaintings)
    },
    [
      onPagePaintingChange,
      onPagePaintingsChange,
      pagePaintings,
      resolvedPagePaintings
    ]
  )

  const handlePageTextSelectionsChange = useCallback(
    (pageId: string, nextSelections: readonly SelectionRange[]) => {
      const nextPageSelections: ReaderPageTextSelectionMap = {
        ...resolvedPageTextSelections,
        [pageId]: nextSelections
      }

      if (pageTextSelections === undefined) {
        setInternalPageTextSelections(nextPageSelections)
      }

      onPageTextSelectionsChange?.(pageId, nextSelections, nextPageSelections)
    },
    [onPageTextSelectionsChange, pageTextSelections, resolvedPageTextSelections]
  )

  const handlePageRectSelectionsChange = useCallback(
    (pageId: string, nextSelections: readonly SelectionRect[]) => {
      const nextPageSelections: ReaderPageRectSelectionMap = {
        ...resolvedPageRectSelections,
        [pageId]: nextSelections
      }

      if (pageRectSelections === undefined) {
        setInternalPageRectSelections(nextPageSelections)
      }

      onPageRectSelectionsChange?.(pageId, nextSelections, nextPageSelections)
    },
    [onPageRectSelectionsChange, pageRectSelections, resolvedPageRectSelections]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const rootClassName = className
    ? `hamster-reader ${className}`
    : 'hamster-reader'

  const showUploadZone = !document && !uploadedFile
  const showFileInfo = !document && uploadedFile
  const hasDocumentPages = documentHasPages(document)
  const showDocumentContent = document?.title ?? emptyText
  const serializedPages = getSerializedPages(document)
  const useLegacyPageMode = shouldUseLegacyPageMode({
    document,
    selectedTool,
    pagePaintings,
    defaultPagePaintings,
    pageTextSelections,
    defaultPageTextSelections,
    pageRectSelections,
    defaultPageRectSelections,
    onPagePaintingChange,
    onPagePaintingsChange,
    onPageTextSelectionsChange,
    onPageRectSelectionsChange
  })

  const renderLegacyDocumentContent = () => {
    if (!serializedPages || serializedPages.length === 0) {
      return showUploadZone ? emptyText : showDocumentContent
    }

    return (
      <>
        <div className='hamster-reader__document-header'>
          <p className='hamster-reader__document-kicker'>Document</p>
          <h2 className='hamster-reader__document-title'>
            {showDocumentContent}
          </h2>
          <p className='hamster-reader__document-hint'>
            Tool: {getToolLabel(resolvedSelectedTool)}
          </p>
        </div>

        <div className='hamster-reader__pages' data-testid='reader-pages'>
          {serializedPages.map((page) => (
            <Page
              key={page.id}
              page={page}
              selectedTool={resolvedSelectedTool}
              paintingTool={paintingTool}
              paintingValue={resolvedPagePaintings[page.id]}
              textSelections={resolvedPageTextSelections[page.id]}
              rectSelections={resolvedPageRectSelections[page.id]}
              onPaintingChange={(nextValue) => {
                handlePagePaintingChange(page.id, nextValue)
              }}
              onTextSelectionsChange={(nextSelections) => {
                handlePageTextSelectionsChange(page.id, nextSelections)
              }}
              onRectSelectionsChange={(nextSelections) => {
                handlePageRectSelectionsChange(page.id, nextSelections)
              }}
            />
          ))}
        </div>
      </>
    )
  }

  const renderDocumentContent = () => {
    if (useLegacyPageMode) {
      return renderLegacyDocumentContent()
    }

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
          ranges={ranges}
          defaultRanges={defaultRanges}
          selectedRangeId={selectedRangeId}
          defaultSelectedRangeId={defaultSelectedRangeId}
          onSelect={onSelect}
          onLinkedDataChange={onLinkedDataChange}
          onLinkedSelect={onLinkedSelect}
          onLinkedUpdateRange={onLinkedUpdateRange}
          onLinkedSelectRange={onLinkedSelectRange}
          onSelectRange={onSelectRange}
          onUpdateRange={onUpdateRange}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onHighlight={onHighlight}
          highlightColor={highlightColor}
          selectionColor={selectionColor}
          selectionPopover={selectionPopover}
          highlightPopover={highlightPopover}
          autoHighlight={autoHighlight}
          selectionRef={selectionRef}
          overlayRectType={overlayRectType}
          tool={tool}
          rects={rects}
          selectedRectId={selectedRectId}
          onCreateRect={onCreateRect}
          onSelectRect={onSelectRect}
          onUpdateRect={onUpdateRect}
          initialLoadedPages={initialLoadedPages}
          pageLoadConcurrency={pageLoadConcurrency}
          pageLoadEnterDelayMs={pageLoadEnterDelayMs}
          pageUnloadDelayMs={pageUnloadDelayMs}
          onIntermediateDocumentRenderTiming={
            onIntermediateDocumentRenderTiming
          }
          containMarginX={containMarginX}
          containMarginY={containMarginY}
          showPageBrowser={showPageBrowser}
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
