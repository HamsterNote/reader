import type {
  IntermediateDocument,
  IntermediateDocumentSerialized,
  IntermediateText
} from '@hamster-note/types'
import { type ReactElement, useCallback, useRef, useState } from 'react'

import type {
  BackgroundQuality,
  ReaderInteractionMode,
  ReaderPageRange,
  ReaderRenderMode,
  ReaderSavedSelection,
  ReaderSavedSelectionEditDetail,
  ReaderSavedSelectionRestoreResult,
  ReaderSelectedTextDragCallback,
  ReaderSelectedTextSegment,
  ReaderSelectionHandleRenderProps,
  ReaderSelectionOverlayOptions,
  ReaderTextSelectionDetail
} from './IntermediateDocumentViewer'
import { IntermediateDocumentViewer } from './IntermediateDocumentViewer'

export type ReaderProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  className?: string
  emptyText?: string
  onFileUpload?: (file: File) => void
  overscanPages?: number
  pageRange?: ReaderPageRange
  renderMode?: ReaderRenderMode
  backgroundQuality?: BackgroundQuality
  ocr?: boolean | { enabled?: boolean }
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
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
  onDragSelectedTextStart?: ReaderSelectedTextDragCallback
  onDragSelectedTextMove?: ReaderSelectedTextDragCallback
  onDragSelectedTextEnd?: ReaderSelectedTextDragCallback
  selectionOverlay?: boolean | ReaderSelectionOverlayOptions
  // 允许传入 null 显式禁用手柄渲染（透传给底层 IntermediateDocumentViewer）
  selectionHandleElement?: ReactElement<ReaderSelectionHandleRenderProps> | null
  /** 已保存的选择列表（可选），透传给 IntermediateDocumentViewer */
  savedSelections?: ReaderSavedSelection[]
  /** 编辑已保存选择时的回调（可选），仅在拖动手柄提交时触发一次 */
  onSavedSelectionEdit?: (
    id: string,
    selection: ReaderSavedSelection,
    detail: ReaderSavedSelectionEditDetail
  ) => void
  /** 当前激活的已保存选择 ID（可选） */
  activeSavedSelectionId?: string | null
  /** 激活选择变化时的回调（可选） */
  onActiveSavedSelectionChange?: (id: string | null) => void
  /** 已保存选择恢复完成时的回调（可选） */
  onSavedSelectionRestore?: (
    results: ReaderSavedSelectionRestoreResult[]
  ) => void
  /** 交互模式，透传给 IntermediateDocumentViewer */
  interactionMode?: ReaderInteractionMode
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
   * requested. In html-parser mode, eviction releases per-page decoded HTML and
   * fallback state; evicted pages are decoded again when they re-enter the
   * loadable window.
   */
  maxLoadedPages?: number
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
  renderMode,
  backgroundQuality,
  ocr,
  onOcrError,
  onTextSelectionChange,
  onTextSelectionEnd,
  onSelectText,
  onDragSelectedTextStart,
  onDragSelectedTextMove,
  onDragSelectedTextEnd,
  selectionOverlay,
  selectionHandleElement,
  savedSelections,
  onSavedSelectionEdit,
  activeSavedSelectionId,
  onActiveSavedSelectionChange,
  onSavedSelectionRestore,
  scale,
  defaultScale,
  onScaleChange,
  minScale,
  maxScale,
  maxLoadedPages,
  interactionMode
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
      return (
        <IntermediateDocumentViewer
          document={document}
          overscan={overscanPages}
          pageRange={pageRange}
          renderMode={renderMode}
          backgroundQuality={backgroundQuality}
          ocr={ocr}
          onOcrError={onOcrError}
          onTextSelectionChange={onTextSelectionChange}
          onTextSelectionEnd={onTextSelectionEnd}
          onSelectText={onSelectText}
          onDragSelectedTextStart={onDragSelectedTextStart}
          onDragSelectedTextMove={onDragSelectedTextMove}
          onDragSelectedTextEnd={onDragSelectedTextEnd}
          selectionOverlay={selectionOverlay}
          selectionHandleElement={selectionHandleElement}
          savedSelections={savedSelections}
          onSavedSelectionEdit={onSavedSelectionEdit}
          activeSavedSelectionId={activeSavedSelectionId}
          onActiveSavedSelectionChange={onActiveSavedSelectionChange}
          onSavedSelectionRestore={onSavedSelectionRestore}
          scale={scale}
          defaultScale={defaultScale}
          onScaleChange={onScaleChange}
          minScale={minScale}
          maxScale={maxScale}
          maxLoadedPages={maxLoadedPages}
          interactionMode={interactionMode}
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
