import { HtmlParser, type DecodeOptions } from '@hamster-note/html-parser'
import {
  IntermediateDocument,
  type IntermediateContent,
  type IntermediateDocumentSerialized,
  type IntermediateText
} from '@hamster-note/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ReaderTextSelectionDetail = {
  text: IntermediateText
  texts: IntermediateText[]
  selectedText: string
  pageNumber: number
  selection: Selection
}

export type ReaderPageRange = {
  start: number
  end: number
}

/** 背景质量级别：low（低）、medium（中）、high（高） */
export type BackgroundQuality = 'low' | 'medium' | 'high'

/** 将背景质量级别映射为 html-parser 的 backgroundQuality 数值（0-1） */
const BACKGROUND_QUALITY_MAP: Record<BackgroundQuality, number> = {
  low: 0.1,
  medium: 0.3,
  high: 0.8
}

export type IntermediateDocumentViewerProps = {
  document?: IntermediateDocument | IntermediateDocumentSerialized | null
  serializedDocument?: IntermediateDocumentSerialized | null
  className?: string
  overscan?: number
  pageRange?: ReaderPageRange
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
}

type PageSize = {
  width: number
  height: number
}

type RenderableIntermediateText = IntermediateText &
  Partial<{
    x: number
    y: number
    width: number
    height: number
    polygon: [number, number][]
    rotate: number
    skew: number
  }>

type PageLoadStatus = 'loaded' | 'error'
type HtmlParserDocumentInput = Parameters<typeof HtmlParser.decodeToHtml>[0]

const DEFAULT_PAGE_SIZE: PageSize = {
  width: 595,
  height: 842
}

const isRuntimeDocument = (
  document: IntermediateDocument | IntermediateDocumentSerialized
): document is IntermediateDocument =>
  typeof (document as IntermediateDocument).getPageByPageNumber === 'function'

const isIntermediateText = (
  content: IntermediateContent
): content is IntermediateText => 'content' in content && 'fontSize' in content

const normalizePageSize = (size: { x?: number; y?: number } | undefined) => {
  const pageSizeUnavailable =
    !(typeof size?.x === 'number' && size.x > 0) ||
    !(typeof size?.y === 'number' && size.y > 0)
  const width =
    typeof size?.x === 'number' && size.x > 0 ? size.x : DEFAULT_PAGE_SIZE.width
  const height =
    typeof size?.y === 'number' && size.y > 0
      ? size.y
      : DEFAULT_PAGE_SIZE.height

  return { width, height, pageSizeUnavailable }
}

const getTextBoundingBox = (polygon: [number, number][]) => {
  if (!polygon || polygon.length < 4) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const xs = polygon.map((point) => point?.[0]).filter(Number.isFinite)
  const ys = polygon.map((point) => point?.[1]).filter(Number.isFinite)
  if (xs.length === 0 || ys.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const getPolygonTextGeometry = (
  polygon: [number, number][] | undefined
): {
  x: number
  y: number
  width: number
  height: number
  rotation: number
} | null => {
  if (
    !polygon ||
    polygon.length !== 4 ||
    !polygon.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        typeof p[0] === 'number' &&
        typeof p[1] === 'number' &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1])
    )
  ) {
    return null
  }

  const p0 = polygon[0]
  const p1 = polygon[1]
  const p2 = polygon[2]

  const width = Math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2)
  const height = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2)

  if (width === 0 || height === 0) {
    return null
  }

  const rotation = (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI

  return {
    x: p0[0],
    y: p0[1],
    width,
    height,
    rotation
  }
}

const getTextTransform = (
  text: RenderableIntermediateText,
  skipRotate?: boolean
) => {
  const transforms: string[] = []

  if (!skipRotate && text.rotate) {
    transforms.push(`rotate(${text.rotate}deg)`)
  }

  if (text.skew) {
    transforms.push(`skewX(${text.skew}deg)`)
  }

  return transforms.length > 0 ? transforms.join(' ') : undefined
}

const getTextBbox = (text: RenderableIntermediateText) => {
  const polygonGeometry = getPolygonTextGeometry(text.polygon)
  const usePolygonGeometry = polygonGeometry !== null

  if (usePolygonGeometry) {
    return {
      x: polygonGeometry.x,
      y: polygonGeometry.y,
      width: polygonGeometry.width,
      height: polygonGeometry.height,
      rotation: polygonGeometry.rotation
    }
  }

  if (text.polygon) {
    return {
      ...getTextBoundingBox(text.polygon),
      rotation: 0
    }
  }

  return {
    x: text.x ?? 0,
    y: text.y ?? 0,
    width: text.width ?? 0,
    height: text.height ?? 0,
    rotation: 0
  }
}

