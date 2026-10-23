// 最小类型声明：只覆盖 reader 用到的 foliate-js view.js 表面
// （vendored，见 MANIFEST.md）。上游无类型发布。

export interface FoliateTocItem {
  readonly label?: string
  readonly href?: string
  readonly subitems?: readonly FoliateTocItem[]
}

export interface FoliateSection {
  readonly id: string
  readonly linear?: string
  readonly load: () => Promise<unknown>
  readonly unload: () => void
  readonly createDocument: () => Promise<Document>
  readonly size: number
  readonly cfi?: string
  readonly resolveHref: (href: string) => string
}

export interface FoliateBook {
  readonly transformTarget?: EventTarget
  readonly metadata?: { readonly title?: string; readonly language?: string }
  readonly sections: readonly FoliateSection[]
  readonly toc?: readonly FoliateTocItem[]
  readonly rendition?: { readonly layout?: string }
  readonly resolveHref: (
    href: string
  ) => { index: number; anchor: (doc: Document) => Element | number } | null
  readonly splitTOCHref?: (href: string) => readonly string[]
  readonly getTOCFragment?: (doc: Document, id: string) => Element | null
  readonly getCover: () => Promise<Blob | null>
  readonly isExternal: (uri: string) => boolean
  readonly destroy: () => void
}

export interface FoliateOverlayerRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface FoliateOverlayer {
  readonly element: SVGSVGElement
  add(
    key: string,
    range: Range | (() => Range),
    draw: (rects: FoliateOverlayerRect[], options?: unknown) => SVGElement,
    options?: unknown
  ): void
  remove(key: string): void
  redraw(): void
  hitTest(point: { x: number; y: number }): [] | [string, Range]
}

export interface FoliateRendererContents {
  readonly index: number
  readonly overlayer: FoliateOverlayer
  readonly doc: Document
}

/** paginator 支持的定位锚点：进度分数、Range、元素或解析函数。 */
export type FoliateAnchor =
  | number
  | Range
  | Element
  | ((doc: Document) => number | Range | Element)

export interface FoliateRelocateDetail {
  readonly reason?: string
  readonly range?: Range
  readonly index: number
  readonly fraction: number
  readonly size?: number
  readonly [key: string]: unknown
}

export interface FoliateRenderer {
  setAttribute(name: string, value: string): void
  open(book: FoliateBook): void
  destroy(): void
  goTo(target: {
    index: number
    anchor?: FoliateAnchor
    select?: boolean
  }): Promise<void>
  scrollToAnchor(
    anchor: number | Range | Element,
    select?: boolean
  ): Promise<void>
  setStyles(styles: string | readonly [string, string]): void
  getContents(): readonly FoliateRendererContents[]
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  addEventListener(
    type: 'load',
    listener: (event: CustomEvent<{ doc: Document; index: number }>) => void
  ): void
  addEventListener(
    type: 'relocate',
    listener: (event: CustomEvent<FoliateRelocateDetail>) => void
  ): void
  addEventListener(type: string, listener: (event: never) => void): void
}

export class View extends HTMLElement {
  book?: FoliateBook
  renderer?: FoliateRenderer
  isFixedLayout: boolean
  lastLocation?: {
    index: number
    fraction: number
    cfi?: string
    range?: Range
    tocItem?: unknown
    pageItem?: unknown
  }
  open(book: File | Blob | FoliateBook): Promise<void>
  close(): void
  init(options: {
    lastLocation?: unknown
    showTextStart?: boolean
  }): Promise<void>
  goTo(
    target: number | { index: number; anchor?: FoliateAnchor }
  ): Promise<void>
  goToFraction(fraction: number): Promise<void>
  getCFI(index: number, range?: Range): string
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range }
  deselect(): void
}
