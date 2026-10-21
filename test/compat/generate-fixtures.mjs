// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.1。
// 确定性重建 test/compat/fixtures/ 下的全部兼容样本。
//
// 用法：node test/compat/generate-fixtures.mjs
//
// 样本覆盖矩阵见
// openspec/changes/migrate-reader-to-expo-webview/contracts/sample-manifest.md。
// 生成结果已提交进仓库；只有需要修改样本内容时才重跑本脚本并一并提交产物。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import JSZip from 'jszip'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

// 固定 zip / pdf 元数据时间戳，保证同一脚本重复运行产出逐字节一致。
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z')

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function writeFixture(relativePath, data) {
  const path = join(FIXTURE_ROOT, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, data)
  console.log(`wrote ${relativePath} (${data.byteLength ?? data.length} bytes)`)
}

// ---------------------------------------------------------------------------
// EPUB 样本
// ---------------------------------------------------------------------------

function epubContainerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
}

function epubPage(title, bodyHtml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${title}</title></head>
  <body>
${bodyHtml}
  </body>
</html>`
}

function epubNav(chapters) {
  const items = chapters
    .map(({ href, label }) => `        <li><a href="${href}">${label}</a></li>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>`
}

async function buildEpub({ title, manifestExtra = '', spineItems, files }) {
  const zip = new JSZip()
  const zipOptions = { date: FIXED_DATE }

  // JSZip 自动补的目录条目默认用当前时间；显式创建并固定日期保证可复现。
  zip.file('META-INF/', null, { ...zipOptions, dir: true })
  zip.file('OPS/', null, { ...zipOptions, dir: true })
  zip.file('OPS/images/', null, { ...zipOptions, dir: true })
  zip.file('mimetype', 'application/epub+zip', {
    ...zipOptions,
    compression: 'STORE'
  })
  zip.file('META-INF/container.xml', epubContainerXml(), zipOptions)

  const manifestItems =
    spineItems
      .map(({ id, href, properties }) => {
        const propertiesAttr = properties ? ` properties="${properties}"` : ''
        return `    <item id="${id}" href="${href}" media-type="application/xhtml+xml"${propertiesAttr} />`
        // EPUB 要求全部内容资源在 manifest 声明，否则解析器丢弃图片。
      })
      .join('\n') +
    '\n    <item id="img-cover" href="images/cover.png" media-type="image/png" />' +
    '\n    <item id="img-chapter" href="images/chapter.png" media-type="image/png" />'
  const spineRefs = spineItems
    .filter(({ inSpine = true }) => inSpine)
    .map(({ id }) => `    <itemref idref="${id}" />`)
    .join('\n')

  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:hamster-note:fixture:${title}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
${manifestItems}
${manifestExtra}
  </manifest>
  <spine>
${spineRefs}
  </spine>
</package>`,
    zipOptions
  )

  for (const [path, content] of Object.entries(files)) {
    zip.file(`OPS/${path}`, content, zipOptions)
  }
  // 图片固定为同一个 1x1 PNG；alt 与出现顺序才是样本关注的语义。
  for (const imagePath of ['images/cover.png', 'images/chapter.png']) {
    zip.file(`OPS/${imagePath}`, TINY_PNG_BASE64, {
      ...zipOptions,
      base64: true
    })
  }

  return zip.generateAsync({ type: 'uint8array' })
}

// 样本 E1：封面在 spine 首位，正文含外链图（应被忽略）、重复引用同一章插图，
// 末章复用封面图。覆盖：封面、图片顺序、重复图片引用。
async function buildEpubCoverAndImageOrder() {
  return buildEpub({
    title: 'Fixture Cover And Image Order',
    spineItems: [
      { id: 'cover', href: 'cover.xhtml' },
      { id: 'nav', href: 'nav.xhtml', inSpine: false, properties: 'nav' },
      { id: 'chapter1', href: 'chapter1.xhtml' },
      { id: 'chapter2', href: 'chapter2.xhtml' }
    ],
    files: {
      'cover.xhtml': epubPage(
        'Cover',
        '    <img src="images/cover.png" alt="Book cover" />'
      ),
      'nav.xhtml': epubNav([
        { href: 'chapter1.xhtml', label: 'Chapter 1' },
        { href: 'chapter2.xhtml', label: 'Chapter 2' }
      ]),
      'chapter1.xhtml': epubPage(
        'Chapter 1',
        `    <h1>Chapter 1</h1>
    <p>Hello EPUB text mode</p>
    <img src="https://example.com/external.png" alt="External decoration" />
    <img src="images/chapter.png" alt="Chapter illustration" />
    <img src="images/chapter.png" alt="Duplicate chapter illustration" />
    <p>Text after chapter illustration</p>`
      ),
      'chapter2.xhtml': epubPage(
        'Chapter 2',
        `    <h1>Chapter 2</h1>
    <p>Second chapter text</p>
    <img src="images/cover.png" alt="Reused cover artwork" />`
      )
    }
  })
}

