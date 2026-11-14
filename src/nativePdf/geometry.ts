import type { PdfCrop, PdfMatrix, PdfPoint } from './contracts'
export function transformPoint(m: PdfMatrix, p: PdfPoint): PdfPoint {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5]
  }
}
export function inverseMatrix(m: PdfMatrix): PdfMatrix {
  const d = m[0] * m[3] - m[1] * m[2]
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12)
    throw new Error('Invalid PDF transform')
  return [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d
  ]
}
export function visibleOriginalPages(
  count: number,
  hidden: readonly (number | string)[] = [],
  range?: readonly [number, number]
): number[] {
  const removed = new Set(
    hidden.map((v) => Number(String(v).replace(/^page-/, '')))
  )
  return Array.from({ length: count }, (_, i) => i + 1).filter(
    (n) => !removed.has(n) && (!range || (n >= range[0] && n <= range[1]))
  )
}
export function validCrop(crop: PdfCrop): boolean {
  const { top = 0, right = 0, bottom = 0, left = 0 } = crop
  return (
    [top, right, bottom, left].every(
      (v) => Number.isFinite(v) && v >= 0 && v < 1
    ) &&
    top + bottom < 1 &&
    left + right < 1
  )
}
