import type { BridgeHostSnapshot } from '../bridge/hostSession'

type Listener = (snapshot: BridgeHostSnapshot) => void

const scopes = new WeakMap<object, Map<string, Map<string, Set<Listener>>>>()

export function subscribeNativeAnnotationSync(
  scope: object,
  fileId: string,
  paneId: string,
  listener: Listener
): () => void {
  let files = scopes.get(scope)
  if (!files) {
    files = new Map()
    scopes.set(scope, files)
  }
  let panes = files.get(fileId)
  if (!panes) {
    panes = new Map()
    files.set(fileId, panes)
  }
  let listeners = panes.get(paneId)
  if (!listeners) {
    listeners = new Set()
    panes.set(paneId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) panes.delete(paneId)
    if (panes.size === 0) files.delete(fileId)
  }
}

export function publishNativeAnnotationSync(
  scope: object,
  fileId: string,
  sourcePaneId: string,
  snapshot: BridgeHostSnapshot
): void {
  const panes = scopes.get(scope)?.get(fileId)
  if (!panes) return
  for (const [paneId, listeners] of panes) {
    if (paneId === sourcePaneId) continue
    for (const listener of [...listeners]) listener(snapshot)
  }
}
