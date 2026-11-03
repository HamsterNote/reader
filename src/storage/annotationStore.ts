import {
  migrateLegacyDocument,
  readLayeredDocument,
  type EditorDocument
} from '@hamster-note/painting/core'
import {
  annotationStorageV5Key,
  parseHighlights,
  readAnnotationStorageV5,
  writeAnnotationStorageV5,
  type AnnotationDocumentValidator,
  type AnnotationStorageV5,
  type AnnotationStorageV5Backend,
  type AnnotationStorageV5WriteResult
} from './highlightStorage'
import type {
  ReaderSelectionRange,
  ReaderSelectionRectangle
} from '../types/selection'

export type ReaderAnnotations = {
  readonly version: 5
  readonly ranges: readonly ReaderSelectionRange[]
  readonly rects: readonly ReaderSelectionRectangle[]
  readonly paintings: Record<string, EditorDocument>
}

export type OpenAnnotationsResult =
  | { readonly status: 'ready'; readonly storage: ReaderAnnotations }
  | { readonly status: 'error'; readonly message: string }

export const isPaintingDocument: AnnotationDocumentValidator = (value) =>
  readLayeredDocument(value).ok

function toAnnotations(storage: AnnotationStorageV5): ReaderAnnotations {
  // Every value has passed the bound published document validator.
  return storage as unknown as ReaderAnnotations
}

function migrateLegacyAnnotations(raw: string | null): ReaderAnnotations {
  let source: Record<string, unknown> = { version: 4 }
  if (raw !== null) {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('旧标注容器无效')
    source = parsed as Record<string, unknown>
    if (![2, 3, 4].includes(source.version as number))
      throw new Error('不支持的旧标注版本')
  }
  const legacy = parseHighlights(raw)
  const paintings: Record<string, EditorDocument> = {}
  const legacyPaintings = source.paintings === undefined ? {} : source.paintings
  if (
    typeof legacyPaintings !== 'object' ||
    legacyPaintings === null ||
    Array.isArray(legacyPaintings)
  ) {
    throw new Error('旧绘图页集合无效')
  }
  // The container owns page identity only. Object kinds, styles and migration versions
  // are interpreted exclusively by painting, including pages that are not mounted.
  for (const [pageId, input] of Object.entries(legacyPaintings)) {
    if (!/^page-[1-9]\d*$/.test(pageId))
      throw new Error(`绘图页 ID 无效：${pageId}`)
    const migrated = migrateLegacyDocument(input)
    if (!migrated.ok)
      throw new Error(`绘图迁移失败：${pageId} ${migrated.error.path}`)
    paintings[pageId] = migrated.value
  }
  return {
    version: 5,
    ranges: legacy.ranges,
    rects: legacy.rects,
    paintings
  }
}

/** The mandatory validator is bound once; individual reads/writes cannot omit it. */
export function createAnnotationStore(
  backend: AnnotationStorageV5Backend,
  validateDocument: AnnotationDocumentValidator
) {
  if (typeof validateDocument !== 'function')
    throw new TypeError('A painting document validator is required')
  const options = Object.freeze({ validateDocument })

  function save(
    fileName: string,
    storage: ReaderAnnotations
  ): AnnotationStorageV5WriteResult {
    try {
      return writeAnnotationStorageV5(
        backend,
        annotationStorageV5Key(fileName),
        storage,
        options
      )
    } catch (error) {
      return { status: 'failed', error }
    }
  }

  function open(fileName: string): OpenAnnotationsResult {
    try {
      const current = readAnnotationStorageV5(
        backend,
        annotationStorageV5Key(fileName),
        options
      )
      if (current.status === 'ok')
        return { status: 'ready', storage: toAnnotations(current.storage) }
      if (current.status === 'invalid')
        return { status: 'error', message: `标注恢复失败：${current.reason}` }

      const raw = backend.getItem(`hamster-reader-demo:highlights:${fileName}`)
      const storage = migrateLegacyAnnotations(raw)
      const written = save(fileName, storage)
      if (written.status !== 'saved')
        return { status: 'error', message: '标注迁移保存失败，请重试' }
      return { status: 'ready', storage }
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : '标注恢复失败'
      }
    }
  }

  return Object.freeze({ open, save })
}
