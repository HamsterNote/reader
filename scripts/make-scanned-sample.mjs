// HAM-278 S12：生成「扫描版」PDF 样本（纯图片、无文字层）+ 对应的 OCR 文字种子。
//
// 用途：S12 专项需要一份必须靠 OCR 才能取到文字的 PDF，用来验证
// 「OCR/canonical 文字先于 web-ready 到达并缓存重放」以及 WKWebView
// activate/materialize 链路。由本脚本生成的 PDF 每页只有一张 JPEG，
// 没有任何 /Font 或文本对象，因此 pdfjs 的文字提取必然为空。
//
// 用法：
//   node scripts/make-scanned-sample.mjs
//   产物：test/fixtures/ham278-scanned-sample.pdf
//         test/fixtures/ham278-scanned-sample.ocr.json
//
// 依赖：仓库已安装的 playwright（Chromium 只用来把文字画到画布）。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'test/fixtures')
const PDF_PATH = join(fixtureDir, 'ham278-scanned-sample.pdf')
const SEED_PATH = join(fixtureDir, 'ham278-scanned-sample.ocr.json')

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const SCALE = 2

const PAGES = [
  [
    { text: 'HAM-278 SCANNED SAMPLE', x: 60, y: 110, size: 28 },
    {
      text: 'Page 1 of 2 - image only, no text layer',
      x: 60,
      y: 165,
      size: 16
    },
    {
      text: 'The quick brown fox jumps over the lazy dog.',
      x: 60,
      y: 260,
      size: 20
    },
    {
      text: 'Native PDFKit renders this page as a bitmap.',
      x: 60,
      y: 310,
      size: 20
    },
    {
      text: 'OCR text must be replayed before web-ready.',
      x: 60,
      y: 360,
      size: 20
    },
    {
      text: 'Selection anchor AAAA starts on this page.',
      x: 60,
      y: 430,
      size: 20
    },
    {
      text: 'canonical boundary keeps the mapping stable.',
      x: 60,
      y: 480,
      size: 20
    }
  ],
  [
    { text: 'HAM-278 SCANNED SAMPLE', x: 60, y: 110, size: 28 },
    {
      text: 'Page 2 of 2 - image only, no text layer',
      x: 60,
      y: 165,
      size: 16
    },
    {
      text: 'Second page carries the other side of the range.',
      x: 60,
      y: 260,
      size: 20
    },
    {
      text: 'Selection anchor ZZZZ ends on this page.',
      x: 60,
      y: 310,
      size: 20
    },
    {
      text: 'activate and materialize must both appear.',
      x: 60,
      y: 360,
      size: 20
    },
    {
      text: 'Cold far page activation reuses OCR cache.',
      x: 60,
      y: 430,
      size: 20
    }
  ]
]

/** 与画布绘制共用同一套布局，保证种子文字框和图片内容对齐。 */
async function renderPages() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(
      '<!doctype html><html><body style="margin:0;background:#fff"></body></html>'
    )
    return await page.evaluate(
      ({ pages, width, height, scale }) =>
        pages.map((lines) => {
          const canvas = document.createElement('canvas')
          canvas.width = width * scale
          canvas.height = height * scale
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.fillStyle = '#111111'
          ctx.textBaseline = 'alphabetic'
          const boxes = []
          for (const line of lines) {
            const px = line.size * scale
            ctx.font = `${px}px "Times New Roman", serif`
            ctx.fillText(line.text, line.x * scale, line.y * scale)
            const width_ = ctx.measureText(line.text).width
            boxes.push({
              text: line.text,
              // 归一化到页面尺寸，供 nativeCanonicalPageFromOcr 使用。
              x0: line.x / width,
              x1: (line.x * scale + width_) / scale / width,
              y0: (line.y - line.size * 0.8) / height,
              y1: (line.y + line.size * 0.2) / height,
              fontSize: line.size
            })
          }
          return { jpeg: canvas.toDataURL('image/jpeg', 0.92), boxes }
        }),
      { pages: PAGES, width: PAGE_WIDTH, height: PAGE_HEIGHT, scale: SCALE }
    )
  } finally {
    await browser.close()
  }
}