// 样本 E2：manifest 声明封面但 spine 省略封面页，末章复用封面图。
// 覆盖：补封面规则（转换层在最前补独立封面页，正文顺序不变）。
async function buildEpubSpineOmitsCover() {
  return buildEpub({
    title: 'Fixture Spine Omits Cover',
    manifestExtra:
      '    <meta name="cover" content="cover-image" />\n' +
      '    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image" />',
    spineItems: [
      { id: 'nav', href: 'nav.xhtml', inSpine: false, properties: 'nav' },
      { id: 'chapter1', href: 'chapter1.xhtml' },
      { id: 'chapter2', href: 'chapter2.xhtml' }
    ],
    files: {
      'nav.xhtml': epubNav([
        { href: 'chapter1.xhtml', label: 'Chapter 1' },
        { href: 'chapter2.xhtml', label: 'Chapter 2' }
      ]),
      'chapter1.xhtml': epubPage(
        'Chapter 1',
        `    <h1>Chapter 1</h1>
    <p>Hello EPUB text mode</p>
    <img src="images/chapter.png" alt="Chapter illustration" />
    <p>Text after chapter illustration</p>`
      ),
      'chapter2.xhtml': epubPage(
        'Chapter 2',
        `    <h1>Chapter 2</h1>
    <p>Second chapter text</p>
    <img src="images/cover.png" alt="Reused cover artwork" />`
      )
    }
  })
}

// 样本 E3：三个章节，第 1、3 章包含逐字相同的段落「重复的段落文本。」，
// 上下文不同。覆盖：重复文本定位、跨页高亮的端点页。
async function buildEpubDuplicateText() {
  return buildEpub({
    title: 'Fixture Duplicate Text',
    spineItems: [
      { id: 'cover', href: 'cover.xhtml' },
      { id: 'nav', href: 'nav.xhtml', inSpine: false, properties: 'nav' },
      { id: 'chapter1', href: 'chapter1.xhtml' },
      { id: 'chapter2', href: 'chapter2.xhtml' },
      { id: 'chapter3', href: 'chapter3.xhtml' }
    ],
    files: {
      'cover.xhtml': epubPage(
        'Cover',
        '    <img src="images/cover.png" alt="Book cover" />'
      ),
      'nav.xhtml': epubNav([
        { href: 'chapter1.xhtml', label: 'Chapter 1' },
        { href: 'chapter2.xhtml', label: 'Chapter 2' },
        { href: 'chapter3.xhtml', label: 'Chapter 3' }
      ]),
      'chapter1.xhtml': epubPage(
        'Chapter 1',
        `    <h1>第一章</h1>
    <p>起始段落在第一章。</p>
    <p>重复的段落文本。</p>
    <p>第一章独有结尾。</p>`
      ),
      'chapter2.xhtml': epubPage(
        'Chapter 2',
        `    <h1>第二章</h1>
    <p>第二章开头完全不同。</p>
    <p>第二章结尾与第三章开头相连。</p>`
      ),
      'chapter3.xhtml': epubPage(
        'Chapter 3',
        `    <h1>第三章</h1>
    <p>重复的段落文本。</p>
    <p>第三章独有结尾。</p>`
      )
    }
  })
}

// ---------------------------------------------------------------------------
// PDF 样本（pdf-lib 生成 + 手工 Type0 连字样本）
// ---------------------------------------------------------------------------

