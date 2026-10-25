// HAM-88 测试辅助：foliate-view 假视图工厂（jsdom 无布局）。
// 只模拟引擎用到的表面：open/book/renderer/close/goTo + 事件注入。

import { vi, type Mock } from 'vitest'

import type { View } from '../../vendor/foliate-js/view.js'

export const DUPLICATE_TEXT_SECTIONS = [
  'OPS/cover.xhtml',
  'OPS/chapter1.xhtml',
  'OPS/chapter2.xhtml',
  'OPS/chapter3.xhtml'
] as const

export type FakeRenderer = {
  attrs: Record<string, string>
  styles: string[]
  goToCalls: unknown[]
  destroyed: boolean
  setAttribute(name: string, value: string): void
  setStyles(styles: string): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  getContents(): readonly unknown[]
  goTo(target: unknown): Promise<void>
  scrollToAnchor(): Promise<void>
  destroy(): void
}

export type FakeViewHandle = {
  view: View
  renderer: FakeRenderer
  emit: (type: string, detail: unknown) => void
  openStarted: Promise<void>
  resolveOpen: () => void
  bookDestroy: Mock
  viewClose: Mock
}

export type FakeView = {
  factory: () => View
  handle: FakeViewHandle
}

export const makeFakeView = (options?: {
  holdOpen?: boolean
  sectionHrefs?: readonly string[]
  toc?: readonly { label: string; href: string }[]
}): FakeView => {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  let resolveOpen!: () => void
  const openReady = new Promise<void>((resolve) => {
    resolveOpen = resolve
  })
  let markOpenStarted!: () => void
  const openStarted = new Promise<void>((resolve) => {
    markOpenStarted = resolve
  })

  const renderer: FakeRenderer = {
    attrs: {},
    styles: [],
    goToCalls: [],
    destroyed: false,
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    setStyles(styles) {
      this.styles.push(styles)
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    getContents: () => [],
    goTo(target) {
      this.goToCalls.push(target)
      return Promise.resolve()
    },
    scrollToAnchor: () => Promise.resolve(),
    destroy() {
      this.destroyed = true
    }
  }

  const sections = (options?.sectionHrefs ?? DUPLICATE_TEXT_SECTIONS).map(
    (href) => ({ id: href, linear: 'yes' })
  )
  const bookDestroy = vi.fn()
  const viewClose = vi.fn()
  const element = document.createElement('div')
  const view = Object.assign(element, {
    renderer,
    book: {
      sections,
      toc: (options?.toc ?? []).map((item) => ({ ...item })),
      resolveHref: (href: string) => {
        const index = sections.findIndex(
          (section) => section.id === `OPS/${href}`
        )
        return index >= 0 ? { index, anchor: () => 0 } : null
      },
      getCover: () => Promise.resolve(null),
      isExternal: () => false,
      destroy: bookDestroy
    },
    open: vi.fn(() => {
      markOpenStarted()
      return options?.holdOpen ? openReady : Promise.resolve()
    }),
    close: viewClose,
    goTo: (target: unknown) => {
      renderer.goToCalls.push(target)
      return Promise.resolve()
    }
  }) as unknown as View

  return {
    factory: () => view,
    handle: {
      view,
      renderer,
      emit: (type, detail) => {
        for (const listener of listeners.get(type) ?? []) {
          listener({ detail })
        }
      },
      openStarted,
      resolveOpen,
      bookDestroy,
      viewClose
    }
  }
}
