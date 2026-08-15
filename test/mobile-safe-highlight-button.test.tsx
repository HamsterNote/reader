import type {
  ReaderSelectionRange,
  ReaderSelectionRef
} from '@hamster-note/reader'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DefaultSelectionPopover } from '../src/components/DefaultPopover'

function makeSelectionRef(confirm: () => void): {
  current: ReaderSelectionRef
} {
  return {
    current: {
      highlight: vi.fn(),
      confirm,
      confirmRect: vi.fn(),
      clear: vi.fn(),
      scrollToRange: vi.fn(),
      scrollToRect: vi.fn(),
      scrollToPosition: vi.fn(),
      undo: () => false,
      redo: () => false,
      canUndo: () => false,
      canRedo: () => false,
      getAnnotationHistoryState: () => ({
        enabled: false,
        canUndo: false,
        canRedo: false,
        pastCount: 0,
        futureCount: 0
      })
    }
  }
}

const noopContext = {
  highlightColor: '#ffc107',
  onHighlightColorChange: vi.fn(),
  selectedRangeId: null,
  ranges: [] as ReaderSelectionRange[],
  onUpdateRange: vi.fn(),
  onRemoveRange: vi.fn()
}

describe('DefaultSelectionPopover (contains MobileSafeHighlightButton)', () => {
  it('hides dictionary action when the selected word has no query result', () => {
    // Given: 宿主对当前选词返回空结果。
    const queryWord = vi.fn(() => '')

    // When: 渲染默认选区操作栏。
    render(
      <DefaultSelectionPopover
        selectionRef={makeSelectionRef(vi.fn())}
        selectedWord='missing'
        queryWord={queryWord}
        onOpenDictionary={vi.fn()}
        {...noopContext}
      />
    )

    // Then: 查询发生，但不展示词典入口。
    expect(queryWord).toHaveBeenCalledWith('missing')
    expect(
      screen.queryByRole('button', { name: '翻译' })
    ).not.toBeInTheDocument()
  })

  it('opens dictionary with the selected word when a multiline result exists', () => {
    // Given: 宿主返回非空的多行词典结果。
    const onOpenDictionary = vi.fn()

    render(
      <DefaultSelectionPopover
        selectionRef={makeSelectionRef(vi.fn())}
        selectedWord='reader'
        queryWord={() => 'reader\n读者\n阅读器'}
        onOpenDictionary={onOpenDictionary}
        {...noopContext}
      />
    )

    // When: 用户点击翻译。
    fireEvent.click(screen.getByRole('button', { name: '翻译' }))

    // Then: 词典以当前选词初始化。
    expect(onOpenDictionary).toHaveBeenCalledWith('reader')
  })

  it('opens dictionary on pointerdown before the active selection popover unmounts', () => {
    // Given: 翻译按钮位于会随选区清除而卸载的 Popover 中。
    const onOpenDictionary = vi.fn()
    render(
      <DefaultSelectionPopover
        selectionRef={makeSelectionRef(vi.fn())}
        selectedWord='reader'
        queryWord={() => 'reader\n阅读器'}
        onOpenDictionary={onOpenDictionary}
        {...noopContext}
      />
    )
    const button = screen.getByRole('button', { name: '翻译' })

    // When: 鼠标按下，Popover 可能在 click 前卸载。
    fireEvent.pointerDown(button, { pointerType: 'mouse' })

    // Then: 在 Popover 可能卸载前调起词典。
    expect(onOpenDictionary).toHaveBeenCalledTimes(1)
    expect(onOpenDictionary).toHaveBeenCalledWith('reader')
  })

  it('calls confirm from the click path used by desktop and keyboard activation', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)

    render(
      <DefaultSelectionPopover selectionRef={selectionRef} {...noopContext} />
    )

    fireEvent.click(screen.getByRole('button', { name: '高亮' }))

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('does not call confirm during mouse pointerdown before the click event', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)
    render(
      <DefaultSelectionPopover selectionRef={selectionRef} {...noopContext} />
    )
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'mouse' })
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('confirms on touch pointerdown and ignores the following synthetic click', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)
    render(
      <DefaultSelectionPopover selectionRef={selectionRef} {...noopContext} />
    )
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'touch' })
    fireEvent.touchStart(button)
    expect(confirm).toHaveBeenCalledTimes(1)

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('confirms on touchstart when the browser does not dispatch pointer events', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)
    render(
      <DefaultSelectionPopover selectionRef={selectionRef} {...noopContext} />
    )
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.touchStart(button)
    fireEvent.click(button)

    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