// 样本 P1：两页。第 1 页左右双栏文本，第 2 页普通文本。
// 覆盖：多栏阅读顺序、跨页高亮端点。
async function buildPdfTwoColumn() {
  const doc = await PDFDocument.create()
  doc.setProducer('hamster-reader compat fixtures')
  doc.setCreator('test/compat/generate-fixtures.mjs')
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const page1 = doc.addPage([400, 300])
  // 左栏两行、右栏两行。文本提取顺序按绘制顺序（先左栏后右栏）。
  page1.drawText('Left column line one', { x: 20, y: 260, size: 10, font })
  page1.drawText('Left column line two', { x: 20, y: 240, size: 10, font })
  page1.drawText('Right column line one', { x: 220, y: 260, size: 10, font })
  page1.drawText('Right column line two', { x: 220, y: 240, size: 10, font })

  const page2 = doc.addPage([400, 300])
  page2.drawText('Second page continues the article', {
    x: 20,
    y: 260,
    size: 10,
    font
  })

  return doc.save()
}

// 样本 P2：单页 /Rotate 90，含一行文本。覆盖：旋转页的坐标与文本提取。
async function buildPdfRotated() {
  const doc = await PDFDocument.create()
  doc.setProducer('hamster-reader compat fixtures')
  doc.setCreator('test/compat/generate-fixtures.mjs')
  doc.setCreationDate(FIXED_DATE)
  doc.setModificationDate(FIXED_DATE)
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const page = doc.addPage([400, 300])
  page.setRotation(degrees(90))
  // 旋转 90° 后页面可视尺寸变为 300x400；在用户空间坐标绘制。
  page.drawText('Rotated page text', { x: 20, y: 260, size: 10, font })

  return doc.save()
}

// 样本 P3：手工 Type0 字体 + ToUnicode CMap，把单个字形码 0x0001 映射到
// U+FB01（fi 连字），0x0002 映射到 'x'。pdf.js 文本层按 ToUnicode 提取，
// NFKC 规范化后得到 "fi"。覆盖：连字提取与端点偏移。
function buildPdfLigature() {
  const objects = []
  const content = 'BT /F1 24 Tf 50 400 Td <0001> Tj 30 0 Td <0002> Tj ET'
  const toUnicode = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
2 beginbfchar
<0001> <FB01>
<0002> <0078>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`

  objects.push(
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /FixtureLigature /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureLigature /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /W [1 [500] 2 [500]] >>',
    `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
    '<< /Type /FontDescriptor /FontName /FixtureLigature /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>'
  )

  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefPos = out.length
  out += `xref\n0 ${objects.length + 1}\n`
  out += '0000000000 65535 f \n'
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
  return new TextEncoder().encode(out)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

const epubCover = await buildEpubCoverAndImageOrder()
writeFixture('epub/cover-and-image-order.epub', epubCover)

const epubNoCover = await buildEpubSpineOmitsCover()
writeFixture('epub/spine-omits-cover.epub', epubNoCover)

const epubDuplicate = await buildEpubDuplicateText()
writeFixture('epub/duplicate-text.epub', epubDuplicate)

const pdfTwoColumnBytes = await buildPdfTwoColumn()
writeFixture('pdf/two-column.pdf', pdfTwoColumnBytes)
writeFixture('pdf/rotated.pdf', await buildPdfRotated())
writeFixture('pdf/ligature.pdf', buildPdfLigature())

// ---------------------------------------------------------------------------
// 同文件 v2/v3/v4 高亮 JSON
// ---------------------------------------------------------------------------
//
// 端点 offset 直接由旧解析链路（epub-parser / pdf-parser）解析对应样本得到，
// 保证 JSON 与同文件二进制样本逐字一致：offset 是「页内全部文本项 content
// 无分隔符拼接」的字符偏移（契约见 contracts/sample-manifest.md）。
// v2 只有 ranges（历史格式不支持 rects/paintings）；v3 增加 rects；v4 增加
// paintings。三个版本表达同一组标注，验证旧读入器的向后兼容读取与 v4 回写。

async function getPageTextsEpub(bytes) {
  const { EpubParser } = await import('@hamster-note/epub-parser')
  const document = await EpubParser.encode(bytes)
  const intermediate = document.getIntermediateDocument()
  const texts = []
  for (let n = 1; n <= intermediate.pageCount; n += 1) {
    const page = await intermediate.getPageByPageNumber(n)
    const entries = page.getContentEntries
      ? await page.getContentEntries()
      : await page.getContent()
    texts.push(
      (entries ?? [])
        .filter((entry) => typeof entry.content === 'string')
        .map((entry) => entry.content)
        .join('')
    )
  }
  return texts
}

