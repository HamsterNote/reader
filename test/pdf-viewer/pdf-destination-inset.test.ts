import { afterEach, describe, expect, it, vi } from 'vitest'
import { CroppedPdfViewer } from '../../src/pdf/CroppedPdfViewer'
import { EventBus, PDFViewer } from '../../src/pdf/pdfViewerLib'

type Destination = Parameters<PDFViewer['scrollPageIntoView']>[0]
type TestDestination = Destination & {
  landing?: number
  reenter?: boolean
}

function fixture(
  topInset: number | (() => number),
  landing: number,
  { scrollHeight = 1000, clientHeight = 400 } = {}
) {
  const container = document.createElement('div')
  let scrollTop = 0
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    }
  })
  const viewer = new CroppedPdfViewer(
    {
      container,
      viewer: document.createElement('div'),
      eventBus: new EventBus()
    },
    {
      crop: () => undefined,
      pages: () => [1, 2],
      topInset: typeof topInset === 'function' ? topInset : () => topInset
    }
  )
  const calls: TestDestination[] = []
  vi.spyOn(PDFViewer.prototype, 'scrollPageIntoView').mockImplementation(
    function (this: PDFViewer, options) {
      const call = options as TestDestination
      calls.push(call)
      if (call.reenter) {
        call.reenter = false
        this.scrollPageIntoView({
          pageNumber: call.pageNumber,
          destArray: [null, { name: 'XYZ' }, 0, 800, 0],
          landing: landing + 50
        } as TestDestination)
      }
      this.container.scrollTop = call.landing ?? landing
    }
  )
  return { container, viewer, calls }
}

const xyz = (y: number | null = 600, zoom: number | null = 0) =>
  ({
    pageNumber: 2,
    destArray: [null, { name: 'XYZ' }, 0, y, zoom]
  }) as Destination

afterEach(() => vi.restoreAllMocks())

describe('explicit PDF destination top inset', () => {
  it('deducts a non-zero inset once for a top-aligned XYZ destination', () => {
    const { container, viewer } = fixture(65, 100)
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(35)
  })

  it('keeps the caller absolute alignment result after the inset pass', () => {
    const { container, viewer } = fixture(30, 100)
    viewer.scrollPageIntoView({
      ...xyz(),
      allowNegativeOffset: true
    })
    expect(container.scrollTop).toBe(70)
    // alignTop re-applies its absolute target after scrollPageIntoView.
    container.scrollTop = 100
    expect(container.scrollTop).toBe(100)
  })

  it('does not deduct twice when a destination zoom re-enters navigation', () => {
    const { container, viewer, calls } = fixture(65, 100)
    viewer.scrollPageIntoView({ ...xyz(), reenter: true } as TestDestination)
    expect(calls).toHaveLength(2)
    expect(container.scrollTop).toBe(35)
  })

  it('leaves scroll position unchanged when there is no top inset', () => {
    const { container, viewer } = fixture(0, 100)
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(100)
  })

  it('reads the inset dynamically for every destination', () => {
    let inset = 0
    const { container, viewer } = fixture(() => inset, 100)
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(100)
    inset = 40
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(60)
  })

  it('clamps the first page at the document start', () => {
    const { container, viewer } = fixture(65, 20)
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(0)
  })

  it('clamps the last page at the maximum scroll offset', () => {
    const { container, viewer } = fixture(65, 900, {
      scrollHeight: 1000,
      clientHeight: 400
    })
    viewer.scrollPageIntoView(xyz())
    expect(container.scrollTop).toBe(600)
  })

  it.each([
    ['non-XYZ destination', { destArray: [null, { name: 'FitH' }, 600] }],
    ['null y coordinate', { destArray: [null, { name: 'XYZ' }, 0, null, 0] }],
    ['destination zoom', { destArray: [null, { name: 'XYZ' }, 0, 600, 1.5] }],
    ['vertically centered destination', { center: 'vertical' }],
    ['both-axis centered destination', { center: 'both' }]
  ])('skips %s', (_name, override) => {
    const { container, viewer } = fixture(65, 100)
    viewer.scrollPageIntoView({
      pageNumber: 2,
      ...override
    } as Destination)
    expect(container.scrollTop).toBe(100)
  })
})
