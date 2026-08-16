import { EpubParser } from '@hamster-note/epub-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { convertEpubDocumentForReader } from '../demo/epubForReader'
import {
  getPageContentEntries,
  getRuntimeDocument,
  isIntermediateImage,
  isIntermediateText
} from '../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml" />
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image" />
    <item id="chapter-image" href="images/chapter.png" media-type="image/png" />
    <item id="nav-image" href="images/nav.png" media-type="image/png" />
  </manifest>
  <spine>
    <itemref idref="nav" />
    <itemref idref="cover" />
    <itemref idref="chapter-1" />
    <itemref idref="chapter-2" />
  </spine>
</package>`
  )
  zip.file(
    'OPS/cover.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Cover</title></head>
  <body><img src="images/cover.png" alt="Book cover" /></body>
</html>`
  )
  zip.file(
    'OPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <img src="images/nav.png" alt="Navigation decoration" />
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
  <body>
    <h1>Chapter 1</h1>
    <p>Hello EPUB text mode</p>
    <img src="https://example.com/external.png" alt="External decoration" />
    <img src="images/chapter.png" alt="Chapter illustration" />
    <img src="images/chapter.png" alt="Duplicate chapter illustration" />
    <p>Text after chapter illustration</p>
  </body>
</html>`
  )
  zip.file(
    'OPS/chapter2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 2</title></head>
  <body>
    <h1>Chapter 2</h1><p>Second chapter text</p>
  </body>
</html>`
  )
  zip.file('OPS/images/cover.png', TINY_PNG_BASE64, { base64: true })
  zip.file('OPS/images/chapter.png', TINY_PNG_BASE64, { base64: true })
  zip.file('OPS/images/nav.png', TINY_PNG_BASE64, { base64: true })

  return zip.generateAsync({ type: 'uint8array' })
}

describe('epub parser integration', () => {
  it('parses a generated two-chapter EPUB for Reader text render mode', async () => {
    // Given: 封面已经作为 EPUB spine 的第一页由解析器输出。
    const epubBytes = await makeMinimalEpubBytes()

    const epubDocument = await new EpubParser().encode(epubBytes)
    expect(Reflect.get(epubDocument, 'epubCover')).toMatchObject({
      href: 'OPS/images/cover.png'
    })
    // When: 解析结果进入 Reader 转换层。
    const document = await convertEpubDocumentForReader(epubDocument)
    const runtimeDocument = getRuntimeDocument(document)

    expect(runtimeDocument).not.toBeNull()
    if (!runtimeDocument) throw new Error('Expected runtime document')

    // Then: 转换层保留原始三页，且不会再追加独立封面页。
    expect(runtimeDocument.pageCount).toBe(3)
    expect(runtimeDocument.id).not.toBe('txt-parser-document')

    const coverPagePromise = runtimeDocument.getPageByPageNumber(1)
    const page1Promise = runtimeDocument.getPageByPageNumber(2)
    const page2Promise = runtimeDocument.getPageByPageNumber(3)
    if (!coverPagePromise || !page1Promise || !page2Promise) {
      throw new Error('Expected the EPUB cover and both spine pages to exist')
    }

    const coverPage = await coverPagePromise
    const coverEntries = await getPageContentEntries(coverPage)
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
    const coverImages = coverEntries.filter(isIntermediateImage)
    const chapterImages = page1Entries.filter(isIntermediateImage)

    expect(coverImages).toHaveLength(1)
    expect(coverImages[0]?.src).toMatch(/^data:image\/png;base64,/)
    expect(chapterImages).toHaveLength(2)
    expect(chapterImages.every((image) => /^data:image\/png;base64,/.test(image.src))).toBe(true)
    const chapterImageIndexes = chapterImages.map((image) => page1Entries.indexOf(image))
    const trailingTextIndex = page1Entries.findIndex(
      (entry) =>
        isIntermediateText(entry) &&
        entry.content === 'Text after chapter illustration'
    )
    expect(chapterImageIndexes.every((imageIndex) => imageIndex > -1)).toBe(true)
    expect(chapterImageIndexes.every((imageIndex) => trailingTextIndex > imageIndex)).toBe(true)
    expect(page1Text).toContain('Hello EPUB text mode')
    expect(page2Text).toContain('Second chapter text')
    expect(coverPage).toHaveProperty('useFlowLayout', true)
    expect(page1).toHaveProperty('useFlowLayout', true)
  })

})