async function getPageTextsPdf(bytes) {
  const { PdfParser } = await import('@hamster-note/pdf-parser')
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
  const handle = await PdfParser.openDocument(buffer)
  try {
    const texts = []
    for (let n = 1; n <= handle.pageCount; n += 1) {
      const page = await handle.document.getPageByPageNumber(n)
      const entries = await page.getContent()
      texts.push(
        (entries ?? [])
          .filter((entry) => typeof entry.content === 'string')
          .map((entry) => entry.content)
          .join('')
      )
    }
    return texts
  } finally {
    await handle.dispose?.()
  }
}

function mustFind(pageTexts, pageNumber, needle) {
  const pageText = pageTexts[pageNumber - 1]
  const offset = pageText.indexOf(needle)
  if (offset === -1) {
    throw new Error(`fixture text not found on page-${pageNumber}: ${needle}`)
  }
  return offset
}

// 跨页 range：起点页取 needle 起点，终点页取 tail 的结尾。
// range.text = 起点页选中后缀 + 中间页全文 + 终点页选中前缀（无分隔符）。
function buildCrossPageRange({
  id,
  startPage,
  startNeedle,
  endPage,
  endNeedle,
  createdAt,
  overlayRectType,
  rectsBySelectionId,
  markerStyle,
  pageTexts
}) {
  const startOffset = mustFind(pageTexts, startPage, startNeedle)
  const endStart = mustFind(pageTexts, endPage, endNeedle)
  const endOffset = endStart + endNeedle.length
  const text = pageTexts[startPage - 1].slice(startOffset) + endNeedle
  return {
    id,
    text,
    start: { selectionId: `page-${startPage}`, offset: startOffset },
    end: { selectionId: `page-${endPage}`, offset: endOffset },
    createdAt,
    overlayRectType,
    rectsBySelectionId,
    ...(markerStyle ? { markerStyle } : {})
  }
}

function buildSinglePageRange({
  id,
  page,
  needle,
  occurrence = 0,
  createdAt,
  overlayRectType,
  rectsBySelectionId,
  selectionStyle
}) {
  return {
    id,
    needle,
    page,
    occurrence,
    createdAt,
    overlayRectType,
    rectsBySelectionId,
    selectionStyle
  }
}

function resolveSinglePageRange(spec, pageTexts) {
  const pageText = pageTexts[spec.page - 1]
  let offset = -1
  for (let i = 0; i <= spec.occurrence; i += 1) {
    offset = pageText.indexOf(spec.needle, offset + 1)
    if (offset === -1) {
      throw new Error(
        `occurrence ${spec.occurrence} of ${spec.needle} missing on page-${spec.page}`
      )
    }
  }
  return {
    id: spec.id,
    text: spec.needle,
    start: { selectionId: `page-${spec.page}`, offset },
    end: {
      selectionId: `page-${spec.page}`,
      offset: offset + spec.needle.length
    },
    createdAt: spec.createdAt,
    overlayRectType: spec.overlayRectType,
    rectsBySelectionId: spec.rectsBySelectionId,
    ...(spec.selectionStyle ? { selectionStyle: spec.selectionStyle } : {})
  }
}

function buildHighlightJsonVersions({ ranges, rects, paintings }) {
  const v2 = { version: 2, ranges }
  const v3 = { version: 3, ranges, rects }
  const v4 = { version: 4, ranges, rects, paintings }
  return { v2, v3, v4 }
}

function writeJsonFixture(relativePath, value) {
  writeFixture(relativePath, JSON.stringify(value, null, 2) + '\n')
}

