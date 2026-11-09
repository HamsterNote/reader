import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfHiddenPageRestoreModal } from '../../src/pdf/PdfHiddenPageRestoreModal'

const hoisted = vi.hoisted(() => ({
  onVisibility: vi.fn(),
  retryPreview: vi.fn(),
  retryPage: vi.fn()
}))

vi.mock('../../src/pdf/usePdfPreviews', () => ({
  usePdfPreviews: () => ({
    sizes: new Map([[2, { width: 400, height: 300 }]]),
    images: new Map([[2, 'data:image/png;base64,cg==']]),
    errors: new Set([4]),
    onVisibility: hoisted.onVisibility,
    retryPreview: hoisted.retryPreview,
    retryPage: hoisted.retryPage
  })
}))

const groups = [
  { start: 2, end: 2, pages: [2] },
  { start: 4, end: 5, pages: [4, 5] }
]

function renderModal(onConfirm = vi.fn(), onClose = vi.fn()) {
  return {
    onConfirm,
    onClose,
    ...render(
      <PdfHiddenPageRestoreModal
        groups={groups}
        initialGroupStart={2}
        document={null}
        bodyBusy={() => false}
        releasePage={vi.fn()}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PDF hidden page restoration modal', () => {
  it('selects across groups, supports select all, and confirms once', () => {
    const { onConfirm } = renderModal()
    const second = screen.getByRole('checkbox', { name: '选择第 2 页' })
    const fourth = screen.getByRole('checkbox', { name: '选择第 4 页' })
    fireEvent.click(second)
    fireEvent.click(fourth)
    expect(
      screen.getByRole('checkbox', { name: '取消选择第 2 页' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText('✓')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByRole('button', { name: '恢复 3 页' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    expect(screen.getByRole('button', { name: '恢复 0 页' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择第 2 页' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择第 4 页' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复 2 页' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith([2, 4])
  })

  it('cancels without confirming and closes with Escape', () => {
    const { onConfirm, onClose } = renderModal()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择第 2 页' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows real preview geometry and retries only the failed page', () => {
    renderModal()
    const image = screen.getByRole('presentation')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,cg==')
    expect(image.parentElement).toHaveStyle({ aspectRatio: '400 / 300' })
    fireEvent.click(
      screen.getByRole('button', { name: '第 4 页预览失败，重试' })
    )
    expect(hoisted.retryPage).toHaveBeenCalledWith(4)
    expect(hoisted.retryPage).toHaveBeenCalledTimes(1)
    expect(hoisted.retryPreview).not.toHaveBeenCalled()
  })
})
