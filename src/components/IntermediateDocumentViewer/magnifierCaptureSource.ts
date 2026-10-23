// Only presentation values whose CSS grammar cannot contain resource URLs or
// select host-defined fonts/counters. Never copy publication attributes or CSS.
const PRESENTATION_PROPERTIES = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'clear',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'border-collapse',
  'border-spacing',
  'table-layout',
  'color',
  'background-color',
  'opacity',
  'visibility',
  'overflow',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'word-break',
  'overflow-wrap',
  'text-align',
  'text-indent',
  'text-transform',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'vertical-align',
  'direction',
  'writing-mode',
  'text-orientation',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'align-content',
  'justify-content',
  'order',
  'row-gap',
  'column-gap',
  'column-count',
  'column-width',
  'column-fill'
]

const OMITTED_ELEMENTS = new Set([
  'STYLE',
  'SCRIPT',
  'LINK',
  'META',
  'BASE',
  'IFRAME',
  'FRAME',
  'OBJECT',
  'EMBED',
  'VIDEO',
  'AUDIO',
  'SOURCE',
  'TRACK',
  'SVG',
  'MATH',
  'TEMPLATE',
  'NOSCRIPT',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'BUTTON'
])

function appendDecodedImage(image: HTMLImageElement, copy: HTMLElement) {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return
  const canvas = copy.ownerDocument.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) return
  try {
    context.drawImage(image, 0, 0)
    // Fail closed for tainted pixels; never re-fetch an image's URL.
    context.getImageData(0, 0, 1, 1)
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    copy.append(canvas)
  } catch {
    // Unavailable/tainted images are omitted from this transient snapshot.
  }
}

function staticPresentation(
  source: Element,
  owner: Document
): HTMLElement | null {
  const tagName = source.tagName.toUpperCase()
  if (OMITTED_ELEMENTS.has(tagName)) return null
  const computed = source.ownerDocument.defaultView?.getComputedStyle(source)
  if (!computed) return null
  const copy = owner.createElement(tagName === 'BR' ? 'br' : 'div')
  copy.style.all = 'initial'
  for (const property of PRESENTATION_PROPERTIES)
    copy.style.setProperty(property, computed.getPropertyValue(property))
  // Arbitrary publication families could activate a host's lazy @font-face.
  copy.style.fontFamily =
    computed.fontFamily.match(
      /(?:^|,)\s*(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*(?:,|$)/i
    )?.[1] ?? 'serif'

  if (tagName === 'IMG') {
    appendDecodedImage(source as HTMLImageElement, copy)
    return copy
  }
  for (const child of source.childNodes) {
    if (child.nodeType === 3)
      copy.append(owner.createTextNode(child.textContent ?? ''))
    else if (child.nodeType === 1) {
      const element = staticPresentation(child as Element, owner)
      if (element) copy.append(element)
    }
  }
  return copy
}

export function magnifierCaptureSource(source: HTMLElement, owner: Document) {
  if (source.ownerDocument === owner)
    return { element: source, release: () => {} }

  // Publication CSP forbids html2canvas's internal frame. Build a resource-free
  // presentation tree instead of importing untrusted DOM into the host.
  const wrapper = owner.createElement('div')
  const box = source.getBoundingClientRect()
  Object.assign(wrapper.style, {
    all: 'initial',
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${box.width}px`,
    height: `${box.height}px`,
    pointerEvents: 'none',
    overflow: 'hidden',
    contain: 'strict'
  })
  wrapper.setAttribute('aria-hidden', 'true')
  // Keep host selectors/pseudo-elements out of the temporary presentation.
  // html2canvas traverses open shadow roots and preserves inline presentation.
  const shadow = wrapper.attachShadow({ mode: 'open' })
  const copy = staticPresentation(source, owner)
  if (copy) {
    Object.assign(copy.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      margin: '0',
      width: `${box.width}px`,
      height: `${box.height}px`
    })
    shadow.append(copy)
  }
  owner.body.append(wrapper)
  return { element: wrapper, release: () => wrapper.remove() }
}
