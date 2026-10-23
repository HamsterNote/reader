import { afterEach, describe, expect, it, vi } from 'vitest'

import { magnifierCaptureSource } from '../src/components/IntermediateDocumentViewer/magnifierCaptureSource'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function publication(markup: string) {
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const doc = iframe.contentDocument!
  doc.body.innerHTML = markup
  return doc.body
}

describe('publication magnifier capture boundary', () => {
  it('keeps the existing same-document capture path', () => {
    const page = document.createElement('div')
    document.body.append(page)
    const capture = magnifierCaptureSource(page, document)
    expect(capture.element).toBe(page)
    capture.release()
    expect(page.isConnected).toBe(true)
  })

  it('constructs presentation without publication attributes, stylesheets or URL-bearing computed styles', () => {
    const body = publication(`
      <style>#host { color: red !important }</style>
      <link rel="stylesheet" href="https://probe.invalid/style.css">
      <p id="host" class="host-font" onclick="attack()" style="color:rgb(12, 34, 56); font-family:HostFont, monospace; background-image:url(https://probe.invalid/bg.png); cursor:url(https://probe.invalid/cursor.png),auto; border-image-source:url(https://probe.invalid/border.png)">Visible <b>text</b></p>
      <img src="https://probe.invalid/image.png" srcset="https://probe.invalid/srcset.png 1x">
      <svg><image href="https://probe.invalid/svg.png"/></svg>
      <iframe src="https://probe.invalid/frame"></iframe>
    `)
    const capture = magnifierCaptureSource(body, document)
    const tree = capture.element.shadowRoot!
    const paragraph = [...tree.querySelectorAll('div')].find(
      (element) => element.textContent === 'Visible text'
    )!
    expect(paragraph.style.fontFamily).toBe('monospace')
    expect(paragraph.style.color).toBe('rgb(12, 34, 56)')
    expect(paragraph.style.backgroundImage).toBe('')
    expect(paragraph.style.borderImageSource).toBe('')
    expect(paragraph.style.cursor).toBe('')
    expect(
      tree.querySelector(
        'style,link,img,svg,iframe,[src],[srcset],[href],[id],[class],[onclick]'
      )
    ).toBeNull()
    expect(tree.textContent).not.toContain('#host')
    expect(document.querySelector('#host')).toBeNull()
    capture.release()
    expect(capture.element.isConnected).toBe(false)
  })

  it.each([false, true])(
    'copies decoded pixels only, and omits tainted pixels (tainted=%s)',
    (tainted) => {
      const body = publication('<img src="https://probe.invalid/image.png" />')
      const image = body.querySelector('img')!
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 2 },
        naturalHeight: { value: 3 }
      })
      const drawImage = vi.fn()
      const getImageData = vi.fn(() => {
        if (tainted) throw new DOMException('Tainted', 'SecurityError')
        return { data: new Uint8ClampedArray(4) }
      })
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
        getImageData
      } as unknown as CanvasRenderingContext2D)
      const capture = magnifierCaptureSource(body, document)
      expect(drawImage).toHaveBeenCalledWith(image, 0, 0)
      expect(getImageData).toHaveBeenCalled()
      expect(capture.element.shadowRoot!.querySelector('canvas') !== null).toBe(
        !tainted
      )
      expect(capture.element.shadowRoot!.querySelector('[src]')).toBeNull()
      capture.release()
    }
  )
})
