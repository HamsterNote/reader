import type { PaginationDiagnostics } from '../types/paginationDiagnostics'

export function PdfTextReadingControls({
  enabled,
  page,
  total,
  ready,
  navigation,
  empty,
  failed,
  unlocatable,
  diagnostics,
  onRetry
}: {
  enabled: boolean
  page: number
  total: number
  ready: boolean
  navigation: { canPrevious: boolean; canNext: boolean; busy: boolean }
  empty: boolean
  failed: boolean
  unlocatable: boolean
  diagnostics?: PaginationDiagnostics
  onRetry: () => void
}) {
  if (!enabled) return null
  return (
    <>
      <div
        className='hamster-reader__page-indicator'
        data-testid='reading-page-indicator'
        data-pdf-text-ready={diagnostics?.ready}
        data-can-next={
          ready && !navigation.busy && !diagnostics?.gate && navigation.canNext
        }
        data-can-previous={
          ready &&
          !navigation.busy &&
          !diagnostics?.gate &&
          navigation.canPrevious
        }
        data-pdf-text-busy={diagnostics?.busy}
        data-pdf-text-gate={diagnostics?.gate}
        data-pdf-text-target-page={diagnostics?.targetPageNumber}
        data-pdf-text-generation={diagnostics?.generation}
        data-pdf-text-revision={diagnostics?.revision}
        data-pdf-text-turn-sequence={diagnostics?.turnSequence}
        data-pdf-text-last-turn-page={diagnostics?.lastTurnPageNumber}
        data-pdf-text-error={diagnostics?.error}
        hidden={!ready || empty || !total}
      >
        {page}/{total}
      </div>
      {empty && <div role='status'>没有可阅读的页面</div>}
      {unlocatable && (
        <div role='status' className='hamster-reader__engine-notice'>
          文字位置无法定位，原进度已保留
        </div>
      )}
      {failed && (
        <div role='alert' className='hamster-reader__engine-error'>
          无法加载文字
          <button type='button' onClick={onRetry}>
            重试
          </button>
        </div>
      )}
    </>
  )
}
