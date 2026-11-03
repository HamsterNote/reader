import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from '../../src/pdf/pdfjsRuntime'
import {
  bindPdfSourceLinks,
  indexPdfSourceLinks
} from '../../src/pdf/pdfSourceLinks'

const marker = (url?: string, y = 700) => ({
  subtype: 'Link',
  overlaidText: '§',
  rect: [200, y - 2, 215, y + 12],
  unsafeUrl: url,
  // Deliberately stale after concatenation: must use the physical page.
  dest: [{ num: 1, gen: 0 }, { name: 'XYZ' }, 10, y, null]
})
const text = (str: string, x: number, y: number) => ({
  str,
  transform: [12, 0, 0, 12, x, y]
})
const source =
  'chrome-extension://example/reader?url=' +
  encodeURIComponent('https://source.example/part-2.html') +
  '#创立标准'
const pages = [
  { annotations: [], items: [] },
  {
    annotations: [marker(source)],
    items: [text('创立标准', 30, 700), text('§', 200, 700)]
  },
  {
    annotations: [marker()],
    items: [...'浏览器博弈论']
      .map((glyph, index) => text(glyph, 30 + index * 20, 700))
      .concat([text('§', 200, 700)])
  }
]
function documentWith(data = pages) {
  return {
    numPages: data.length,
    getPage: vi.fn(async (n: number) => ({
      getAnnotations: async () => data[n - 1].annotations,
      getTextContent: async () => ({ items: data[n - 1].items })
    }))
  } as unknown as PDFDocumentProxy
}
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
})

describe('printed PDF source links', () => {
  it('recovers encoded cross-chapter destinations using physical heading coordinates', async () => {
    const index = await indexPdfSourceLinks(documentWith())
    expect(index.origin).toBe('https://source.example')
    expect(index.destinations.get('/part-2.html#')).toEqual([
      1,
      { name: 'XYZ' },
      30,
      715,
      null
    ])
    expect(index.destinations.get('/part-2.html#浏览器博弈论')).toEqual([
      2,
      { name: 'XYZ' },
      30,
      715,
      null
    ])
  })

  it('does not guess between repeated headings or mixed source origins', async () => {
    const other = source.replace('source.example', 'other.example')
    const index = await indexPdfSourceLinks(
      documentWith([
        ...pages,
        pages[2],
        {
          annotations: [marker(other)],
          items: pages[1].items
        }
      ])
    )
    expect(index.destinations.get('/part-2.html#浏览器博弈论')).toBeNull()
    expect(index.origin).toBeNull()
  })

  it('handles an early mouse click, lazy annotations, normal links and cleanup', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const service = {
      goToDestination: vi.fn(async () => {}),
      getDestinationHash: (dest: unknown[]) =>
        '#' + encodeURIComponent(JSON.stringify(dest))
    }
    const doc = documentWith()
    const cleanup = bindPdfSourceLinks(container, doc, service)
    cleanups.push(cleanup)
    expect(doc.getPage).not.toHaveBeenCalled()
    container.innerHTML = `<a href="https://undefined/part-2.html#${encodeURIComponent('浏览器博弈论')}"></a><a href="https://valid.example/path"></a><a href="#native-destination"></a>`
    const link = container.querySelector('a')!
    link.click()
    await vi.waitFor(() =>
      expect(service.goToDestination).toHaveBeenCalledOnce()
    )
    expect(service.goToDestination).toHaveBeenCalledWith([
      2,
      { name: 'XYZ' },
      30,
      715,
      null
    ])
    expect(container.children[1].getAttribute('href')).toBe(
      'https://valid.example/path'
    )
    expect(container.children[2].getAttribute('href')).toBe(
      '#native-destination'
    )
    const next = document.createElement('a')
    next.href = 'https://undefined/part-2.html'
    container.append(next)
    await vi.waitFor(() => expect(next.href).not.toContain('undefined'))
    cleanup()
    link.click()
    expect(service.goToDestination).toHaveBeenCalledOnce()
  })

  it('cancels an unfinished index without navigating a replacement document', async () => {
    const container = document.createElement('div')
    container.innerHTML = '<a href="https://undefined/part-2.html"></a>'
    document.body.append(container)
    const doc = documentWith()
    const service = {
      goToDestination: vi.fn(async () => {}),
      getDestinationHash: () => '#repaired'
    }
    const cleanup = bindPdfSourceLinks(container, doc, service)
    container.querySelector('a')!.click()
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.goToDestination).not.toHaveBeenCalled()
    expect(doc.getPage).toHaveBeenCalledTimes(1)
  })
})
