import { describe, expect, it } from 'vitest'
import {
  restrictPublicationResources,
  sanitizePublication
} from '../../src/epub/publicationSecurity'

describe('publication execution boundary', () => {
  it('removes execution, navigation and SVG mutation before serialization', () => {
    const result = sanitizePublication(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head>
      <meta http-equiv="refresh" content="0;url=https://example.com"/><base href="file:///"/>
      <script>parent.ReactNativeWebView.postMessage('forged')</script></head><body onload="alert(1)">
      <p onclick="alert(1)">Readable text</p><iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"/>
      <a href="java&#x09;script:alert(1)">Unsafe</a><a href="data:text/html,evil">Data</a>
      <svg xmlns="http://www.w3.org/2000/svg"><foreignObject/><set attributeName="href" to="javascript:alert(1)"/></svg>
      <img src="blob:book-image"/><img src="data:image/png;base64,AA"/>
      </body></html>`,
      'application/xhtml+xml'
    )
    const doc = new DOMParser().parseFromString(result, 'application/xhtml+xml')
    expect(doc.querySelector('script,iframe,base,foreignObject,set')).toBeNull()
    expect(doc.querySelector('[onload],[onclick],a[href]')).toBeNull()
    expect(doc.querySelector('p')?.textContent).toBe('Readable text')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(
      'blob:book-image'
    )
    const policy = doc.querySelector('meta')?.getAttribute('content')
    expect(policy).toContain("script-src 'none'")
    expect(policy).toContain("connect-src 'none'")
  })

  it('denies external scripts and sanitizes the resource promise before Foliate loads it', async () => {
    const target = new EventTarget()
    restrictPublicationResources(target)
    const script = { isScript: true, allow: true }
    target.dispatchEvent(new CustomEvent('load', { detail: script }))
    expect(script.allow).toBe(false)
    const resource = {
      type: 'text/html',
      data: Promise.resolve(
        '<html><head></head><body><script>alert(1)</script><p>Book</p></body></html>'
      )
    }
    target.dispatchEvent(new CustomEvent('data', { detail: resource }))
    expect(await resource.data).not.toContain('<script>')
    expect(await resource.data).toContain('Book')
  })

  it('fails closed for malformed XHTML', () => {
    expect(() =>
      sanitizePublication('<html><broken>', 'application/xhtml+xml')
    ).toThrow('Invalid publication markup')
  })
})
