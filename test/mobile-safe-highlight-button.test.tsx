import type { ReaderSelectionRef } from '@hamster-note/reader'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileSafeHighlightButton } from '../demo/MobileSafeHighlightButton'

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
      scrollToPosition: vi.fn()
    }
  }
}

describe('MobileSafeHighlightButton', () => {
  it('calls confirm from the click path used by desktop and keyboard activation', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)

    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)

    fireEvent.click(screen.getByRole('button', { name: '高亮' }))

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('does not call confirm during mouse pointerdown before the click event', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)
    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'mouse' })
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('confirms on touch pointerdown and ignores the following synthetic click', () => {
    const confirm = vi.fn()
    const selectionRef = makeSelectionRef(confirm)
    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'touch' })
    expect(confirm).toHaveBeenCalledTimes(1)

    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
