import type { Ref } from 'react'
import { ViewportPaginationControls } from '../components/reading/ViewportPaginationControls'
import type { ViewportNavigationState } from '../components/reading/navigation'

export function PdfTextReadingControls({
  enabled,
  controlsRef,
  navigation,
  ready,
  theme,
  empty,
  failed,
  unlocatable,
  onRetry,
  onPrevious,
  onNext
}: {
  enabled: boolean
  controlsRef: Ref<HTMLDivElement>
  navigation: ViewportNavigationState
  ready: boolean
  theme: 'light' | 'dark'
  empty: boolean
  failed: boolean
  unlocatable: boolean
  onRetry: () => void
  onPrevious: () => void
  onNext: () => void
}) {
  if (!enabled) return null
  return (
    <>
      <ViewportPaginationControls
        controlsRef={controlsRef}
        navigation={navigation}
        ready={ready}
        theme={theme}
        onPrevious={onPrevious}
        onNext={onNext}
      />
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
