import { useCallback, useEffect, useMemo, useRef } from 'react'

type Session = { generation: number; touched: boolean }
type Token = { session: Session; generation: number }

/** Every position writer invalidates work captured before it, even before
 * controlled progress props echo the new position back to the reader. */
export function usePositionTransaction(owner: unknown) {
  const session = useMemo(() => ({ generation: 0, touched: false }), [owner])
  const active = useRef(session)
  active.current = session
  const capture = useCallback(
    (): Token => ({
      session: active.current,
      generation: active.current.generation
    }),
    []
  )
  const begin = useCallback(() => {
    active.current.touched = true
    ++active.current.generation
    return capture()
  }, [capture])
  const isCurrent = useCallback(
    (token: Token) =>
      token.session === active.current &&
      token.generation === active.current.generation,
    []
  )
  const isPristine = useCallback(() => !active.current.touched, [])
  useEffect(
    () => () => {
      ++session.generation
    },
    [session]
  )
  return { begin, capture, isCurrent, isPristine }
}
