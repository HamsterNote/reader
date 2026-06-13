import type { IntermediateText } from '@hamster-note/types'

import { isSelectionBackgroundTarget } from './caretResolver'

export type ReaderSelectedTextSegment = IntermediateText & {
  selectedText: string
  startCharIndex: number
  endCharIndex: number
  pageNumber?: number
}

export type ReaderSelectionPayload = {
  selection: Selection
  segments: ReaderSelectedTextSegment[]
  extractedText: string
}

export type TextElementRecord = {
  text: IntermediateText
  pageNumber: number
}

export const textElementRecords = new WeakMap<HTMLElement, TextElementRecord>()

export const getClosestTextElement = (
  node: Node | null
): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement
  const textElement = element?.closest('[data-text-id]')
  if (!(textElement instanceof HTMLElement)) return null
  if (isSelectionBackgroundTarget(textElement)) return null
  return textElement
}

const getSelectionViewerRoot = (selection: Selection): HTMLElement | null => {
  const anchorElement = getClosestTextElement(selection.anchorNode)
  const focusElement = getClosestTextElement(selection.focusNode)
  if (!anchorElement || !focusElement) return null

  const anchorRoot = anchorElement.closest(
    '.hamster-reader__intermediate-document-viewer'
  )
  const focusRoot = focusElement.closest(
    '.hamster-reader__intermediate-document-viewer'
  )

  return anchorRoot instanceof HTMLElement && anchorRoot === focusRoot
    ? anchorRoot
    : null
}

const getTextLength = (node: Node): number => node.textContent?.length ?? 0

const getElementTextOffset = (
  element: HTMLElement,
  container: Node,
  offset: number
): number => {
  if (container === element) {
    return Array.from(element.childNodes)
      .slice(0, offset)
      .reduce((total, node) => total + getTextLength(node), 0)
  }

  let textOffset = 0
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let currentNode = walker.nextNode()

  while (currentNode) {
    if (currentNode === container) {
      return textOffset + offset
    }
    textOffset += getTextLength(currentNode)
    currentNode = walker.nextNode()
  }

  return textOffset
}

const intersectsRange = (range: Range, element: HTMLElement): boolean => {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

const buildSegmentRange = (
  selectionRange: Range,
  element: HTMLElement
): Range => {
  const segmentRange = document.createRange()
  segmentRange.selectNodeContents(element)

  if (element.contains(selectionRange.startContainer)) {
    segmentRange.setStart(
      selectionRange.startContainer,
      selectionRange.startOffset
    )
  }

  if (element.contains(selectionRange.endContainer)) {
    segmentRange.setEnd(selectionRange.endContainer, selectionRange.endOffset)
  }

  return segmentRange
}

const textMatchesRecord = (
  text: IntermediateText,
  record: TextElementRecord
): boolean =>
  record.text === text ||
  (typeof text.id === 'string' &&
    text.id.length > 0 &&
    record.text.id === text.id &&
    record.text.content === text.content)

const findTextElementsForTexts = (
  selection: Selection,
  texts: IntermediateText[],
  records: WeakMap<HTMLElement, TextElementRecord>
): Array<{
  element: HTMLElement
  record: TextElementRecord
  text: IntermediateText
}> => {
  const viewerRoot = getSelectionViewerRoot(selection)
  if (!viewerRoot) return []

  const usedElements = new Set<HTMLElement>()
  const candidates = Array.from(
    viewerRoot.querySelectorAll<HTMLElement>('[data-text-id]')
  ).filter((element) => !isSelectionBackgroundTarget(element))

  return texts.flatMap((text) => {
    const element = candidates.find((candidate) => {
      if (usedElements.has(candidate)) return false
      const record = records.get(candidate)
      return record ? textMatchesRecord(text, record) : false
    })
    if (!element) return []

    const record = records.get(element)
    if (!record) return []
    usedElements.add(element)
    return [{ element, record, text }]
  })
}

export const buildSelectionPayload = (
  selection: Selection,
  records: WeakMap<HTMLElement, TextElementRecord> = textElementRecords
): ReaderSelectionPayload | null => {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }

  const viewerRoot = getSelectionViewerRoot(selection)
  if (!viewerRoot) return null

  const selectionRange = selection.getRangeAt(0)
  const segments = Array.from(
    viewerRoot.querySelectorAll<HTMLElement>('[data-text-id]')
  ).flatMap((element) => {
    if (isSelectionBackgroundTarget(element)) return []
    if (!intersectsRange(selectionRange, element)) return []

    const record = records.get(element)
    if (!record) return []

    const content = record.text.content ?? ''
    const segmentRange = buildSegmentRange(selectionRange, element)
    const rawStartCharIndex = getElementTextOffset(
      element,
      segmentRange.startContainer,
      segmentRange.startOffset
    )
    const rawEndCharIndex = getElementTextOffset(
      element,
      segmentRange.endContainer,
      segmentRange.endOffset
    )
    const startCharIndex = Math.max(
      0,
      Math.min(rawStartCharIndex, content.length)
    )
    const endCharIndex = Math.max(
      startCharIndex,
      Math.min(rawEndCharIndex, content.length)
    )

    if (endCharIndex <= startCharIndex) return []

    return [
      {
        ...record.text,
        pageNumber: record.pageNumber,
        selectedText: content.slice(startCharIndex, endCharIndex),
        startCharIndex,
        endCharIndex
      }
    ]
  })

  const extractedText = segments.map((segment) => segment.selectedText).join('')
  if (segments.length === 0 || extractedText.trim().length === 0) return null

  return { selection, segments, extractedText }
}

