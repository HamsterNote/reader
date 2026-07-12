import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { useCallback, useRef, useState } from 'react'

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
import type {
  ReaderLinkedSelectionData,
  ReaderMousePosition,
  ReaderSelectionOverlayRectType,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderSelectionTool
} from '../types/selection'

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
  /**
   * Reader 级渲染模式。
   * - `'layout'`（默认/省略）：走现有 `IntermediateDocumentViewer` + `VirtualPaper` 的
   *   布局渲染路径，保留全部缩放 / linked-range selection / overlay 能力。
   * - `'text'`：走独立的 `IntermediateDocumentTextViewer` 文本模式路径，不经过
   *   `VirtualPaper`，仅接受文本模式子集 props。
   */
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
  /** 交互模式，透传给 IntermediateDocumentViewer */
  interactionMode?: ReaderInteractionMode
  /** 触摸文档平移模式，透传给 IntermediateDocumentViewer in layout mode；默认 single-finger */
  touchPanMode?: ReaderTouchPanMode
  // ---- Zoom props (all optional, forwarded unchanged) ----
  /**
   * Controlled zoom scale. When provided, Reader never mutates zoom internally;
   * wheel/pinch gestures only report the next clamped value through
   * `onScaleChange`, and the caller must pass a new `scale` back to update the
   * view. Invalid/non-positive values are ignored in favor of the safe default
   * scale of `1`, clamped to the active bounds.
   */
  scale?: number
  /**
   * Initial zoom scale for uncontrolled mode. This value is read once on mount,
   * defaults to `1`, and is clamped to `minScale`/`maxScale`; later
   * `defaultScale` changes do not reset user zoom.
   */
  defaultScale?: number
  /**
   * Called after a wheel or pinch gesture requests a real scale change. The
   * first argument is the clamped next scale; `detail.source` identifies the
   * gesture and `detail.focalPoint`, when present, is the viewport point that
   * should remain visually anchored.
   */
  onScaleChange?: (
    scale: number,
    detail: { source: 'wheel' | 'pinch'; focalPoint?: { x: number; y: number } }
  ) => void
  /**
   * Minimum allowed zoom scale. Defaults to `0.25`; invalid or non-positive
   * values fall back to that default. If `minScale` exceeds `maxScale`, the
   * effective maximum is raised to the minimum so the range remains safe.
   */
  minScale?: number
  /**
   * Maximum allowed zoom scale. Defaults to `4`; invalid or non-positive values
   * fall back to that default before the range is normalized.
   */
  maxScale?: number
  // ---- Lazy-release prop ----
  /**
   * Maximum number of concurrently loaded pages before lazy eviction. The
   * default is `max(5, overscanPages * 2 + 5)`. Only `Infinity` disables
   * eviction entirely; `0`, negative, `NaN`, or other invalid values fall back
   * to the default cap. Finite values are floored by the pages that must remain
   * protected (visible pages, overscan, in-flight work, selections, active
   * drags, and saved-selection anchors), so the runtime may keep more pages than
   */
  maxLoadedPages?: number
  /** 受控的已高亮 range 列表 */
  ranges?: ReaderSelectionRange[]
  /** 非受控模式下 ranges 的初始值 */
  defaultRanges?: ReaderSelectionRange[]
  /** 受控的当前选中 range ID */
  selectedRangeId?: string | null
  /** 非受控模式下 selectedRangeId 的初始值 */
  defaultSelectedRangeId?: string | null
  /** 用户确认高亮时触发 */
  onSelect?: (range: ReaderSelectionRange) => void
  onLinkedDataChange?: (next: ReaderLinkedSelectionData) => void
  onLinkedSelect?: (range: ReaderSelectionRange) => void
  onLinkedUpdateRange?: (range: ReaderSelectionRange) => void
  onLinkedSelectRange?: (id: string | null) => void
  /** 用户点击或取消选中某个已高亮 range 时触发 */
  onSelectRange?: (id: string | null) => void
  /** 用户拖动已高亮 range 的首尾手柄调整范围时触发 */
  onUpdateRange?: (range: ReaderSelectionRange) => void
  /** 用户开始选择时触发（容器内 mousedown） */
  onSelectionStart?: (
    mousePos: ReaderMousePosition,
    selection: Selection
  ) => void
  /** 用户结束选择时触发（容器内 mouseup）；注意 touch 选择可能不触发 */
  onSelectionEnd?: (mousePos: ReaderMousePosition, selection: Selection) => void
  /** 执行高亮操作时额外触发（在 onSelect 之后） */
  onHighlight?: (range: ReaderSelectionRange) => void
  /** 已确认高亮的 Overlay 颜色 */
  highlightColor?: string
  /** 正在选择中的临时 Overlay 颜色 */
  selectionColor?: string
  /** 被选中的高亮上方弹出的 Popover 内容 */
  selectionPopover?: React.ReactNode
  /** 被高亮的片段上方弹出的 Popover 内容，未提供时 fallback 到 selectionPopover */
  highlightPopover?: React.ReactNode
  /** 是否在选区结束时自动触发高亮，默认为 false */
  autoHighlight?: boolean
  /** Reader 自有命令式 ref，暴露 highlight()/confirm()/confirmRect()/clear()/scrollToRange(id) */
  selectionRef?: React.Ref<ReaderSelectionRef>
  /** 选区 Overlay 矩形坐标类型；默认 'percent' */
  overlayRectType?: ReaderSelectionOverlayRectType
  /** 当前选择工具模式；默认 'text'，传 'rect' 启用矩形框选，透传给 selection */
  tool?: ReaderSelectionTool
  /** 当前已存在的矩形框选列表（受控），透传给 selection */
  rects?: ReaderSelectionRectangle[]
  /** 当前被选中的矩形框选 ID（受控属性），透传给 selection */
  selectedRectId?: string | null
  /** 当用户确认一个新矩形框选时触发，透传给 selection */
  onCreateRect?: (rect: ReaderSelectionRectangle) => void
  /** 当用户选中/取消选中某个矩形框选时触发，透传给 selection */
  onSelectRect?: (id: string | null) => void
  /** 当用户拖动矩形手柄调整后触发，透传给 selection */
  onUpdateRect?: (rect: ReaderSelectionRectangle) => void
  // ---- intermediate-document 懒加载队列 props（转发给 IntermediateDocumentViewer）----
  /** 初始立即加载的页数，转发给 viewer，默认 1 */
  initialLoadedPages?: number
  /** 并发加载页数上限，转发给 viewer，默认 3 */
  pageLoadConcurrency?: number
  /** 进入可加载窗口后发起加载前的延迟（毫秒），转发给 viewer，默认 500 */
  pageLoadEnterDelayMs?: number
  /** 离开可加载窗口后卸载内容的延迟（毫秒），转发给 viewer，默认 5000 */
  pageUnloadDelayMs?: number
  /** intermediate-document 渲染阶段计时回调，转发给 IntermediateDocumentViewer */
  onIntermediateDocumentRenderTiming?: IntermediateDocumentRenderTimingCallback
  /** 内容区水平留白边距，单位 px，转发给 VirtualPaper */
  containMarginX?: number
  /** 内容区垂直留白边距，单位 px，转发给 VirtualPaper */
  containMarginY?: number
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
  containMarginY
}: ReaderProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const renderDocumentContent = () => {
    if (hasDocumentPages) {
      // text 模式走独立的 IntermediateDocumentTextViewer，不经过 VirtualPaper。
      // 仅转发文本模式支持的 props 子集，layout 独有 props（缩放/linked-range
      // selection/overlay 等）不传入文本视图。
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
