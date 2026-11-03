import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'

// Original content with the reported book's two-item EPUB2/NCX structure.
// Code blocks and source newlines precede the selected text, so one mapping
// mismatch anywhere would disable selection throughout this large chapter.
export async function largeSectionFixture() {
  const zip = new JSZip()
  const file = (name, text) =>
    zip.file(name, text, { date: new Date('2020-01-01T00:00:00Z') })
  file('mimetype', 'application/epub+zip')
  file(
    'META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  file(
    'book.opf',
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">large-code-section</dc:identifier><dc:title>Large code section</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="cover" href="cover_page.xhtml" media-type="application/xhtml+xml"/><item id="body" href="part0000.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.svg" media-type="image/svg+xml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="cover"/><itemref idref="body"/></spine></package>'
  )
  file(
    'toc.ncx',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Large code section</text></docTitle><navMap><navPoint id="chapter" playOrder="1"><navLabel><text>第 1 章</text></navLabel><content src="part0000.xhtml#nav_point_4"/></navPoint></navMap></ncx>'
  )
  file(
    'image.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="gray"/></svg>'
  )
  file(
    'cover_page.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><img src="image.svg" alt="cover"/></body></html>'
  )
  const blocks = [
    '<pre>\n<code>$ install tools</code>\n</pre>',
    '<h1 id="nav_point_4">第 1 章　计算机系统的概要</h1>',
    '<p>　　这个原创段落讨论 OS 与设备。后面的 OS 只是重复文本，用于验证按位置保存。</p>',
    '<p>　　第二个段落包含足够的文字，用来验证跨节点选择和端点调整。</p>'
  ]
  for (let i = 0; i < 1796; i++) {
    blocks.push(
      `<p data-row="${i}"> ${i}：${'这是用于大章节回归的原创重复内容。'.repeat(4)}</p>`
    )
    if (i < 209) blocks.push('<img src="image.svg" alt=""/>')
    if (i % 20 === 0)
      blocks.push('<pre>\n<code>line one\n  line two</code>\n</pre>')
  }
  file(
    'part0000.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Body</title></head><body>\n${blocks.join('\n')}\n</body></html>`
  )
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

if (process.argv[1] === import.meta.filename)
  await writeFile(
    new URL(
      '../test/compat/fixtures/epub/large-code-section.epub',
      import.meta.url
    ),
    await largeSectionFixture()
  )
