import { EpubParser } from '@hamster-note/epub-parser'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { convertEpubDocumentForReader } from '../demo/epubForReader'
import { getEpubImageMetadata } from '../demo/epubImageMetadata'
import {
  getPageContentEntries,
  getRuntimeDocument,
  isIntermediateImage,
  isIntermediateText
} from '../src/components/IntermediateDocumentViewer/IntermediateDocumentViewer'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function makeMinimalEpubBytes(
  coverInSpine = true,
  chapterImageSource = 'images/chapter.png',
  reuseCoverInLastChapter = false
): Promise<Uint8Array> {
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
    ${coverInSpine ? '<itemref idref="cover" />' : ''}
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
  <body><img src="images/cover.png" alt="${coverInSpine ? 'Book cover' : ''}" /></body>
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
    <img src="${chapterImageSource}" alt="Chapter illustration" />
    <img src="${chapterImageSource}" alt="Duplicate chapter illustration" />
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
    ${reuseCoverInLastChapter ? '<img src="images/cover.png" alt="Reused cover artwork" />' : ''}
  </body>
</html>`
  )
  zip.file('OPS/images/cover.png', TINY_PNG_BASE64, { base64: true })
  zip.file('OPS/images/chapter.png', TINY_PNG_BASE64, { base64: true })
  zip.file('OPS/images/nav.png', TINY_PNG_BASE64, { base64: true })

  return zip.generateAsync({ type: 'uint8array' })
}

describe('epub parser integration', () => {
  it('maps image alt text only from renderable spine content', async () => {
    // Given: spine 错误包含 nav，正文还在本地图之前包含外链图片。
    const epubBytes = await makeMinimalEpubBytes(
      true,
      './images/chapter%2Epng?display=inline#artwork'
    )

    // When: Reader 从 EPUB 包中提取图片元数据。
    const metadata = await getEpubImageMetadata(
      epubBytes,
      'OPS/images/cover.png'
    )

    // Then: nav 与外链图不占用正文图片索引，封面只按首个可渲染页面判断。
    expect(metadata).toMatchObject({
      altsByPage: [['Book cover'], ['Chapter illustration'], []],
      coverAlt: 'Book cover',
      coverInSpine: true
    })
  })

  it('parses a generated two-chapter EPUB for Reader text render mode', async () => {
    // Given: 封面已经作为 EPUB spine 的第一页由解析器输出。
    const epubBytes = await makeMinimalEpubBytes()

    const epubDocument = await EpubParser.encode(epubBytes)
    expect(
      Reflect.get(epubDocument.getIntermediateDocument(), 'epubCover')
    ).toMatchObject({ href: 'OPS/images/cover.png' })
    // When: 解析结果进入 Reader 转换层。
    const document = await convertEpubDocumentForReader(epubDocument, epubBytes)
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
    const coverImages = [coverEntries, page1Entries, page2Entries]
      .flat()
      .filter(isIntermediateImage)
      .filter((image) => Reflect.get(image, 'alt') === 'Book cover')
    const chapterImages = page1Entries.filter(isIntermediateImage)

    expect(coverImages).toHaveLength(1)
    expect(coverImages[0]?.src).toMatch(/^data:image\/png;base64,/)
    expect(chapterImages).toHaveLength(1)
    expect(chapterImages[0]?.src).toMatch(/^data:image\/png;base64,/)
    expect(Reflect.get(chapterImages[0] ?? {}, 'alt')).toBe(
      'Chapter illustration'
    )
    expect(page1Text).toContain('Hello EPUB text mode')
    expect(page2Text).toContain('Second chapter text')
    expect(coverPage).toHaveProperty('useFlowLayout', true)
    expect(page1).toHaveProperty('useFlowLayout', true)
  })

  it('adds a manifest cover when the EPUB spine omits its cover page', async () => {
    // Given: EPUB 在 manifest 中声明封面图片，但 spine 只包含两个正文页。
    const epubBytes = await makeMinimalEpubBytes(false, undefined, true)
    const epubDocument = await EpubParser.encode(epubBytes)

    // When: 解析结果进入 Reader 转换层。
    const document = await convertEpubDocumentForReader(epubDocument, epubBytes)
    const runtimeDocument = getRuntimeDocument(document)

    // Then: 转换层补充独立封面页，同时保留解析器输出的正文顺序。
    expect(runtimeDocument).not.toBeNull()
    if (!runtimeDocument) throw new Error('Expected runtime document')
    expect(runtimeDocument.pageCount).toBe(3)

    const coverPagePromise = runtimeDocument.getPageByPageNumber(1)
    const chapterPagePromise = runtimeDocument.getPageByPageNumber(2)
    if (!coverPagePromise || !chapterPagePromise) {
      throw new Error('Expected the manifest cover and first chapter page')
    }

    const coverPage = await coverPagePromise
    const coverEntries = await getPageContentEntries(coverPage)
    const chapterEntries = await getPageContentEntries(await chapterPagePromise)

    const coverImages = coverEntries.filter(isIntermediateImage)
    expect(coverImages).toHaveLength(1)
    expect(Reflect.get(coverImages[0] ?? {}, 'alt')).toBe(
      'Generated EPUB Fixture'
    )
    expect(coverPage).toHaveProperty('useFlowLayout', true)
    expect(
      chapterEntries
        .filter(isIntermediateText)
        .map((text) => text.content)
        .join(' ')
    ).toContain('Hello EPUB text mode')
  })
})
