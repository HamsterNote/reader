import type { DrawingTool, DrawingValue } from '@hamster-note/painting'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { useCallback, useRef, useState } from 'react'

import {
  Page,
  type ReaderPagePaintingMap,
  type ReaderPageRectSelectionMap,
  type ReaderPageTextSelectionMap,
  type ReaderPageTool
} from './Page'

export type ReaderProps = {
  document?: IntermediateDocumentSerialized | null
  className?: string
  emptyText?: string
  onFileUpload?: (file: File) => void
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
  selectedTool = 'text-selection',
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
  const showDocumentContent = document?.title ?? emptyText
  const showFileInfo = !document && uploadedFile
  const pages = document?.pages ?? []
  const showPages = pages.length > 0

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
            accept='.pdf,application/pdf'
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
              {isDragging ? 'Drop PDF here' : 'Click or drag PDF to upload'}
            </p>
            <p className='hamster-reader__upload-hint'>Supports PDF files</p>
          </div>
        </button>
      )}

      {showDocumentContent && !showFileInfo && (
        <div className='hamster-reader__content' data-testid='reader-content'>
          {showUploadZone ? (
            emptyText
          ) : (
            <>
              <div className='hamster-reader__document-header'>
                <p className='hamster-reader__document-kicker'>Document</p>
                <h2 className='hamster-reader__document-title'>
                  {showDocumentContent}
                </h2>
                <p className='hamster-reader__document-hint'>
                  Tool: {getToolLabel(selectedTool)}
                </p>
              </div>

              {showPages && (
                <div
                  className='hamster-reader__pages'
                  data-testid='reader-pages'
                >
                  {pages.map((page) => (
                    <Page
                      key={page.id}
                      page={page}
                      selectedTool={selectedTool}
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
              )}
            </>
          )}
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
              {uploadedFile.type || 'application/pdf'}
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
