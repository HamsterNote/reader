import { useLayoutEffect, useRef } from 'react'
import { readingBounds, trackReadingPress } from './tapZones'

export function ReadingMask({ dismiss }: { dismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(dismiss)
  latest.current = dismiss
  useLayoutEffect(() => {
    const mask = ref.current!
    const press = trackReadingPress(mask, {
      bounds: () => readingBounds(mask),
      mask: true,
      swipe: () => latest.current()
    })
    const click = (event: MouseEvent) => {
      event.stopPropagation()
      if (press.consume(event)) latest.current()
    }
    mask.addEventListener('click', click)
    return () => {
      press.dispose()
      mask.removeEventListener('click', click)
    }
  }, [])
  return <div ref={ref} className="hamster-reader__reading-mask" data-testid="reading-mask" />
}
