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
function bindLinks(doc: PDFDocumentProxy, hash: string) {
  const container = document.createElement('div')
  container.innerHTML = `<a target="_blank" href="https://undefined/part-2.html${hash}"></a><a href="https://undefined/part-2.html#创立标准"></a>`
  document.body.append(container)
  const service = {
    goToDestination: vi.fn(async () => {}),
    getDestinationHash: vi.fn(() => '#repaired')
  }
  // Prevent jsdom navigation if a regression lets the event escape capture.
  const escaped = vi.fn((event: MouseEvent) => event.preventDefault())
  container.addEventListener('click', escaped)
  cleanups.push(bindPdfSourceLinks(container, doc, service))
  const link = container.querySelector('a')!
  const syntheticClick = vi.spyOn(link, 'click')
  const click = () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  }
  return { container, link, service, escaped, syntheticClick, click }
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
})

describe('printed PDF source links', () => {
  it('recovers encoded cross-chapter destinations using physical heading coordinates', async () => {
    const index = await indexPdfSourceLinks(documentWith())
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
  })

  it.each([
    ['missing target', '#missing', false],
    ['ambiguous heading in a single source origin', '#浏览器博弈论', true]
  ] as const)(
    'blocks %s both during and after indexing',
    async (_, hash, duplicate) => {
      const doc = documentWith(duplicate ? [...pages, pages[2]] : pages)
      let finish!: () => void
      const gate = new Promise<void>((resolve) => {
        finish = resolve
      })
      const getPage = doc.getPage.bind(doc)
      vi.spyOn(doc, 'getPage').mockImplementation(async (number) => {
        await gate
        return getPage(number)
      })
      const { link, service, escaped, syntheticClick, click } = bindLinks(
        doc,
        hash
      )
      const href = link.href
      click()
      expect(service.goToDestination).not.toHaveBeenCalled()
      finish()
      // The valid sibling proves the full index and repair pass have completed.
      await vi.waitFor(() =>
        expect(service.getDestinationHash).toHaveBeenCalled()
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(link.href).toBe(href)
      expect(syntheticClick).not.toHaveBeenCalled()
      click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(link.href).toBe(href)
      expect(syntheticClick).not.toHaveBeenCalled()
      expect(escaped).not.toHaveBeenCalled()
      expect(service.goToDestination).not.toHaveBeenCalled()
    }
  )

  it.each(['#%E0%A4%A', '#%FF', '#---', '#%21%20%23'])(
    'blocks invalid or empty-normalized fragment %s instead of the chapter destination',
    async (hash) => {
      const { link, service, escaped, syntheticClick, click } = bindLinks(
        documentWith(),
        hash
      )
      const href = link.href
      await vi.waitFor(() =>
        expect(service.getDestinationHash).toHaveBeenCalled()
      )
      click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(link.href).toBe(href)
      expect(service.goToDestination).not.toHaveBeenCalled()
      expect(syntheticClick).not.toHaveBeenCalled()
      expect(escaped).not.toHaveBeenCalled()
    }
  )

  it.each(['', '#'])(
    'preserves a legitimate empty chapter fragment %j',
    async (hash) => {
      const { service, escaped, click } = bindLinks(documentWith(), hash)
      await vi.waitFor(() =>
        expect(service.getDestinationHash).toHaveBeenCalled()
      )
      click()
      expect(service.goToDestination).toHaveBeenCalledExactlyOnceWith([
        1,
        { name: 'XYZ' },
        30,
        715,
        null
      ])
      expect(escaped).not.toHaveBeenCalled()
    }
  )

  it.each(['#%E0%A4%A', '#---'])(
    'does not index invalid source fragment %s as a second empty chapter target',
    async (hash) => {
      const index = await indexPdfSourceLinks(
        documentWith([
          {
            annotations: [marker(source.slice(0, source.indexOf('#')) + hash)],
            items: pages[1].items
          }
        ])
      )
      expect(index.destinations.get('/part-2.html#')).toEqual([
        0,
        { name: 'XYZ' },
        30,
        715,
        null
      ])
      expect(index.destinations.has('/part-2.html#null')).toBe(false)
    }
  )

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
    const syntheticClick = vi.spyOn(link, 'click')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
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
    expect(syntheticClick).not.toHaveBeenCalled()
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
