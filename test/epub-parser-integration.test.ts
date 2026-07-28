import { EpubParser } from '@hamster-note/epub-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { convertEpubDocumentForReader } from '../demo/App'
import {
  getPageContentEntries,
  getRuntimeDocument,
  isIntermediateText
} from '../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'

async function makeMinimalEpubBytes(): Promise<Uint8Array> {
  const zip = new JSZip()

  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
  )
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:hamster-reader-epub-test</dc:identifier>
    <dc:title>Generated EPUB Fixture</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="chapter-1" />
    <itemref idref="chapter-2" />
  </spine>
</package>`
  )
  zip.file(
    'OPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
        <li><a href="chapter1.xhtml">Chapter 1</a></li>
        <li><a href="chapter2.xhtml">Chapter 2</a></li>
      </ol>
    </nav>
  </body>
</html>`
  )
  zip.file(
    'OPS/chapter1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body><h1>Chapter 1</h1><p>Hello EPUB text mode</p></body>
</html>`
  )
  zip.file(
    'OPS/chapter2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 2</title></head>
  <body><h1>Chapter 2</h1><p>Second chapter text</p></body>
</html>`
  )

  return zip.generateAsync({ type: 'uint8array' })
}

describe('epub parser integration', () => {
  it('parses a generated two-chapter EPUB for Reader text render mode', async () => {
    const epubBytes = await makeMinimalEpubBytes()

    const epubDocument = await EpubParser.encode(epubBytes)
    const document = await convertEpubDocumentForReader(epubDocument)
    const runtimeDocument = getRuntimeDocument(document)

    expect(runtimeDocument).not.toBeNull()
    if (!runtimeDocument) throw new Error('Expected runtime document')

    expect(runtimeDocument.pageCount).toBe(2)
    expect(runtimeDocument.id).not.toBe('txt-parser-document')

    const page1Promise = runtimeDocument.getPageByPageNumber(1)
    const page2Promise = runtimeDocument.getPageByPageNumber(2)
    if (!page1Promise || !page2Promise) {
      throw new Error('Expected both EPUB spine pages to exist')
    }

    const page1 = await page1Promise
    const page1Entries = await getPageContentEntries(page1)
    const page2Entries = await getPageContentEntries(await page2Promise)
    const page1Text = page1Entries
      .filter(isIntermediateText)
      .map((text) => text.content)
      .join(' ')
    const page2Text = page2Entries
      .filter(isIntermediateText)
      .map((text) => text.content)
      .join(' ')

    expect(page1Text).toContain('Hello EPUB text mode')
    expect(page2Text).toContain('Second chapter text')
    expect(page1).toHaveProperty('useFlowLayout', true)
  })
})
