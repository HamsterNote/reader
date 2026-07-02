import type { ReaderSelectionRef } from '@hamster-note/reader'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileSafeHighlightButton } from '../demo/MobileSafeHighlightButton'

function makeSelectionRef(highlight: () => void): {
  current: ReaderSelectionRef
} {
  return {
    current: {
      highlight,
      clear: vi.fn(),
      scrollToRange: vi.fn()
    }
  }
}

describe('MobileSafeHighlightButton', () => {
  it('calls highlight from the click path used by desktop and keyboard activation', () => {
    const highlight = vi.fn()
    const selectionRef = makeSelectionRef(highlight)

    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)

    fireEvent.click(screen.getByRole('button', { name: '高亮' }))

    expect(highlight).toHaveBeenCalledTimes(1)
  })

  it('does not call highlight during mouse pointerdown before the click event', () => {
    const highlight = vi.fn()
    const selectionRef = makeSelectionRef(highlight)
    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'mouse' })
    expect(highlight).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(highlight).toHaveBeenCalledTimes(1)
  })

  it('highlights on touch pointerdown and ignores the following synthetic click', () => {
    const highlight = vi.fn()
    const selectionRef = makeSelectionRef(highlight)
    render(<MobileSafeHighlightButton selectionRef={selectionRef} />)
    const button = screen.getByRole('button', { name: '高亮' })

    fireEvent.pointerDown(button, { pointerType: 'touch' })
    expect(highlight).toHaveBeenCalledTimes(1)

    fireEvent.click(button)
    expect(highlight).toHaveBeenCalledTimes(1)
  })
})
