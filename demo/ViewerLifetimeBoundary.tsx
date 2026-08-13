import type { ReactNode } from 'react'
import { useEffect } from 'react'

export type ViewerLifetimeToken = {
  readonly ack: Promise<void>
  active: boolean
  generation: number
  mounted: boolean
  resolveAck: () => void
}

export function createViewerLifetimeToken(): ViewerLifetimeToken {
  let resolveAck = () => {}
  const ack = new Promise<void>((resolve) => {
    resolveAck = resolve
  })

  return {
    ack,
    active: false,
    generation: 0,
    mounted: false,
    resolveAck
  }
}

function ViewerDocumentLifetime({
  children,
  token
}: {
  readonly children: ReactNode
  readonly token: ViewerLifetimeToken | null
}) {
  useEffect(() => {
    if (token === null) return

    token.active = true
    token.mounted = true
    token.generation += 1

    return () => {
      token.active = false
      const cleanupGeneration = token.generation

      // 终态确认延后一轮微任务，让同一次 React commit 内的 viewer cleanup
      // 无论采用哪种父子顺序，都先完整执行；StrictMode reconnect 会递增 generation。
      queueMicrotask(() => {
        if (token.active || token.generation !== cleanupGeneration) return
        token.resolveAck()
      })
    }
  }, [token])

  return children
}

export function ViewerLifetimeBoundary({
  children,
  onCleanup,
  onSetup,
  token
}: {
  readonly children: ReactNode
  readonly onCleanup: () => void
  readonly onSetup: () => void
  readonly token: ViewerLifetimeToken | null
}) {
  useEffect(() => {
    onSetup()
    return onCleanup
  }, [onCleanup, onSetup])

  return (
    <ViewerDocumentLifetime token={token}>{children}</ViewerDocumentLifetime>
  )
}
