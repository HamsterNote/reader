import { expect, it } from 'vitest'
import {
  clearFlowMagnifierText,
  renderFlowMagnifierText
} from '../src/components/IntermediateDocumentViewer/flowMagnifierText'
import { mockElementSize } from './setup'

it('reuses plain text across selection changes, invalidates reflow, and excludes publication/annotation content', () => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.body.innerHTML =
    '<p style="font-size:16px" onclick="alert(1)">Alpha <em>beta</em><svg><text>highlight</text></svg><button>handle</button><script>unsafe()</script></p>'
  const paragraph = doc.querySelector('p')!
  const emphasis = doc.querySelector('em')!
  const output = document.createElement('div')
  document.body.append(output)
  mockElementSize(frame, { left: 13, top: 19, width: 400, height: 400 })
  paragraph.getBoundingClientRect = () => new DOMRect(40, 100, 200, 30)
  emphasis.getBoundingClientRect = () => new DOMRect(90, 100, 40, 30)
  const proto = Object.getPrototypeOf(doc.createRange())
  const original = Object.getOwnPropertyDescriptor(
    proto,
    'getBoundingClientRect'
  )
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range) {
      const left = this.startContainer.parentElement === emphasis ? 90 : 40
      return new DOMRect(left + this.startOffset * 8, 100, 8, 20)
    }
  })
  const point = { clientX: 113, clientY: 129 }
  try {
    renderFlowMagnifierText(output, doc.body, point)
    expect(output.textContent).toBe('Alpha beta')
    expect(output.querySelector('script,svg,button,[onclick]')).toBeNull()
    const copies = [...output.childNodes]
    const range = doc.createRange()
    range.selectNodeContents(paragraph.firstChild!)
    doc.getSelection()!.addRange(range)
    renderFlowMagnifierText(output, doc.body, { ...point, clientX: 114 })
    expect([...output.childNodes]).toEqual(copies)
    paragraph.style.fontSize = '24px'
    renderFlowMagnifierText(output, doc.body, point)
    expect(output.firstChild).not.toBe(copies[0])
    clearFlowMagnifierText(output)
    expect(output.childNodes.length).toBe(0)
  } finally {
    if (original)
      Object.defineProperty(proto, 'getBoundingClientRect', original)
    else Reflect.deleteProperty(proto, 'getBoundingClientRect')
    output.remove()
    frame.remove()
  }
})
