/** Read-only pagination snapshot for host failure capture; never drives behavior. */
export type PaginationDiagnostics = Readonly<{
  generation: number
  revision: number
  ready: boolean
  busy: boolean
  gate: boolean
  targetPageNumber: number
  error?: string
}>
