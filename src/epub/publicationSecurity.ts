const PUBLICATION_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' blob:",
  'img-src blob: data:',
  'font-src blob: data:',
  'media-src blob: data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function unsafeAttribute(attribute: Attr, elementName: string): boolean {
  const key = attribute.localName.toLowerCase()
  // eslint-disable-next-line no-control-regex
  const value = attribute.value.replace(/[\u0000-\u0020]/g, '')
  if (key.startsWith('on') || key === 'srcdoc') return true
  if (!['href', 'src', 'action', 'formaction'].includes(key)) return false
  if (key === 'src' && elementName === 'img' && /^data:image\//i.test(value))
    return false
  return /^(?:javascript|vbscript|file|data):/i.test(value)
}

/** Runs on the serialized resource, before an iframe can execute publication code. */
export function sanitizePublication(source: string, mime: string): string {
  const type = mime === 'text/html' ? 'text/html' : 'application/xhtml+xml'
  const doc = new DOMParser().parseFromString(source, type)
  if (doc.querySelector('parsererror'))
    throw new Error('Invalid publication markup')
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const name = element.localName.toLowerCase()
    if (
      [
        'script',
        'iframe',
        'frame',
        'object',
        'embed',
        'base',
        'form',
        'foreignobject',
        'animate',
        'animatemotion',
        'animatetransform',
        'set'
      ].includes(name)
    ) {
      element.remove()
      continue
    }
    if (name === 'meta' && element.hasAttribute('http-equiv')) {
      element.remove()
      continue
    }
    for (const attribute of Array.from(element.attributes)) {
      if (unsafeAttribute(attribute, name)) {
        element.removeAttributeNode(attribute)
      }
    }
  }
  const head = doc.querySelector('head')
  if (head) {
    const policy = doc.createElementNS(head.namespaceURI, 'meta')
    policy.setAttribute('http-equiv', 'Content-Security-Policy')
    policy.setAttribute('content', PUBLICATION_CSP)
    head.prepend(policy)
  }
  return new XMLSerializer().serializeToString(doc)
}

export function restrictPublicationResources(target: EventTarget): void {
  target.addEventListener('load', (event) => {
    const detail = (event as CustomEvent<{ isScript: boolean; allow: boolean }>)
      .detail
    if (detail.isScript) detail.allow = false
  })
  target.addEventListener('data', (event) => {
    const detail = (event as CustomEvent<{ data: unknown; type: string }>)
      .detail
    if (
      !['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(
        detail.type
      )
    )
      return
    detail.data = Promise.resolve(detail.data).then((data) => {
      if (typeof data !== 'string')
        throw new Error('Invalid publication resource')
      return sanitizePublication(data, detail.type)
    })
  })
}
