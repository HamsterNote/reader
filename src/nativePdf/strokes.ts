// 原生笔迹的宿主侧模型：原生只上报「页内 scale-one 坐标」的点序列，
// 这里用既有画库把一笔组合成 schema3 EditorDocument，并反向导出原生渲染
// 需要的折线。历史、去重与撤销仍归 annotationController，不在这里重建。

import {
  deriveShapeGeometry,
  IDENTITY_TRANSFORM,
  readLayeredDocument,
  type AcceptedSample,
  type EditorDocument,
  type FreehandObject
} from '@hamster-note/painting/core'
import type { PdfInkObject, PdfPoint } from './contracts'

/** 笔迹默认样式：原生暂时没有取色入口，先固定成与默认高亮区分明显的红色。 */
export const NATIVE_STROKE_COLOR = '#e5484d'
export const NATIVE_STROKE_WIDTH = 3

/** Native toolbar palette; every value is written into the same painting document. */
export const NATIVE_INK_COLORS = [
  '#e5484d',
  '#1f6feb',
  '#2ea043',
  '#1f2328'
] as const
export const NATIVE_INK_WIDTHS = [2, 4, 8] as const

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

function transformed(
  point: PdfPoint,
  transform: {
    a: number
    b: number
    c: number
    d: number
    tx: number
    ty: number
  }
): PdfPoint {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.tx,
    y: transform.b * point.x + transform.d * point.y + transform.ty
  }
}

function bezierPoint(
  from: PdfPoint,
  cp1: PdfPoint,
  cp2: PdfPoint,
  to: PdfPoint,
  t: number
): PdfPoint {
  const u = 1 - t
  return {
    x:
      u * u * u * from.x +
      3 * u * u * t * cp1.x +
      3 * u * t * t * cp2.x +
      t * t * t * to.x,
    y:
      u * u * u * from.y +
      3 * u * u * t * cp1.y +
      3 * u * t * t * cp2.y +
      t * t * t * to.y
  }
}

const ELLIPSE_SEGMENTS = 48
const BEZIER_SEGMENTS = 16

type SubPath = { points: PdfPoint[]; closed: boolean }

function ellipseSubPath(command: {
  cx: number
  cy: number
  rx: number
  ry: number
}): SubPath {
  const points: PdfPoint[] = [{ x: command.cx + command.rx, y: command.cy }]
  for (let step = 1; step < ELLIPSE_SEGMENTS; step += 1) {
    const angle = (Math.PI * 2 * step) / ELLIPSE_SEGMENTS
    points.push({
      x: command.cx + command.rx * Math.cos(angle),
      y: command.cy + command.ry * Math.sin(angle)
    })
  }
  return { points, closed: true }
}

function bezierPoints(
  from: PdfPoint,
  command: {
    cp1x: number
    cp1y: number
    cp2x: number
    cp2y: number
    x: number
    y: number
  }
): PdfPoint[] {
  return Array.from({ length: BEZIER_SEGMENTS }, (_, index) =>
    bezierPoint(
      from,
      { x: command.cp1x, y: command.cp1y },
      { x: command.cp2x, y: command.cp2y },
      { x: command.x, y: command.y },
      (index + 1) / BEZIER_SEGMENTS
    )
  )
}

/**
 * Schema3 shape → polylines, using the painting library's own command
 * derivation so line/rect/ellipse/bezier keep the Web semantics.
 */
export function shapeSubPaths(
  shape: Extract<EditorDocument['objects'][number], { kind: 'shape' }>
): SubPath[] {
  const derived = deriveShapeGeometry(shape)
  if (!derived) return []
  const paths: SubPath[] = []
  let current: SubPath | null = null
  let cursor: PdfPoint | null = null
  const open = (points: PdfPoint[], closed: boolean): SubPath => {
    const path: SubPath = { points: [...points], closed }
    paths.push(path)
    return path
  }
  for (const command of derived.commands) {
    if (command.type === 'moveTo') {
      current = open([{ x: command.x, y: command.y }], false)
      cursor = { x: command.x, y: command.y }
    } else if (command.type === 'lineTo') {
      current ??= open([], false)
      current.points.push({ x: command.x, y: command.y })
      cursor = { x: command.x, y: command.y }
    } else if (command.type === 'bezierCurveTo') {
      const from = cursor ?? { x: command.cp1x, y: command.cp1y }
      current ??= open([from], false)
      current.points.push(...bezierPoints(from, command))
      cursor = { x: command.x, y: command.y }
    } else if (command.type === 'ellipse') {
      current = open(ellipseSubPath(command).points, true)
      cursor = null
    } else if (current !== null) {
      current.closed = true
    }
  }
  return paths.filter((path) => path.points.length >= 2)
}

function freehandInk(
  pageNumber: number,
  object: Extract<EditorDocument['objects'][number], { kind: 'freehand' }>
): PdfInkObject[] {
  const points = normalizedStrokePoints(
    object.samples.map((sample) => transformed(sample, object.transform))
  )
  if (points.length < NATIVE_STROKE_MIN_POINTS) return []
  return [
    {
      pageNumber,
      points,
      color: object.brushSnapshot.color,
      width: object.brushSnapshot.nominalSize,
      closed: false
    }
  ]
}

function shapeInk(
  pageNumber: number,
  object: Extract<EditorDocument['objects'][number], { kind: 'shape' }>
): PdfInkObject[] {
  return shapeSubPaths(object).map((path) => ({
    pageNumber,
    points: path.points.map((point) => transformed(point, object.transform)),
    color: object.style.color,
    width: object.style.width,
    closed: path.closed
  }))
}

/**
 * 文档 → 原生折线。freehand 用持久化样本，形状交给画库派生命令后再拍平；
 * 坐标始终是页内 scale-one，与缩放无关。
 */
export function inkObjectsForNative(
  paintings: Readonly<Record<string, EditorDocument>> | undefined
): PdfInkObject[] {
  const objects: PdfInkObject[] = []
  for (const [pageId, document] of Object.entries(paintings ?? {})) {
    const pageNumber = paintingPageNumber(pageId)
    if (pageNumber === undefined) continue
    for (const object of document.objects) {
      if (object.kind === 'freehand')
        objects.push(...freehandInk(pageNumber, object))
      else if (object.kind === 'shape')
        objects.push(...shapeInk(pageNumber, object))
    }
  }
  return objects
}
