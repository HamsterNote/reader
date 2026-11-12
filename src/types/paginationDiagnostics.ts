/** Read-only pagination snapshot for host failure capture; never drives behavior. */
export type PaginationDiagnostics = Readonly<{
  generation: number
  revision: number
  ready: boolean
  busy: boolean
  gate: boolean
  targetPageNumber: number
  /** Accepted page-turn intents; unchanged when a turn is ignored (not ready/busy/gate). */
  turnSequence: number
  /** Target page captured when the latest turn was accepted, null before the first. */
  lastTurnPageNumber: number | null
  error?: string
}>
