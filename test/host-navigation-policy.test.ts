import { describe, expect, it } from 'vitest'

import { decideReaderNavigation } from '../src/host/navigationPolicy'

const entryUrl = 'file:///data/user/0/app/files/webreader/v1/index.html'
const baseDir = 'file:///data/user/0/app/files/webreader/v1/'

describe('decideReaderNavigation', () => {
  it('allows the packaged reader entry and its local assets', () => {
    expect(decideReaderNavigation(entryUrl, entryUrl)).toEqual({
      action: 'allow'
    })
    expect(
      decideReaderNavigation(`${baseDir}assets/webview.js`, entryUrl)
    ).toEqual({ action: 'allow' })
    expect(
      decideReaderNavigation(`${baseDir}pdfjs/pdf.worker.min.mjs`, entryUrl)
    ).toEqual({ action: 'allow' })
    expect(decideReaderNavigation('about:blank', entryUrl)).toEqual({
      action: 'allow'
    })
  })

  it('blocks local paths outside the reader resource directory', () => {
    expect(
      decideReaderNavigation(
        'file:///data/user/0/app/files/reader-files/secret.epub',
        entryUrl
      ).action
    ).toBe('block')
    expect(
      decideReaderNavigation(`${baseDir}../reader-files/secret.epub`, entryUrl)
        .action
    ).toBe('block')
    expect(
      decideReaderNavigation(
        `${baseDir}assets/..%2F..%2Freader-files%2Fsecret.epub`,
        entryUrl
      ).action
    ).toBe('block')
  })

  it('hands external web links to the host instead of navigating', () => {
    expect(
      decideReaderNavigation('https://example.com/article', entryUrl)
    ).toEqual({ action: 'external', url: 'https://example.com/article' })
    expect(decideReaderNavigation('http://example.com', entryUrl)).toEqual({
      action: 'external',
      url: 'http://example.com/'
    })
  })

  it('blocks executable and non-file schemes', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'intent://scan#Intent;scheme=zxing;end',
      'content://com.example/secret'
    ]) {
      expect(decideReaderNavigation(url, entryUrl).action).toBe('block')
    }
  })

  it('blocks malformed urls', () => {
    expect(decideReaderNavigation('not a url', entryUrl).action).toBe('block')
  })
})
