import type {
  ReaderData,
  ReaderEdgeCrop,
  ReaderPageEdgeCrop
} from '../types/readerData'
import type { PdfIdentity } from './contracts'
import { groupHiddenPages, type HiddenPageGroup } from '../pdf/hiddenPages'

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export type NativePageEditDirty = Readonly<{
  hiddenPages: boolean
  cropAll: boolean
}>

export type NativePageEditOperation = Readonly<{
  operationId: string
  identity: PdfIdentity
  leaseEpoch: number
  baseRevision: number
  base: Readonly<{
    hiddenPages?: readonly (number | string)[]
    edgeCrop?: ReaderPageEdgeCrop
  }>
  dirty: NativePageEditDirty
  target: Readonly<{
    hiddenPages?: readonly number[]
    cropAll?: ReaderEdgeCrop
  }>
}>

export type NativePageEditUndo = Readonly<{
  dirty?: NativePageEditDirty
  hiddenPages?: readonly (number | string)[]
  edgeCrop?: ReaderPageEdgeCrop
  cropAll?: ReaderEdgeCrop
}>

function immutable<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const nested of Object.values(value)) immutable(nested)
  return Object.freeze(value)
}

function copyCrop(
  crop: ReaderEdgeCrop | undefined
): ReaderEdgeCrop | undefined {
  return crop ? { ...crop } : undefined
}

function copyPageCrop(
  crop: ReaderPageEdgeCrop | undefined
): ReaderPageEdgeCrop | undefined {
  if (!crop) return undefined
  return {
    ...(crop.all ? { all: copyCrop(crop.all) } : {}),
    ...(crop.pages
      ? {
          pages: Object.fromEntries(
            Object.entries(crop.pages).map(([key, value]) => [
              key,
              copyCrop(value) ?? {}
            ])
          )
        }
      : {})
  }
}

export function nativeHiddenPageNumbers(
  values: ReaderData['hiddenPages']
): number[] {
  return (values ?? [])
    .flatMap((value) => {
      const pageNumber =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/^page-/, ''))
      return Number.isInteger(pageNumber) && pageNumber > 0 ? [pageNumber] : []
    })
    .sort((a, b) => a - b)
}

