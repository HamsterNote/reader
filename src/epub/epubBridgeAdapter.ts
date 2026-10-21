// HAM-88 任务 2.2：ReaderEngineAdapter（HAM-87 契约）的 EPUB 实现。
// 把桥接 open/restore/dispose 语义映射到 createEpubEngine：
// - open 失败只上报 ENGINE_FAILURE 由宿主决定，本适配器不碰既有数据；
// - restore 应用宿主最后确认快照：ranges 经兼容索引定位，不可定位项
//   原样保留并上报宿主；progress 按旧 page-N 跳转；
// - dispose 取消加载并释放全部资源，之后不再产生事件。

import type {
  EngineAdapterEventSink,
  ReaderEngineAdapter
} from '../bridge/engineAdapter'
import type { BridgeDocumentDescriptor } from '../bridge/engineAdapter'
import {
  createEpubEngine,
  type EpubEngine,
  type EpubEngineRange,
  type EpubEngineViewFactory
} from './foliateEpubEngine'

export type EpubBridgeAdapterOptions = {
  readonly container: HTMLElement
  readonly sink: EngineAdapterEventSink
  /** 受控 URL → 字节（宿主文件缓存）；默认 fetch。 */
  readonly fetchBytes?: (fileUrl: string) => Promise<Uint8Array>
  /** 测试注入点：jsdom 无布局，以假视图替换真实 foliate-view。 */
  readonly viewFactory?: EpubEngineViewFactory
}

type RestoredSnapshot = {
  readonly data: unknown
  readonly progress: unknown
}

/** 快照 ranges → 引擎输入；只接受端点形状合法的项，其余跳过。 */
const parseRestoredRanges = (data: unknown): readonly EpubEngineRange[] => {
  if (typeof data !== 'object' || data === null) return []
  const { ranges } = data as Record<string, unknown>
  if (!Array.isArray(ranges)) return []
  return ranges.flatMap((item): EpubEngineRange[] => {
    if (typeof item !== 'object' || item === null) return []
    const candidate = item as Record<string, unknown>
    const { id, text, start, end, markerStyle } = candidate
    if (
      typeof id !== 'string' ||
      typeof text !== 'string' ||
      typeof start !== 'object' ||
      start === null ||
      typeof end !== 'object' ||
      end === null
    ) {
      return []
    }
    const startEndpoint = start as Record<string, unknown>
    const endEndpoint = end as Record<string, unknown>
    if (
      typeof startEndpoint.selectionId !== 'string' ||
      typeof startEndpoint.offset !== 'number' ||
      typeof endEndpoint.selectionId !== 'string' ||
      typeof endEndpoint.offset !== 'number'
    ) {
      return []
    }
    const style = markerStyle as Record<string, unknown> | null
    return [
      {
        id,
        text,
        start: {
          selectionId: startEndpoint.selectionId,
          offset: startEndpoint.offset
        },
        end: {
          selectionId: endEndpoint.selectionId,
          offset: endEndpoint.offset
        },
        markerStyle:
          typeof style?.backgroundColor === 'string'
            ? { backgroundColor: style.backgroundColor }
            : undefined
      }
    ]
  })
}

const parseRestoredPage = (progress: unknown): number | null => {
  if (typeof progress !== 'object' || progress === null) return null
  const record = progress as Record<string, unknown>
  const pageNumber = record.pageNumber ?? record.currentPageNumber
  return typeof pageNumber === 'number' && pageNumber >= 1
    ? Math.floor(pageNumber)
    : null
}

export const createEpubBridgeAdapter = (
  options: EpubBridgeAdapterOptions
): ReaderEngineAdapter => {
  let engine: EpubEngine | null = null
  let disposed = false

  const fetchBytes =
    options.fetchBytes ??
    (async (fileUrl: string) => {
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch document: HTTP ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    })

  return {
    async open(descriptor: BridgeDocumentDescriptor) {
      if (disposed) return
      if (descriptor.format !== 'epub') {
        options.sink.emitError(
          `EPUB adapter cannot open format: ${descriptor.format}`
        )
        return
      }
      try {
        const bytes = await fetchBytes(descriptor.fileUrl)
        if (disposed) return
        const engineConfig = {
          container: options.container,
          source: bytes,
          onError: (error: { message: string }) =>
            options.sink.emitError(error.message),
          onSelection: (payload: unknown) => {
            if (payload) options.sink.emitChange({ selection: payload })
          },
          onRelocate: (location: {
            pageNumber: number | null
            fraction: number
          }) => {
            options.sink.emitProgress({
              pageNumber: location.pageNumber,
              fraction: location.fraction
            })
          }
        }
        engine = options.viewFactory
          ? createEpubEngine(engineConfig, options.viewFactory)
          : createEpubEngine(engineConfig)
        await engine.ready
      } catch (error) {
        // open 失败：上报错误，既有数据不动（契约）。
        options.sink.emitError(
          error instanceof Error ? error.message : String(error)
        )
      }
    },

    async restore(snapshot: RestoredSnapshot) {
      if (disposed || !engine) return
      await engine.ready.catch(() => undefined)
      const report = engine.showRanges(parseRestoredRanges(snapshot.data))
      if (report.unlocatable.length > 0) {
        // 不可定位项原样保留；上报由宿主决定如何呈现。
        options.sink.emitError(
          `Unlocatable legacy ranges preserved: ${report.unlocatable
            .map((entry) => entry.id)
            .join(', ')}`
        )
      }
      const pageNumber = parseRestoredPage(snapshot.progress)
      if (pageNumber !== null) await engine.goToPage(pageNumber)
    },

    async dispose() {
      if (disposed) return
      disposed = true
      await engine?.destroy()
      engine = null
    }
  }
}