// --- EPUB 高亮：绑定 epub/duplicate-text.epub（同文件 v2/v3/v4） ---
const epubPageTexts = await getPageTextsEpub(epubDuplicate)
const epubRanges = [
  buildCrossPageRange({
    id: 'epub-range-cross-page',
    startPage: 2,
    startNeedle: '第一章独有结尾。',
    endPage: 3,
    endNeedle: '第二章',
    createdAt: 1735689600000,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-2': [{ x: 12.5, y: 40.25, width: 70, height: 6.5 }],
      'page-3': [{ x: 8, y: 10, width: 30.5, height: 6.5 }]
    },
    markerStyle: { backgroundColor: 'rgba(255, 193, 7, 0.35)' },
    pageTexts: epubPageTexts
  }),
  resolveSinglePageRange(
    buildSinglePageRange({
      id: 'epub-range-duplicate-first',
      page: 2,
      needle: '重复的段落文本。',
      occurrence: 0,
      createdAt: 1735689601000,
      overlayRectType: 'px',
      rectsBySelectionId: {
        'page-2': [{ x: 24, y: 128, width: 112, height: 18 }]
      },
      selectionStyle: { backgroundColor: 'rgba(33, 150, 243, 0.25)' }
    }),
    epubPageTexts
  )
]
const epubRects = [
  {
    id: 'epub-rect-page-2-px',
    createdAt: 1735689602000,
    overlayRectType: 'px',
    start: { x: 24, y: 96 },
    end: { x: 180, y: 132 },
    rect: { x: 24, y: 96, width: 156, height: 36 },
    selectionId: 'page-2'
  },
  {
    id: 'epub-rect-page-3-percent',
    createdAt: 1735689603000,
    overlayRectType: 'percent',
    start: { x: 10.5, y: 20.25 },
    end: { x: 60, y: 40 },
    rect: { x: 10.5, y: 20.25, width: 49.5, height: 19.75 },
    selectionId: 'page-3',
    markerStyle: { border: '1px solid #2563eb' }
  }
]
const epubPaintings = {
  'page-3': {
    strokes: [
      {
        id: 'stroke-epub-1',
        tool: 'pen',
        points: [
          { x: 5, y: 5 },
          { x: 40, y: 60 },
          { x: 80, y: 20 }
        ],
        color: '#1d4ed8',
        width: 3
      }
    ]
  }
}
const epubJson = buildHighlightJsonVersions({
  ranges: epubRanges,
  rects: epubRects,
  paintings: epubPaintings
})
writeJsonFixture('highlights/epub-duplicate-text.v2.json', epubJson.v2)
writeJsonFixture('highlights/epub-duplicate-text.v3.json', epubJson.v3)
writeJsonFixture('highlights/epub-duplicate-text.v4.json', epubJson.v4)

// --- PDF 高亮：绑定 pdf/two-column.pdf（同文件 v2/v3/v4） ---
const pdfPageTexts = await getPageTextsPdf(pdfTwoColumnBytes)
const pdfRanges = [
  buildCrossPageRange({
    id: 'pdf-range-cross-page',
    startPage: 1,
    startNeedle: 'Right column line two',
    endPage: 2,
    endNeedle: 'Second page',
    createdAt: 1735689700000,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-1': [{ x: 55, y: 20, width: 35, height: 5 }],
      'page-2': [{ x: 5, y: 13.5, width: 22.75, height: 5 }]
    },
    markerStyle: { backgroundColor: 'rgba(255, 193, 7, 0.35)' },
    pageTexts: pdfPageTexts
  }),
  resolveSinglePageRange(
    buildSinglePageRange({
      id: 'pdf-range-left-column',
      page: 1,
      needle: 'Left column line one',
      occurrence: 0,
      createdAt: 1735689701000,
      overlayRectType: 'px',
      rectsBySelectionId: {
        'page-1': [{ x: 20, y: 32.9, width: 97.8, height: 12 }]
      }
    }),
    pdfPageTexts
  )
]
const pdfRects = [
  {
    id: 'pdf-rect-page-1-px',
    createdAt: 1735689702000,
    overlayRectType: 'px',
    start: { x: 220, y: 33 },
    end: { x: 340, y: 45 },
    rect: { x: 220, y: 33, width: 120, height: 12 },
    selectionId: 'page-1'
  },
  {
    id: 'pdf-rect-page-2-percent',
    createdAt: 1735689703000,
    overlayRectType: 'percent',
    start: { x: 5, y: 10 },
    end: { x: 45, y: 25 },
    rect: { x: 5, y: 10, width: 40, height: 15 },
    selectionId: 'page-2',
    selectionStyle: { backgroundColor: 'rgba(76, 175, 80, 0.25)' }
  }
]
const pdfPaintings = {
  'page-1': {
    strokes: [
      {
        id: 'stroke-pdf-1',
        tool: 'line',
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 90 }
        ],
        color: '#dc2626',
        width: 5
      }
    ]
  }
}
const pdfJson = buildHighlightJsonVersions({
  ranges: pdfRanges,
  rects: pdfRects,
  paintings: pdfPaintings
})
writeJsonFixture('highlights/pdf-two-column.v2.json', pdfJson.v2)
writeJsonFixture('highlights/pdf-two-column.v3.json', pdfJson.v3)
writeJsonFixture('highlights/pdf-two-column.v4.json', pdfJson.v4)

console.log('done')
