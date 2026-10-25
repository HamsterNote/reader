// @vitest-environment node
//
// HAM-89 / tasks.md 3.3：viewport 坐标适配——px/percent 存储矩形经统一
// viewport 变换在旋转、缩放后保持对齐；正逆向投影互逆。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDocument } from 'pdfjs-dist'
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist'
import { afterEach, describe, expect, it } from 'vitest'

import {
  captureViewportRectAsStored,
  edgeCropToClipPath,
  projectStoredRectToViewport
} from '../../src/pdf/pdfOverlayGeometry'
import type { StoredOverlayRect } from '../../src/pdf/pdfOverlayGeometry'

const FIXTURE_ROOT = join(__dirname, '../compat/fixtures')

async function openFixture(relativePath: string): Promise<PDFDocumentProxy> {
  const bytes = readFileSync(join(FIXTURE_ROOT, relativePath))
  return getDocument({
    data: new Uint8Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    ),
    isEvalSupported: false
  }).promise
}

const documents: PDFDocumentProxy[] = []
afterEach(async () => {
  await Promise.all(documents.splice(0).map((document) => document.destroy()))
})

async function getViewports(
  fixture: string,
  pageNumber: number,
  scale: number
): Promise<{ viewport: PageViewport; scaleOneViewport: PageViewport }> {
  const document = await openFixture(fixture)
  documents.push(document)
  const page = await document.getPage(pageNumber)
  return {
    viewport: page.getViewport({ scale }),
    scaleOneViewport: page.getViewport({ scale: 1 })
  }
}

const expectRectClose = (
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.width).toBeCloseTo(expected.width, 6)
  expect(actual.height).toBeCloseTo(expected.height, 6)
}

describe('projectStoredRectToViewport / captureViewportRectAsStored', () => {
  it('px 矩形在 scale=1 无旋转页上恒等投影', async () => {
    const { viewport, scaleOneViewport } = await getViewports(
      'pdf/two-column.pdf',
      1,
      1
    )
    const visual = { width: 400, height: 300 }
    const stored: StoredOverlayRect = {
      x: 20,
      y: 32.9,
      width: 97.8,
      height: 12
    }

    const projected = projectStoredRectToViewport(
      stored,
      'px',
      scaleOneViewport,
      viewport,
      visual
    )
    expect(projected.left).toBeCloseTo(20, 6)
    expectRectClose(
      {
        x: projected.left,
        y: projected.top,
        width: projected.width,
        height: projected.height
      },
      stored
    )
  })

  it('px 矩形在 scale=2 下显示尺寸翻倍（缩放对齐）', async () => {
    const { viewport, scaleOneViewport } = await getViewports(
      'pdf/two-column.pdf',
      1,
      2
    )
    const visual = { width: 400, height: 300 }
    const stored: StoredOverlayRect = {
      x: 20,
      y: 32.9,
      width: 97.8,
      height: 12
    }

    const projected = projectStoredRectToViewport(
      stored,
      'px',
      scaleOneViewport,
      viewport,
      visual
    )
    expectRectClose(
      {
        x: projected.left,
        y: projected.top,
        width: projected.width,
        height: projected.height
      },
      { x: 40, y: 65.8, width: 195.6, height: 24 }
    )

    expect(projected.width).toBeCloseTo(195.6, 6)
    // 逆向：显示矩形回收为存储矩形后与原始值一致（持久化坐标不随缩放漂移）。
    const captured = captureViewportRectAsStored(
      projected,
      viewport,
      scaleOneViewport,
      'px',
      visual
    )
    expectRectClose(captured, stored)
  })

  it('percent 矩形按可视页宽高归一，缩放后仍对齐同一区域', async () => {
    const { viewport, scaleOneViewport } = await getViewports(
      'pdf/two-column.pdf',
      1,
      1.5
    )
    const visual = { width: 400, height: 300 }
    // 契约样本：pdf-range-cross-page page-1 percent 矩形。
    const stored: StoredOverlayRect = { x: 55, y: 20, width: 35, height: 5 }

    const projected = projectStoredRectToViewport(
      stored,
      'percent',
      scaleOneViewport,
      viewport,
      visual
    )
    // 55%*400*1.5 = 330, 20%*300*1.5 = 90, 35%*400*1.5 = 210, 5%*300*1.5 = 22.5
    expect(projected.left).toBeCloseTo(330, 6)
    expectRectClose(
      {
        x: projected.left,
        y: projected.top,
        width: projected.width,
        height: projected.height
      },
      { x: 330, y: 90, width: 210, height: 22.5 }
    )

    const captured = captureViewportRectAsStored(
      projected,
      viewport,
      scaleOneViewport,
      'percent',
      visual
    )
    expectRectClose(captured, stored)
  })

  it('旋转 90° 页：存储坐标基于可视页（300x400），缩放旋转后对齐', async () => {
    const { viewport, scaleOneViewport } = await getViewports(
      'pdf/rotated.pdf',
      1,
      2
    )
    const visual = { width: 300, height: 400 }
    const stored: StoredOverlayRect = { x: 30, y: 40, width: 100, height: 20 }

    const projected = projectStoredRectToViewport(
      stored,
      'px',
      scaleOneViewport,
      viewport,
      visual
    )
    // scale-1 可视页内坐标 → scale 2 下位置与尺寸均翻倍。
    expect(projected.width).toBeCloseTo(200, 6)
    expectRectClose(
      {
        x: projected.left,
        y: projected.top,
        width: projected.width,
        height: projected.height
      },
      { x: 60, y: 80, width: 200, height: 40 }
    )

    const captured = captureViewportRectAsStored(
      projected,
      viewport,
      scaleOneViewport,
      'px',
      visual
    )
    expectRectClose(captured, stored)
  })

  it('percent 与 px 单位在同一几何下互不串扰（单位不归一化，矩阵契约）', async () => {
    const { viewport, scaleOneViewport } = await getViewports(
      'pdf/two-column.pdf',
      1,
      1
    )
    const visual = { width: 400, height: 300 }
    // 数值相同的 px 与 percent 矩形映射到不同显示区域。
    const sameNumbers = { x: 20, y: 10, width: 30, height: 10 }
    const asPx = projectStoredRectToViewport(
      sameNumbers,
      'px',
      scaleOneViewport,
      viewport,
      visual
    )
    const asPercent = projectStoredRectToViewport(
      sameNumbers,
      'percent',
      scaleOneViewport,
      viewport,
      visual
    )
    expect(asPx.width).toBeCloseTo(30, 6)
    expect(asPercent.width).toBeCloseTo(120, 6)
  })
})

describe('edgeCropToClipPath', () => {
  it('0..1 分数转 inset 百分比；空裁切返回 undefined', () => {
    expect(edgeCropToClipPath(undefined)).toBeUndefined()
    expect(edgeCropToClipPath({})).toBeUndefined()
    expect(
      edgeCropToClipPath({ top: 0.1, right: 0.05, bottom: 0.2, left: 0 })
    ).toBe('inset(10% 5% 20% 0%)')
  })
})
