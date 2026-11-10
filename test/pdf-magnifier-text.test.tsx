import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  RangeMagnifierProvider,
  useRangeMagnifier
} from '../src/components/IntermediateDocumentViewer/RangeMagnifier'
import { mockElementSize } from './setup'

vi.mock('html2canvas', () => ({
  default: vi.fn(() => {
    throw new Error('PDF must not capture a page snapshot')
  })
}))

it('portals the PDF lens alongside handles and reads the current page without highlights', () => {
  const host = document.createElement('div')
  host.innerHTML =
    '<div class="pdfViewer"><div class="page"><div class="textLayer"><span>First page</span></div><svg><path/></svg></div><div class="page"><div class="textLayer"><span>Second page</span></div></div></div>'
  document.body.append(host)
  const source = host.querySelector<HTMLElement>('.pdfViewer')!
  const layers = [...host.querySelectorAll<HTMLElement>('.textLayer')]
  const range = document.createRange()
  range.selectNodeContents(layers[0].firstChild!)
  let controller!: NonNullable<ReturnType<typeof useRangeMagnifier>>
  function Consumer() {
    controller = useRangeMagnifier()!
    return null
  }
  mockElementSize(host, { left: 10, top: 20, width: 400, height: 600 })
  mockElementSize(layers[0], { left: 20, top: 50, width: 300, height: 200 })
  mockElementSize(layers[1], { left: 20, top: 270, width: 300, height: 200 })
  const view = render(
    <RangeMagnifierProvider rootElement={host}>
      <Consumer />
    </RangeMagnifierProvider>
  )
  const focus = { range, end: true, color: '#ffc107' }
  act(() => controller.start(source, { clientX: 120, clientY: 230 }, focus, 'touch'))
  const lens = screen.getByTestId('range-magnifier')
  expect(lens.parentElement).toBe(document.body)
  expect(lens.hidden).toBe(false)
  expect(lens.textContent).toBe('First page')
  act(() => controller.move({ clientX: 120, clientY: 260 }, focus))
  expect(lens.textContent).toBe('First pageSecond page')
  act(() => controller.move({ clientX: 120, clientY: 310 }, focus))
  expect(lens.textContent).toBe('Second page')
  expect(lens.querySelector('svg, path, .textLayer, button')).toBeNull()
  expect(
    lens.querySelector<HTMLElement>('.hamster-reader__range-magnifier-marker')!
      .style.backgroundColor
  ).toBe('rgb(255, 193, 7)')
  act(() => controller.end())
  expect(lens.hidden).toBe(true)
  expect(lens.textContent).toBe('')
  view.unmount()
  host.remove()
})

it('releases PDF text caches on end and document replacement', () => {
  const host = document.createElement('div')
  host.innerHTML =
    '<div class="pdfViewer"><div class="page"><div class="textLayer"><span>First page</span></div></div></div>'
  document.body.append(host)
  const source = host.querySelector<HTMLElement>('.pdfViewer')!
  const layer = host.querySelector<HTMLElement>('.textLayer')!
  mockElementSize(host, { left: 10, top: 20, width: 400, height: 600 })
  mockElementSize(layer, { left: 20, top: 50, width: 300, height: 200 })
  const range = document.createRange()
  range.selectNodeContents(layer.firstChild!)
  let controller!: NonNullable<ReturnType<typeof useRangeMagnifier>>
  function Consumer() {
    controller = useRangeMagnifier()!
    return null
  }
  const view = render(
    <RangeMagnifierProvider rootElement={host} source='book-a'>
      <Consumer />
    </RangeMagnifierProvider>
  )
  const focus = { range, end: true, color: '#ffc107' }
  act(() => controller.start(source, { clientX: 120, clientY: 230 }, focus, 'touch'))
  const lens = screen.getByTestId('range-magnifier')
  const output = lens.querySelector<HTMLElement>(
    '.hamster-reader__range-magnifier-text'
  )!
  const firstCopy = output.firstChild
  expect(firstCopy).not.toBeNull()
  // Active movement can reuse a clone, but ending must release that cache.
  act(() => controller.move({ clientX: 120, clientY: 230 }, focus))
  expect(output.firstChild).toBe(firstCopy)
  act(() => controller.end())
  expect(lens.hidden).toBe(true)
  expect(output.childNodes).toHaveLength(0)

  act(() => controller.start(source, { clientX: 120, clientY: 230 }, focus, 'touch'))
  const secondCopy = output.firstChild
  expect(secondCopy).not.toBeNull()
  expect(secondCopy).not.toBe(firstCopy)
  view.rerender(
    <RangeMagnifierProvider rootElement={host} source='book-b'>
      <Consumer />
    </RangeMagnifierProvider>
  )
  expect(lens.hidden).toBe(true)
  expect(output.childNodes).toHaveLength(0)
  act(() => controller.start(source, { clientX: 120, clientY: 230 }, focus, 'touch'))
  expect(output.firstChild).not.toBeNull()
  expect(output.firstChild).not.toBe(secondCopy)
  view.unmount()
  expect(output.childNodes).toHaveLength(0)
  host.remove()
})