/** 最小 PDF 写出器：每页一张 DCTDecode 图片，无字体/文本对象。 */
let current = Buffer.from('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n', 'latin1')
let offsets = []

function appendObject(id, body, stream) {
  offsets[id - 1] = current.length
  const head = Buffer.from(`${id} 0 obj\n${body}\n`, 'latin1')
  if (stream) {
    current = Buffer.concat([
      current,
      head,
      Buffer.from('stream\n', 'latin1'),
      stream,
      Buffer.from('\nendstream\nendobj\n', 'latin1')
    ])
  } else {
    current = Buffer.concat([current, head, Buffer.from('endobj\n', 'latin1')])
  }
}

function assemblePdf(images) {
  const total = 2 + images.length * 3
  offsets = new Array(total)
  const pageIds = []
  const imageIds = []
  const contentIds = []
  let nextId = 3
  for (let index = 0; index < images.length; index += 1) {
    imageIds.push(nextId++)
    contentIds.push(nextId++)
    pageIds.push(nextId++)
  }
  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
  appendObject(
    2,
    `<< /Type /Pages /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] /Count ${pageIds.length} >>`
  )
  images.forEach((image, index) => {
    const jpeg = Buffer.from(image.jpeg.split(',')[1], 'base64')
    appendObject(
      imageIds[index],
      `<< /Type /XObject /Subtype /Image /Width ${image.width} ` +
        `/Height ${image.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg
    )
    const content = `q ${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm /Im0 Do Q\n`
    appendObject(
      contentIds[index],
      `<< /Length ${Buffer.byteLength(content)} >>`,
      Buffer.from(content, 'latin1')
    )
    appendObject(
      pageIds[index],
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /XObject << /Im0 ${imageIds[index]} 0 R >> >> ` +
        `/Contents ${contentIds[index]} 0 R >>`
    )
  })
  const xrefOffset = current.length
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  const trailer =
    `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.concat([current, Buffer.from(xref + trailer, 'latin1')])
}

const rendered = await renderPages()
const images = rendered.map((page) => ({
  ...page,
  width: PAGE_WIDTH * SCALE,
  height: PAGE_HEIGHT * SCALE
}))
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(PDF_PATH, assemblePdf(images))

const seed = {
  version: 1,
  source: 'scripts/make-scanned-sample.mjs',
  pageWidth: PAGE_WIDTH,
  pageHeight: PAGE_HEIGHT,
  pages: Object.fromEntries(
    rendered.map((page, index) => [
      String(index + 1),
      page.boxes.map((box, boxIndex) => ({
        id: `scanned-p${index + 1}-l${boxIndex + 1}`,
        content: box.text,
        fontSize: box.fontSize,
        fontFamily: 'Times New Roman',
        fontWeight: 400,
        italic: false,
        color: '#111111',
        polygon: [
          [box.x0, box.y0],
          [box.x1, box.y0],
          [box.x1, box.y1],
          [box.x0, box.y1]
        ],
        lineHeight: box.fontSize,
        ascent: box.fontSize * 0.8,
        descent: box.fontSize * 0.2,
        dir: 'ltr',
        skew: 0,
        isEOL: true
      }))
    ])
  ),
  // 预置一条跨页高亮：不依赖长按手势也能触发 activate/materialize 链路。
  ranges: [
    {
      id: 'scanned-range-p1-p2',
      createdAt: 0,
      text: 'HAM-278 SCANNED SAMPLE ... Second page carries the other side',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-2', offset: 24 },
      overlayRectType: 'px',
      markerStyle: { backgroundColor: '#ffc107', opacity: 0.5 },
      rectsBySelectionId: Object.fromEntries(
        rendered.map((page, index) => [
          `page-${index + 1}`,
          page.boxes.map((box) => ({
            x: box.x0 * PAGE_WIDTH,
            y: box.y0 * PAGE_HEIGHT,
            width: (box.x1 - box.x0) * PAGE_WIDTH,
            height: (box.y1 - box.y0) * PAGE_HEIGHT
          }))
        ])
      )
    }
  ]
}
writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`)

console.log(`wrote ${PDF_PATH}`)
console.log(`wrote ${SEED_PATH}`)