const buildTextSpanStyle = (
  text: RenderableIntermediateText,
  bbox: ReturnType<typeof getTextBbox>
) => {
  const textTransform = getTextTransform(text, !!bbox.rotation)
  const transform = [
    bbox.rotation ? `rotate(${bbox.rotation}deg)` : '',
    textTransform
  ]
    .filter(Boolean)
    .join(' ')

  return {
    position: 'absolute' as const,
    left: Number.isFinite(bbox.x) ? `${bbox.x}px` : '0px',
    top: Number.isFinite(bbox.y) ? `${bbox.y}px` : '0px',
    width:
      Number.isFinite(bbox.width) && bbox.width > 0
        ? `${bbox.width}px`
        : undefined,
    height:
      Number.isFinite(bbox.height) && bbox.height > 0
        ? `${bbox.height}px`
        : undefined,
    fontSize:
      Number.isFinite(text.fontSize) && text.fontSize > 0
        ? `${text.fontSize}px`
        : undefined,
    fontFamily: text.fontFamily || undefined,
    fontWeight: text.fontWeight || undefined,
    fontStyle: text.italic ? 'italic' : undefined,
    color: text.color || undefined,
    lineHeight:
      Number.isFinite(text.lineHeight) && text.lineHeight > 0
        ? `${text.lineHeight}px`
        : undefined,
    transform,
    transformOrigin: 'left top' as const,
    whiteSpace: 'pre' as const
  }
}

const createSetTextsHandler = (
  pageNumber: number,
  texts: IntermediateText[]
) => {
  return (currentTexts: Map<number, IntermediateText[]>) => {
    const nextTexts = new Map(currentTexts)
    nextTexts.set(pageNumber, texts)
    return nextTexts
  }
}

const createSetPageStatusHandler = (
  pageNumber: number,
  status: PageLoadStatus
) => {
  return (currentStatuses: Map<number, PageLoadStatus>) => {
    const nextStatuses = new Map(currentStatuses)
    nextStatuses.set(pageNumber, status)
    return nextStatuses
  }
}

const createSetBaseImageHandler = (
  pageNumber: number,
  baseImage: string | undefined
) => {
  return (currentImages: Map<number, string>) => {
    const nextImages = new Map(currentImages)
    if (baseImage) {
      nextImages.set(pageNumber, baseImage)
    } else {
      nextImages.delete(pageNumber)
    }
    return nextImages
  }
}

const getOcrCacheKey = (
  docId: string,
  pageNumber: number,
  imageSource: string
) => `${docId}::${pageNumber}::${imageSource}`

type PageWithBaseImage = {
  thumbnail?: unknown
  image?: unknown
  getThumbnail?: () => Promise<unknown> | unknown
}

const getStringBaseImage = (imageSource: unknown) => {
  return typeof imageSource === 'string' && imageSource.trim()
    ? imageSource
    : undefined
}

const getBaseImageFromPage = async (page: unknown) => {
  if (!page || typeof page !== 'object') {
    return undefined
  }

  const pageWithImage = page as PageWithBaseImage
  const directBaseImage =
    getStringBaseImage(pageWithImage.thumbnail) ??
    getStringBaseImage(pageWithImage.image)

  if (directBaseImage) {
    return directBaseImage
  }

  if (typeof pageWithImage.getThumbnail !== 'function') {
    return undefined
  }

  try {
    return getStringBaseImage(await pageWithImage.getThumbnail())
  } catch {
    return undefined
  }
}

const getImageParserInput = async (imageSource: string) => {
  const response = await fetch(imageSource)
  return response.blob()
}

const prefixOcrTextIds = (texts: IntermediateText[], pageNumber: number) =>
  texts.map((text) => ({
    ...text,
    id: `ocr-${pageNumber}-${text.id}`
  }))

export const getClosestTextElement = (
  node: Node | null
): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-text-id]') ?? null
}

const clampToRange = (value: number, min: number, max: number): number => {
  if (value < min) return min - value
  if (value > max) return value - max
  return 0
}

