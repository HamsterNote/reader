import { describe, expect, it } from 'vitest'

import { decideReaderNavigation } from '../src/host/navigationPolicy'

const entryUrl = 'file:///data/user/0/app/files/webreader/v1/index.html'
const baseDir = 'file:///data/user/0/app/files/webreader/v1/'
const chapter = 'blob:file:///04324363-812d-4996-a4d2-cb0f855d4e8c'

describe('decideReaderNavigation', () => {
  it('allows local chapter blobs only in subframes of the trusted entry', () => {
    const context = { isTopFrame: false, mainDocumentURL: entryUrl }
    for (const url of [
      chapter,
      chapter.replace('file:///', 'null/'),
      `${chapter}#part`
    ]) {
      expect(decideReaderNavigation(url, entryUrl, context).action).toBe(
        'allow'
      )
    }
    for (const url of [
      'blob:https://example.com/04324363-812d-4996-a4d2-cb0f855d4e8c',
      'blob:file:///other/path',
      'data:text/html,chapter',
      'https://example.com/chapter',
      'file:///private/another-book/chapter.html'
    ]) {
      expect(decideReaderNavigation(url, entryUrl, context).action).toBe(
        'block'
      )
    }
  })

  it('rejects top-level blobs and subframes without the exact trusted main document', () => {
    for (const context of [
      {},
      { isTopFrame: true, mainDocumentURL: entryUrl },
      { mainDocumentURL: entryUrl },
      { isTopFrame: false },
      { isTopFrame: false, mainDocumentURL: 'about:blank' },
      { isTopFrame: false, mainDocumentURL: `${baseDir}other.html` },
      { isTopFrame: false, mainDocumentURL: `${entryUrl}?other` },
      { isTopFrame: false, mainDocumentURL: chapter },
      { isTopFrame: false, mainDocumentURL: 'https://example.com/index.html' }
    ]) {
      expect(decideReaderNavigation(chapter, entryUrl, context).action).toBe(
        'block'
      )
    }
  })

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