export const buildSelectionPayloadFromTexts = (
  selection: Selection,
  texts: IntermediateText[],
  records: WeakMap<HTMLElement, TextElementRecord> = textElementRecords
): ReaderSelectionPayload | null => {
  // 双模式：有 live range 时首末文本元素用真实 char offset（修复 bug #3）；
  // 没 live range（跨页 mock / 外部 selection）时回退到整段 [0, content.length]，与 HEAD baseline 契约一致。
  const hasLiveRange =
    !!selection && !selection.isCollapsed && selection.rangeCount > 0
  const selectionRange = hasLiveRange ? selection.getRangeAt(0) : null

  const textElements = hasLiveRange
    ? findTextElementsForTexts(selection, texts, records)
    : []

  // textElements 长度对不齐 texts 时（viewerRoot/DOM 不一致）也走 fallback 而非裁剪。
  const useRangeOffsets = hasLiveRange && textElements.length === texts.length

  const segments = texts.flatMap((text, index) => {
    const content = text.content ?? ''
    if (content.length === 0) return []

    let pageNumber: number | undefined = (
      text as IntermediateText & { pageNumber?: number }
    ).pageNumber
    let startCharIndex = 0
    let endCharIndex = content.length

    if (useRangeOffsets && selectionRange) {
      const entry = textElements[index]
      const { element, record } = entry
      pageNumber = record.pageNumber
      const segmentRange = buildSegmentRange(selectionRange, element)
      const isFirstElement = index === 0
      const isLastElement = index === textElements.length - 1
      const rawStart = isFirstElement
        ? getElementTextOffset(
            element,
            segmentRange.startContainer,
            segmentRange.startOffset
          )
        : 0
      const rawEnd = isLastElement
        ? getElementTextOffset(
            element,
            segmentRange.endContainer,
            segmentRange.endOffset
          )
        : content.length
      startCharIndex = Math.max(0, Math.min(rawStart, content.length))
      endCharIndex = Math.max(startCharIndex, Math.min(rawEnd, content.length))
    }

    const selectedText = content.slice(startCharIndex, endCharIndex)
    if (selectedText.length === 0) return []

    const segment: ReaderSelectedTextSegment = {
      ...text,
      selectedText,
      startCharIndex,
      endCharIndex
    }
    if (typeof pageNumber === 'number') {
      ;(
        segment as ReaderSelectedTextSegment & { pageNumber?: number }
      ).pageNumber = pageNumber
    }
    return [segment]
  })

  const extractedText = segments.map((segment) => segment.selectedText).join('')
  if (segments.length === 0 || extractedText.trim().length === 0) return null

  return { selection, segments, extractedText }
}
