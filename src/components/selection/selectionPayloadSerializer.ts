import type { IntermediateText } from '@hamster-note/types'

import { isSelectionBackgroundTarget } from './caretResolver'

export type ReaderSelectedTextSegment = IntermediateText & {
  selectedText: string
  startCharIndex: number
  endCharIndex: number
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
  texts: IntermediateText[]
): ReaderSelectionPayload | null => {
  const segments = texts.flatMap((text) => {
    const selectedText = text.content ?? ''
    if (selectedText.length === 0) return []

    return [
      {
        ...text,
        selectedText,
        startCharIndex: 0,
        endCharIndex: selectedText.length
      }
    ]
  })

  const extractedText = segments.map((segment) => segment.selectedText).join('')
  if (segments.length === 0 || extractedText.trim().length === 0) return null

  return { selection, segments, extractedText }
}