function hiddenPagesEqual(
  left: ReaderData['hiddenPages'],
  right: readonly number[]
): boolean {
  const a = [...new Set(nativeHiddenPageNumbers(left))]
  const b = [...new Set(nativeHiddenPageNumbers(right))]
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function cropEqual(
  left: ReaderEdgeCrop | undefined,
  right: ReaderEdgeCrop | undefined
): boolean {
  return (['top', 'right', 'bottom', 'left'] as const).every(
    (side) => (left?.[side] ?? 0) === (right?.[side] ?? 0)
  )
}

export function createNativePageEditOperation(input: {
  readonly operationId: string
  readonly identity: PdfIdentity
  readonly leaseEpoch: number
  readonly baseRevision: number
  readonly base: Pick<ReaderData, 'hiddenPages' | 'edgeCrop'>
  readonly draftHiddenPages: readonly number[]
  readonly draftCrop: ReaderEdgeCrop
}): NativePageEditOperation {
  const hiddenPages = [...new Set(input.draftHiddenPages)].sort((a, b) => a - b)
  const dirty = {
    hiddenPages: !hiddenPagesEqual(input.base.hiddenPages, hiddenPages),
    cropAll: !cropEqual(input.base.edgeCrop?.all, input.draftCrop)
  }
  return immutable({
    operationId: input.operationId,
    identity: { ...input.identity },
    leaseEpoch: input.leaseEpoch,
    baseRevision: input.baseRevision,
    base: {
      hiddenPages: input.base.hiddenPages
        ? [...input.base.hiddenPages]
        : undefined,
      edgeCrop: copyPageCrop(input.base.edgeCrop)
    },
    dirty,
    target: {
      hiddenPages,
      cropAll: copyCrop(input.draftCrop) ?? {}
    }
  })
}

export function applyNativePageEditOperation(
  current: ReaderData,
  operation: NativePageEditOperation
): ReaderData {
  const next: Record<string, unknown> = { ...current }
  if (operation.dirty.hiddenPages) {
    next.hiddenPages = [...(operation.target.hiddenPages ?? [])]
  }
  if (operation.dirty.cropAll) {
    next.edgeCrop = {
      ...current.edgeCrop,
      all: copyCrop(operation.target.cropAll) ?? {}
    }
  }
  return next as ReaderData
}

export function createNativePageEditUndo(
  current: ReaderData,
  operation: NativePageEditOperation
): NativePageEditUndo {
  return immutable({
    dirty: { ...operation.dirty },
    ...(operation.dirty.hiddenPages
      ? {
          hiddenPages: current.hiddenPages
            ? [...current.hiddenPages]
            : undefined
        }
      : {}),
    ...(operation.dirty.cropAll
      ? { cropAll: copyCrop(current.edgeCrop?.all) }
      : {})
  })
}

/** Replace only the existing readerData member of a snapshot data envelope. */
export function withNativePageEditData(
  snapshotData: unknown,
  readerData: ReaderData
): Record<string, unknown> {
  return { ...record(snapshotData), readerData }
}

/** Web popover commits own ranges/comments; native drawings and readerData stay authoritative. */
export function mergeNativeExternalData(
  currentData: unknown,
  incomingData: unknown
): Record<string, unknown> {
  const current = record(currentData)
  const incoming = record(incomingData)
  const currentAnnotations = record(current['annotations'])
  const incomingAnnotations = record(incoming['annotations'])
  const owns = (value: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(value, key)
  return {
    ...current,
    ...incoming,
    ...(owns(current, 'readerData') ? { readerData: current.readerData } : {}),
    ...(owns(incoming, 'annotations')
      ? {
          annotations: {
            ...currentAnnotations,
            ...incomingAnnotations,
            ...(owns(currentAnnotations, 'rects')
              ? { rects: currentAnnotations.rects }
              : {}),
            ...(owns(currentAnnotations, 'paintings')
              ? { paintings: currentAnnotations.paintings }
              : {})
          }
        }
      : {})
  }
}

function restoreCropAll(
  current: ReaderData,
  crop: ReaderEdgeCrop | undefined
): ReaderData {
  const edgeCrop: {
    all?: ReaderEdgeCrop
    pages?: Readonly<Record<string, ReaderEdgeCrop>>
  } = { ...current.edgeCrop }
  if (crop === undefined) delete edgeCrop.all
  else edgeCrop.all = copyCrop(crop)
  const next = { ...current }
  if (Object.keys(edgeCrop).length === 0) delete next.edgeCrop
  else next.edgeCrop = edgeCrop
  return next
}

/** Restore only fields owned by the page editor onto the newest ReaderData. */
export function restoreNativePageEditFields(
  current: ReaderData,
  undo: NativePageEditUndo
): ReaderData {
  const dirty = undo.dirty ?? {
    hiddenPages: Object.prototype.hasOwnProperty.call(undo, 'hiddenPages'),
    cropAll:
      Object.prototype.hasOwnProperty.call(undo, 'cropAll') ||
      Object.prototype.hasOwnProperty.call(undo, 'edgeCrop')
  }
  let next: ReaderData = { ...current }
  if (dirty.hiddenPages) {
    const withHidden = { ...next }
    if (undo.hiddenPages === undefined) delete withHidden.hiddenPages
    else withHidden.hiddenPages = [...undo.hiddenPages]
    next = withHidden
  }
  if (dirty.cropAll) {
    next =
      undo.edgeCrop !== undefined
        ? { ...next, edgeCrop: undo.edgeCrop }
        : restoreCropAll(next, undo.cropAll)
  }
  return next
}

export function nativePageEditGroups(
  hiddenPages: ReaderData['hiddenPages'],
  pageCount: number
): readonly HiddenPageGroup[] {
  return groupHiddenPages(
    hiddenPages,
    Array.from({ length: Math.max(0, pageCount) }, (_, index) => index + 1)
  )
}