const getPointToRectDistanceSquared = (
  point: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number }
): number => {
  const dx = clampToRange(point.x, rect.left, rect.right)
  const dy = clampToRange(point.y, rect.top, rect.bottom)
  return dx * dx + dy * dy
}

export const getPageElementForPoint = (
  clientX: number,
  clientY: number,
  viewerRoot: HTMLElement | null,
  pageRefs: Map<number, HTMLDivElement>
): { pageElement: HTMLElement; pageNumber: number } | null => {
  if (!viewerRoot) return null

  const hitElement = document
    .elementFromPoint(clientX, clientY)
    ?.closest('[data-page-number]')

  if (hitElement && viewerRoot.contains(hitElement)) {
    const pageNumber = Number((hitElement as HTMLElement).dataset.pageNumber)
    return { pageElement: hitElement as HTMLElement, pageNumber }
  }

  let nearestElement: HTMLElement | null = null
  let minDistance = Infinity

  for (const element of pageRefs.values()) {
    const rect = element.getBoundingClientRect()
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )
    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element
    }
  }

  if (!nearestElement) return null

  return {
    pageElement: nearestElement,
    pageNumber: Number(nearestElement.dataset.pageNumber)
  }
}

export const getNearestTextElementForPoint = (
  clientX: number,
  clientY: number,
  pageNumber: number,
  viewerRoot: HTMLElement | null,
  textElementsRef: Map<string, { text: IntermediateText; pageNumber: number }>
): HTMLElement | null => {
  if (!viewerRoot) return null

  let nearestElement: HTMLElement | null = null
  let minDistance = Infinity

  for (const [id, entry] of textElementsRef.entries()) {
    if (entry.pageNumber !== pageNumber) continue

    const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
    if (!element) continue

    const rect = element.getBoundingClientRect()
    const distance = getPointToRectDistanceSquared(
      { x: clientX, y: clientY },
      rect
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestElement = element as HTMLElement
    } else if (distance === minDistance && nearestElement) {
      if (
        (element as HTMLElement).compareDocumentPosition(nearestElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
      ) {
        nearestElement = element as HTMLElement
      }
    }
  }

  return nearestElement
}

export function IntermediateDocumentViewer({
  document,
  serializedDocument,
  className,
  overscan = 1,
  pageRange,
  backgroundQuality,
  ocr,
  onOcrError,
  onTextSelectionChange,
  onTextSelectionEnd
}: IntermediateDocumentViewerProps) {
  const runtimeDocument = useMemo(() => {
    const inputDocument = document ?? serializedDocument

    if (!inputDocument) {
      return null
    }

    return isRuntimeDocument(inputDocument)
      ? inputDocument
      : IntermediateDocument.parse(inputDocument)
  }, [document, serializedDocument])

  const pageNumbers = useMemo(() => {
    const allPageNumbers = runtimeDocument?.pageNumbers ?? []

    if (!pageRange) {
      return allPageNumbers
    }

    const start = Math.trunc(pageRange.start)
    const end = Math.trunc(pageRange.end)

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return []
    }

    return allPageNumbers.filter(
      (pageNumber) => pageNumber >= start && pageNumber <= end
    )
  }, [runtimeDocument, pageRange])
  const pageRefs = useRef(new Map<number, HTMLDivElement>())
  const loadingPagesRef = useRef(new Set<number>())
  const ocrLoadingPagesRef = useRef(new Set<number>())
  const ocrCacheRef = useRef(new Map<string, IntermediateText[]>())
  const activeDocumentRef = useRef<IntermediateDocument | null>(null)
  const isMountedRef = useRef(false)
  const viewerRootRef = useRef<HTMLDivElement>(null)
  const textElementsRef = useRef<
    Map<string, { text: IntermediateText; pageNumber: number }>
  >(new Map())
  const activeMouseSelectionRef = useRef<{
    active: boolean
    clientX: number
    clientY: number
  }>({ active: false, clientX: 0, clientY: 0 })
  const [loadablePages, setLoadablePages] = useState(() => new Set<number>())
  const [visiblePages, setVisiblePages] = useState(() => new Set<number>())
  const [textsByPageNumber, setTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [ocrTextsByPageNumber, setOcrTextsByPageNumber] = useState(
    () => new Map<number, IntermediateText[]>()
  )
  const [pageStatuses, setPageStatuses] = useState(
    () => new Map<number, PageLoadStatus>()
  )
  const [baseImagesByPageNumber, setBaseImagesByPageNumber] = useState(
    () => new Map<number, string>()
  )
  const [htmlContent, setHtmlContent] = useState<string | null>(null)
  const [htmlParserError, setHtmlParserError] = useState(false)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      activeDocumentRef.current = null
    }
  }, [])

  useEffect(() => {
    activeDocumentRef.current = runtimeDocument
    loadingPagesRef.current.clear()
    ocrLoadingPagesRef.current.clear()
    ocrCacheRef.current.clear()
    setLoadablePages(new Set())
    setVisiblePages(new Set())
    setTextsByPageNumber(new Map())
    setOcrTextsByPageNumber(new Map())
    setPageStatuses(new Map())
    setBaseImagesByPageNumber(new Map())
    setHtmlContent(null)
    setHtmlParserError(false)
  }, [runtimeDocument])

  // Primary render path: convert the runtime document to HTML via @hamster-note/html-parser.
  // On success we render the HTML fragment directly. Because html-parser output does not
  // expose the same `data-text-id` span tree that powers text-selection and OCR overlays,
  // those features are only fully available on the fallback (direct-render) path.
  // The fallback automatically activates when decodeToHtml throws or returns empty.
  useEffect(() => {
    if (!runtimeDocument) {
      setHtmlContent(null)
      setHtmlParserError(false)
      return
    }

    let cancelled = false

    const decodeOptions: DecodeOptions | undefined = backgroundQuality
      ? { background: { backgroundQuality: BACKGROUND_QUALITY_MAP[backgroundQuality] } }
      : undefined

    HtmlParser.decodeToHtml(
      runtimeDocument as unknown as HtmlParserDocumentInput,
      decodeOptions
    )
      .then((html) => {
        if (!cancelled) {
          setHtmlContent(html)
          setHtmlParserError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtmlContent(null)
          setHtmlParserError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [runtimeDocument, backgroundQuality])

  const markLoadableWithOverscan = useCallback(
    (pageNumber: number) => {
      const pageIndex = pageNumbers.indexOf(pageNumber)

      if (pageIndex === -1) {
        return
      }

      const safeOverscan = Math.max(0, overscan)
      const startIndex = Math.max(0, pageIndex - safeOverscan)
      const endIndex = Math.min(
        pageNumbers.length - 1,
        pageIndex + safeOverscan
      )

      setLoadablePages((currentPages) => {
        const nextPages = new Set(currentPages)

        for (let index = startIndex; index <= endIndex; index += 1) {
          nextPages.add(pageNumbers[index])
        }

        return nextPages
      })
    },
    [overscan, pageNumbers]
  )

  const setPageRef = useCallback(
    (pageNumber: number) => (element: HTMLDivElement | null) => {
      if (element) {
        pageRefs.current.set(pageNumber, element)
      } else {
        pageRefs.current.delete(pageNumber)
      }
    },
    []
  )

  const setTextRef = useCallback(
    (text: IntermediateText, pageNumber: number) =>
      (element: HTMLSpanElement | null) => {
        if (element) {
          textElementsRef.current.set(text.id, { text, pageNumber })
        } else {
          textElementsRef.current.delete(text.id)
        }
      },
    []
  )

  const buildNormalizedSelection = useCallback(
    (
      selection: Selection,
      viewerRoot: HTMLElement
    ): ReaderTextSelectionDetail | null => {
      if (!activeMouseSelectionRef.current.active) return null

      const startElement =
        getClosestTextElement(selection.anchorNode) ??
        getClosestTextElement(selection.focusNode)
      if (!startElement) return null

      const startId = startElement.getAttribute('data-text-id')
      if (!startId) return null

      const startEntry = textElementsRef.current.get(startId)
      if (!startEntry) return null

      const pageInfo = getPageElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        viewerRoot,
        pageRefs.current
      )
      if (!pageInfo) return null

      const endElement = getNearestTextElementForPoint(
        activeMouseSelectionRef.current.clientX,
        activeMouseSelectionRef.current.clientY,
        pageInfo.pageNumber,
        viewerRoot,
        textElementsRef.current
      )
      if (!endElement) return null

      const endId = endElement.getAttribute('data-text-id')
      if (!endId) return null

      const endEntry = textElementsRef.current.get(endId)
      if (!endEntry) return null

      const pageNumber = startEntry.pageNumber

      const allTextElements = Array.from(
        viewerRoot.querySelectorAll('[data-text-id]')
      )

      const startIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === startId
      )
      const endIndex = allTextElements.findIndex(
        (el) => el.getAttribute('data-text-id') === endId
      )
      if (startIndex === -1 || endIndex === -1) return null

      const minIndex = Math.min(startIndex, endIndex)
      const maxIndex = Math.max(startIndex, endIndex)
      const sortedElements = allTextElements.slice(minIndex, maxIndex + 1)

      const texts = sortedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')
        if (!id) return []
        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      if (texts.length === 0) return null

      return {
        text: texts[0],
        texts,
        selectedText: texts.map((t) => t.content ?? '').join(''),
        pageNumber,
        selection
      }
    },
    []
  )

  const getSelectionDetail = useCallback(
    (selection: Selection): ReaderTextSelectionDetail | null => {
      if (!selection || selection.isCollapsed) return null

      const viewerRoot = viewerRootRef.current
      if (!viewerRoot) return null

      const anchorInViewer = viewerRoot.contains(selection.anchorNode)
      const focusInViewer = viewerRoot.contains(selection.focusNode)
      if (!anchorInViewer || !focusInViewer) return null

      const selectedElements: HTMLElement[] = []
      textElementsRef.current.forEach((_, id) => {
        const element = viewerRoot.querySelector(`[data-text-id="${id}"]`)
        if (element && selection.containsNode(element, true)) {
          selectedElements.push(element as HTMLElement)
        }
      })

      if (selectedElements.length === 0) {
        return buildNormalizedSelection(selection, viewerRoot)
      }

      selectedElements.sort((a, b) => {
        const range = globalThis.document.createRange()
        range.setStartBefore(a)
        range.setEndBefore(b)
        const order = range.collapsed ? 1 : -1
        range.detach()
        return order
      })

      const firstElement = selectedElements[0]
      const firstTextId = firstElement.getAttribute('data-text-id')
      const firstPageNumber = Number(
        firstElement.getAttribute('data-page-number')
      )

      if (!firstTextId) return null

      const firstEntry = textElementsRef.current.get(firstTextId)

      if (!firstEntry) return null

      const texts = selectedElements.flatMap((el) => {
        const id = el.getAttribute('data-text-id')

        if (!id) {
          return []
        }

        const entry = textElementsRef.current.get(id)
        return entry ? [entry.text] : []
      })

      return {
        text: firstEntry.text,
        texts,
        selectedText: selection.toString(),
        pageNumber: firstPageNumber,
        selection
      }
    },
    [buildNormalizedSelection]
  )

  const markVisiblePage = useCallback(
    (pageNumber: number) => {
      markLoadableWithOverscan(pageNumber)
      setVisiblePages((currentPages) => {
        if (currentPages.has(pageNumber)) {
          return currentPages
        }

        const nextPages = new Set(currentPages)
        nextPages.add(pageNumber)
        return nextPages
      })
    },
    [markLoadableWithOverscan]
  )

  const emitSelectionEnd = useCallback(() => {
    if (!onTextSelectionEnd) return

    const selection = window.getSelection()
    if (!selection) return

    const detail = getSelectionDetail(selection)
    if (detail) {
      onTextSelectionEnd(detail.text, detail)
    }
  }, [onTextSelectionEnd, getSelectionDetail])

  useEffect(() => {
    if (!runtimeDocument || pageNumbers.length === 0) {
      return
    }

    markLoadableWithOverscan(pageNumbers[0])

    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageNumber = Number(
          (entry.target as HTMLElement).dataset.pageNumber
        )

        if (!Number.isFinite(pageNumber) || !entry.isIntersecting) {
          return
        }

        markVisiblePage(pageNumber)
      })
    })

    pageNumbers.forEach((pageNumber) => {
      const element = pageRefs.current.get(pageNumber)

      if (element) {
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
    }
  }, [markLoadableWithOverscan, markVisiblePage, pageNumbers, runtimeDocument])

  useEffect(() => {
    if (!runtimeDocument) {
      return
    }

    loadablePages.forEach((pageNumber) => {
      if (
        textsByPageNumber.has(pageNumber) ||
        loadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>

      try {
        pagePromise = runtimeDocument.getPageByPageNumber(pageNumber)
      } catch {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      if (!pagePromise) {
        setBaseImagesByPageNumber(
          createSetBaseImageHandler(pageNumber, undefined)
        )
        setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
        setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        return
      }

      loadingPagesRef.current.add(pageNumber)
      pagePromise
        .then((page) => {
          return Promise.all([getBaseImageFromPage(page), page.getContent()])
        })
        .then(([baseImage, content]) => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          const texts = content.filter(isIntermediateText)
          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, baseImage)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, texts))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'loaded'))
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          setBaseImagesByPageNumber(
            createSetBaseImageHandler(pageNumber, undefined)
          )
          setTextsByPageNumber(createSetTextsHandler(pageNumber, []))
          setPageStatuses(createSetPageStatusHandler(pageNumber, 'error'))
        })
        .finally(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          loadingPagesRef.current.delete(pageNumber)
        })
    })
  }, [loadablePages, runtimeDocument, textsByPageNumber])

  useEffect(() => {
    if (!ocr || !runtimeDocument) {
      return
    }

    const isOcrEnabled =
      ocr === true || (typeof ocr === 'object' && ocr.enabled !== false)

    if (!isOcrEnabled) {
      return
    }

    visiblePages.forEach((pageNumber) => {
      if (
        ocrTextsByPageNumber.has(pageNumber) ||
        ocrLoadingPagesRef.current.has(pageNumber)
      ) {
        return
      }

      const baseImageSource = baseImagesByPageNumber.get(pageNumber)

      if (!baseImageSource) {
        return
      }

      const cacheKey = getOcrCacheKey(
        runtimeDocument.id,
        pageNumber,
        baseImageSource
      )
      const cachedTexts = ocrCacheRef.current.get(cacheKey)

      if (cachedTexts) {
        setOcrTextsByPageNumber((currentTexts) => {
          const nextTexts = new Map(currentTexts)
          nextTexts.set(pageNumber, cachedTexts)
          return nextTexts
        })
        return
      }

      ocrLoadingPagesRef.current.add(pageNumber)

      const runOcr = async () => {
        try {
          const { ImageParser } = await import('@hamster-note/image-parser')
          const input = await getImageParserInput(baseImageSource)
          const ocrDocument = await ImageParser.encode(input)
          const ocrPages = await ocrDocument.pages
          const ocrPage = ocrPages[0]
          const ocrContent = ocrPage?.content ?? []
          const ocrTexts = prefixOcrTextIds(
            ocrContent.filter(isIntermediateText),
            pageNumber
          )

          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          ocrCacheRef.current.set(cacheKey, ocrTexts)
          setOcrTextsByPageNumber(createSetTextsHandler(pageNumber, ocrTexts))
        } catch (error) {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== runtimeDocument
          ) {
            return
          }

          if (onOcrError) {
            onOcrError(error, { pageNumber })
          } else if (process.env.NODE_ENV !== 'test') {
            console.warn('[Reader] OCR failed for page', pageNumber, error)
          }
        } finally {
          if (
            isMountedRef.current &&
            activeDocumentRef.current === runtimeDocument
          ) {
            ocrLoadingPagesRef.current.delete(pageNumber)
          }
        }
      }

      runOcr()
    })
  }, [
    visiblePages,
    ocr,
    runtimeDocument,
    baseImagesByPageNumber,
    onOcrError,
    ocrTextsByPageNumber
  ])

  const rootClassName = className
    ? `hamster-reader__intermediate-document-viewer ${className}`
    : 'hamster-reader__intermediate-document-viewer'

  useEffect(() => {
    if (!onTextSelectionChange) return

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection) return

      const detail = getSelectionDetail(selection)
      if (detail) {
        onTextSelectionChange(detail.text, detail)
      }
    }

    globalThis.document.addEventListener(
      'selectionchange',
      handleSelectionChange
    )
    return () => {
      globalThis.document.removeEventListener(
        'selectionchange',
        handleSelectionChange
      )
    }
  }, [onTextSelectionChange, getSelectionDetail])

  useEffect(() => {
    const root = viewerRootRef.current
    if (!root) return

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return // Only primary button
      const target = event.target as Node
      if (!root.contains(target)) return
      activeMouseSelectionRef.current = {
        active: true,
        clientX: event.clientX,
        clientY: event.clientY
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!activeMouseSelectionRef.current.active) return
      if (!(event.buttons & 1)) {
        activeMouseSelectionRef.current.active = false
        return
      }
      activeMouseSelectionRef.current.clientX = event.clientX
      activeMouseSelectionRef.current.clientY = event.clientY
    }

    root.addEventListener('mousedown', handleMouseDown)
    root.addEventListener('mousemove', handleMouseMove)

    return () => {
      root.removeEventListener('mousedown', handleMouseDown)
      root.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  useEffect(() => {
    if (!onTextSelectionEnd) return

    const root = viewerRootRef.current
    if (!root) return

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) {
        emitSelectionEnd()
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (activeMouseSelectionRef.current.active) {
        activeMouseSelectionRef.current.clientX = event.clientX
        activeMouseSelectionRef.current.clientY = event.clientY
      }
      emitSelectionEnd()
      activeMouseSelectionRef.current.active = false
    }

    root.addEventListener('mouseup', handleMouseUp)
    root.addEventListener('touchend', emitSelectionEnd)
    root.addEventListener('keyup', handleKeyUp)

    return () => {
      root.removeEventListener('mouseup', handleMouseUp)
      root.removeEventListener('touchend', emitSelectionEnd)
      root.removeEventListener('keyup', handleKeyUp)
    }
  }, [onTextSelectionEnd, emitSelectionEnd])

  if (!runtimeDocument) {
    return (
      <div
        className={rootClassName}
        data-testid='intermediate-document-viewer'
      />
    )
  }

  return (
    <div
      ref={viewerRootRef}
      role='document'
      className={rootClassName}
      data-testid='intermediate-document-viewer'
    >
      {htmlContent && !htmlParserError ? (
        <div
          className='hamster-reader__html-parser-output'
          data-testid='html-parser-output'
          // The HTML comes from the trusted @hamster-note/html-parser package,
          // which converts IntermediateDocument data into HTML fragments.
          // Text selection hooks do not rely on this path because it may lack data-text-id attributes.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted html-parser output
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      ) : (
        pageNumbers.map((pageNumber) => {
          const pageSize = normalizePageSize(
            runtimeDocument.getPageSizeByPageNumber(pageNumber)
          )
          const texts = textsByPageNumber.get(pageNumber) ?? []
          const ocrTexts = ocrTextsByPageNumber.get(pageNumber) ?? []
          const allTexts = [...texts, ...ocrTexts]
          const pageStatus = pageStatuses.get(pageNumber)
          const isPageLoading =
            loadablePages.has(pageNumber) &&
            pageStatus !== 'loaded' &&
            pageStatus !== 'error'
          const pageClassName = isPageLoading
            ? 'hamster-reader__intermediate-page hamster-reader__intermediate-page--loading'
            : 'hamster-reader__intermediate-page'

          const baseImageSource = baseImagesByPageNumber.get(pageNumber)

          return (
            <div
              key={pageNumber}
              ref={setPageRef(pageNumber)}
              className={pageClassName}
              data-testid={`intermediate-page-${pageNumber}`}
              data-page-number={pageNumber}
              data-page-size-unavailable={
                pageSize.pageSizeUnavailable ? 'true' : undefined
              }
              style={{
                position: 'relative',
                width: `${pageSize.width}px`,
                height: `${pageSize.height}px`,
                overflow: 'hidden'
              }}
            >
              {baseImageSource && (
                <img
                  className='hamster-reader__intermediate-page-base-image'
                  src={baseImageSource}
                  alt=''
                  aria-hidden='true'
                />
              )}
              {isPageLoading && (
                <div className='hamster-reader__intermediate-page-status'>
                  Loading page {pageNumber}…
                </div>
              )}
              {pageStatus === 'error' && (
                <div className='hamster-reader__intermediate-page-status hamster-reader__intermediate-page-status--error'>
                  Failed to load page {pageNumber}
                </div>
              )}
              {allTexts.map((textData) => {
                const text = textData as RenderableIntermediateText
                const bbox = getTextBbox(text)
                const style = buildTextSpanStyle(text, bbox)

                return (
                  <span
                    key={text.id}
                    ref={setTextRef(text, pageNumber)}
                    className='hamster-reader__intermediate-text'
                    data-text-id={text.id}
                    data-page-number={pageNumber}
                    style={style}
                  >
                    {text.content}
                  </span>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
