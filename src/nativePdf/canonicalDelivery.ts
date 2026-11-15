import type { PdfCanonicalPage, PdfIdentity } from './contracts'
import { NativePdfSession } from './session'

/** 一次投递的来源：握手前的缓存重放，还是 webReady 之后的实时投递。 */
export type CanonicalDeliveryMeta = {
  readonly replay: boolean
}

/** Canonical state belongs to one file session, not to a WebView ref's lifetime. */
export class NativeCanonicalDelivery {
  private readonly session: NativePdfSession
  private readonly pages = new Map<number, PdfCanonicalPage>()
  private readonly sent = new Map<number, string>()
  private ready = false
  private closed = false

  constructor(
    identity: PdfIdentity,
    private readonly send: (
      page: PdfCanonicalPage,
      meta: CanonicalDeliveryMeta
    ) => boolean
  ) {
    this.session = new NativePdfSession(identity)
  }

  publish(page: PdfCanonicalPage): void {
    if (this.closed || !page.text.length) return
    this.pages.set(page.pageNumber, page)
    if (this.ready) this.deliver(page)
  }

  /** web-ready 之前 publish 的页面先缓存，握手后统一重放。 */
  get isReady(): boolean {
    return this.ready
  }

  /** 当前缓存的页面号（升序），用于握手日志证明重放内容。 */
  get bufferedPages(): number[] {
    return [...this.pages.keys()].sort((left, right) => left - right)
  }

  webReady(identity: PdfIdentity): void {
    if (!this.session.accepts(identity)) return
    this.ready = true
    // 这批页面是在握手前缓存的，标记 replay，供设备侧区分「重放」与「实时」。
    for (const page of this.pages.values()) this.deliver(page, false, true)
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

  private deliver(page: PdfCanonicalPage, force = false, replay = false): void {
    // Text equality alone is insufficient: a mapping can have new boundaries.
    const encoded = JSON.stringify(page)
    if (!force && this.sent.get(page.pageNumber) === encoded) return
    if (this.send(page, { replay })) this.sent.set(page.pageNumber, encoded)
  }
}
