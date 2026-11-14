// 原生笔迹的宿主侧模型：原生只上报「页内 scale-one 坐标」的点序列，
// 这里用既有画库把一笔组合成 schema3 EditorDocument，并反向导出原生渲染
// 需要的折线。历史、去重与撤销仍归 annotationController，不在这里重建。

import {
  IDENTITY_TRANSFORM,
  readLayeredDocument,
  type AcceptedSample,
  type EditorDocument,
  type FreehandObject
} from '@hamster-note/painting/core'
import type { PdfPoint, PdfStroke } from './contracts'

/** 笔迹默认样式：原生暂时没有取色入口，先固定成与默认高亮区分明显的红色。 */
export const NATIVE_STROKE_COLOR = '#e5484d'
export const NATIVE_STROKE_WIDTH = 3

/** 一个点画不出线；单点手势一律丢弃。 */
export const NATIVE_STROKE_MIN_POINTS = 2

export function paintingPageId(pageNumber: number): string {
  return `page-${pageNumber}`
}

export function paintingPageNumber(pageId: string): number | undefined {
  const n = Number(pageId.replace(/^page-/, ''))
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** 过滤非法/重复点；相邻重复点不进入样本，避免文档无意义膨胀。 */
export function normalizedStrokePoints(
  points: readonly PdfPoint[]
): PdfPoint[] {
  const out: PdfPoint[] = []
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.x - point.x) < 0.01 &&
      Math.abs(last.y - point.y) < 0.01
    )
      continue
    out.push({ x: point.x, y: point.y })
  }
  return out
}

function samplePhase(index: number, count: number): AcceptedSample['phase'] {
  if (index === 0) return 'down'
  return index === count - 1 ? 'up' : 'move'
}

function samplesFor(
  points: readonly PdfPoint[],
  time: number
): AcceptedSample[] {
  return points.map((point, index) => ({
    sequence: index,
    x: point.x,
    y: point.y,
    time: time + index,
    phase: samplePhase(index, points.length),
    source: 'native'
  }))
}

/**
 * 在一页的既有文档后追加一笔，交画库 reader 校验并返回冻结文档。
 * 校验失败返回 null，调用方不得写入存储。
 */
export function appendStrokeDocument(
  previous: EditorDocument | undefined,
  commitId: string,
  points: readonly PdfPoint[],
  options: { color?: string; width?: number; time?: number } = {}
): EditorDocument | null {
  const normalized = normalizedStrokePoints(points)
  if (normalized.length < NATIVE_STROKE_MIN_POINTS) return null
  const time = options.time ?? Date.now()
  const stroke: FreehandObject = {
    kind: 'freehand',
    objectId: commitId,
    objectRevision: 1,
    transform: IDENTITY_TRANSFORM,
    transformRevision: 0,
    commitId,
    samples: samplesFor(normalized, time),
    brushSnapshot: {
      color: options.color ?? NATIVE_STROKE_COLOR,
      nominalSize: options.width ?? NATIVE_STROKE_WIDTH,
      opacity: 1,
      pressureMode: 'auto',
      presetRevision: 0
    },
    resolvedPressureMode: 'simulated',
    samplesRevision: 1,
    brushRevision: 1
  }
  const read = readLayeredDocument({
    schemaVersion: 3,
    documentRevision: (previous?.documentRevision ?? 0) + 1,
    objects: [...(previous?.objects ?? []), stroke]
  })
  return read.ok ? read.value : null
}

function transformed(point: PdfPoint, object: FreehandObject): PdfPoint {
  const t = object.transform
  return {
    x: t.a * point.x + t.c * point.y + t.tx,
    y: t.b * point.x + t.d * point.y + t.ty
  }
}

/**
 * 文档 → 原生折线。输出采样自持久化样本本身，坐标仍是页内 scale-one，
 * 与缩放无关：原生只在 `content` 容器里按页面 frame 平移。
 */
export function strokesForNative(
  paintings: Readonly<Record<string, EditorDocument>> | undefined
): PdfStroke[] {
  const strokes: PdfStroke[] = []
  for (const [pageId, document] of Object.entries(paintings ?? {})) {
    const pageNumber = paintingPageNumber(pageId)
    if (pageNumber === undefined) continue
    for (const object of document.objects) {
      if (object.kind !== 'freehand') continue
      const points = normalizedStrokePoints(
        object.samples.map((sample) => transformed(sample, object))
      )
      if (points.length < NATIVE_STROKE_MIN_POINTS) continue
      strokes.push({
        pageNumber,
        points,
        color: object.brushSnapshot.color,
        width: object.brushSnapshot.nominalSize
      })
    }
  }
  return strokes
}
