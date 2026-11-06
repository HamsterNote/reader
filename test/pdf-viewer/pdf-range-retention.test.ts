import { expect, it } from 'vitest'
import {
  PdfRangeRetention,
  snapshotPdfRange
} from '../../src/pdf/pdfRangeRetention'
import { mockElementSize } from '../setup'

it('retains selected text across PDF.js eviction, suppresses duplicate layers, and releases only retained text', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<div class="pdfViewer"><div class="page"><canvas/><div class="textLayer"><span>Alpha beta</span></div></div></div>'
  document.body.append(root)
  const page = root.querySelector<HTMLElement>('.page')!
  const layer = root.querySelector<HTMLElement>('.textLayer')!
  const text = layer.firstChild!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 5)
  const recover = snapshotPdfRange(range)
  const retention = new PdfRangeRetention()
  mockElementSize(page, { width: 400, height: 600 })
  retention.track(root, range)
  page.replaceChildren()
  expect(range.collapsed).toBe(true)
  expect(retention.restore(root)).toBe(true)
  expect(recover()).toBe(true)
  expect(range.toString()).toBe('Alpha')
  expect(page.querySelector('canvas')).toBeNull()
  const rebuilt = document.createElement('div')
  rebuilt.className = 'textLayer'
  rebuilt.textContent = 'Alpha beta'
  page.append(rebuilt)
  retention.restore(root)
  expect(rebuilt.style.display).toBe('none')
  retention.clear()
  expect(layer.isConnected).toBe(false)
  expect(rebuilt.isConnected).toBe(true)
  expect(rebuilt.style.display).toBe('')
  root.remove()
})

it('invalidates retained text when the page geometry changes, preserving native layers on cleanup', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<div class="pdfViewer"><div class="page"><div class="textLayer"><span>Alpha</span></div></div></div>'
  document.body.append(root)
  const page = root.querySelector<HTMLElement>('.page')!
  const range = document.createRange()
  range.selectNodeContents(root.querySelector('span')!)
  const retention = new PdfRangeRetention()
  mockElementSize(page, { width: 400, height: 600 })
  retention.track(root, range)
  mockElementSize(page, { width: 800, height: 1200 })
  expect(retention.restore(root)).toBe(false)
  retention.clear()
  expect(root.querySelector('.textLayer')).not.toBeNull()
  root.remove()
})
