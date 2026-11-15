import type { PdfEvent, PdfIdentity } from './contracts'

/** Whitelist diagnostics; never spread an event/source/text into logs. */
export class NativePdfSession {
  private displayed = false
  private restored = false
  private closed = false
  private revision = -1
  private stale = 0
  private commits = new Set<string>()
  constructor(readonly identity: PdfIdentity) {}
  accepts(event: PdfIdentity): boolean {
    const valid =
      !this.closed &&
      (['fileId', 'paneId', 'sessionId', 'generation'] as const).every(
        (key) => event[key] === this.identity[key]
      )
    if (!valid) this.stale++
    return valid
  }
  receive(event: PdfEvent): boolean {
    if (!this.accepts(event)) return false
    if ('geometryRevision' in event) {
      if (event.geometryRevision < this.revision) {
        this.stale++
        return false
      }
      this.revision = event.geometryRevision
    }
    if (event.type === 'displayed') this.displayed = true
    if (event.type === 'restored') this.restored = true
    return true
  }
  commit(id: string): boolean {
    if (this.closed || this.commits.has(id)) return false
    this.commits.add(id)
    return true
  }
  close(): void {
    this.closed = true
    this.commits.clear()
  }
  get ready(): boolean {
    return !this.closed && this.displayed && this.restored
  }
  diagnostic(commitId?: string) {
    return {
      renderer: 'native-pdf',
      sessionId: this.identity.sessionId,
      generation: this.identity.generation,
      geometryRevision: this.revision,
      displayed: this.displayed,
      restored: this.restored,
      ready: this.ready,
      staleEvents: this.stale,
      ...(commitId ? { commitId } : {})
    }
  }
}
