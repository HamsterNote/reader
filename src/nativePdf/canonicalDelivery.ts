import type { PdfCanonicalPage, PdfIdentity } from './contracts'
import { NativePdfSession } from './session'

/** Canonical state belongs to one file session, not to a WebView ref's lifetime. */
export class NativeCanonicalDelivery {
  private readonly session: NativePdfSession
  private readonly pages = new Map<number, PdfCanonicalPage>()
  private readonly sent = new Map<number, string>()
  private ready = false
  private closed = false

  constructor(
    identity: PdfIdentity,
    private readonly send: (page: PdfCanonicalPage) => boolean
  ) {
    this.session = new NativePdfSession(identity)
  }

  publish(page: PdfCanonicalPage): void {
    if (this.closed || !page.text.length) return
    this.pages.set(page.pageNumber, page)
    if (this.ready) this.deliver(page)
  }

  webReady(identity: PdfIdentity): void {
    if (!this.session.accepts(identity)) return
    this.ready = true
    for (const page of this.pages.values()) this.deliver(page)
  }

  /** One explicit repair request can resend even a previously delivered page. */
  refill(identity: PdfIdentity, numbers: readonly number[]): void {
    if (!this.ready || !this.session.accepts(identity)) return
    for (const number of new Set(numbers)) {
      const page = this.pages.get(number)
      if (page) this.deliver(page, true)
    }
  }

  webLoading(): void {
    this.ready = false
    this.sent.clear()
  }

  clear(): void {
    this.pages.clear()
    this.sent.clear()
  }

  close(): void {
    this.closed = true
    this.ready = false
    this.session.close()
    this.clear()
  }

  private deliver(page: PdfCanonicalPage, force = false): void {
    // Text equality alone is insufficient: a mapping can have new boundaries.
    const encoded = JSON.stringify(page)
    if (!force && this.sent.get(page.pageNumber) === encoded) return
    if (this.send(page)) this.sent.set(page.pageNumber, encoded)
  }
}
