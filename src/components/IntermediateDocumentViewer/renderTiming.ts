// renderTiming.ts - intermediate-document 渲染阶段计时工具
// 支持回调与环境变量双激活，默认静默，避免生产环境产生噪音。

/** 渲染计时阶段枚举 */
export type IntermediateDocumentRenderTimingStage =
  | 'document-resolution'
  | 'shell-rendering'
  | 'initial-page-loading'
  | 'content-extraction'
  | 'page-content-rendering'
  | 'visibility-lazy-loading'
  | 'offscreen-unload'
  | 'ocr-processing'

/** 渲染计时记录条目 */
export type DetailValue = string | number | boolean | null
export interface IntermediateDocumentRenderTimingEntry {
  stage: IntermediateDocumentRenderTimingStage
  startedAt: number
  endedAt: number
  durationMs: number
  pageNumber?: number
  detail?: Readonly<Record<string, DetailValue>>
}

/** 渲染计时回调 */
export type IntermediateDocumentRenderTimingCallback = (
  entry: IntermediateDocumentRenderTimingEntry
) => void

/** 时钟抽象，便于测试注入 */
export interface IntermediateDocumentRenderTimingClock {
  now: () => number
}

/** 工厂函数选项 */
export interface CreateIntermediateDocumentRenderTimingOptions {
  callback?: IntermediateDocumentRenderTimingCallback
  clock?: IntermediateDocumentRenderTimingClock
  /** 显式覆盖环境变量检测结果；未提供时读取 import.meta.env */
  envEnabled?: boolean
}

/** 工厂函数返回的计时实例 */
export interface IntermediateDocumentRenderTiming {
  readonly enabled: boolean
  /** 开始计时，返回结束函数（disabled 时返回 no-op） */
  start: (
    stage: IntermediateDocumentRenderTimingStage,
    context?: {
      pageNumber?: number
      detail?: Record<string, DetailValue>
    }
  ) => () => void
  /** 同步测量 fn 执行耗时并返回 fn 结果 */
  measure: <T>(
    stage: IntermediateDocumentRenderTimingStage,
    context:
      | {
          pageNumber?: number
          detail?: Record<string, string | number | boolean | null>
        }
      | undefined,
    fn: () => T
  ) => T
  /** 直接记录一条已构造的 entry */
  record: (entry: IntermediateDocumentRenderTimingEntry) => void
}

/** 默认时钟：优先 performance.now，回退 Date.now */
const defaultClock: IntermediateDocumentRenderTimingClock = {
  now: () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
}

interface ViteImportMetaEnv {
  VITE_HAMSTER_READER_INTERMEDIATE_TIMING?: string
}

/** 检测 Vite 环境变量是否启用计时日志 */
function checkImportMetaEnv(): boolean {
  try {
    const env = (import.meta as { env?: ViteImportMetaEnv }).env
    return env?.VITE_HAMSTER_READER_INTERMEDIATE_TIMING === 'true'
  } catch {
    return false
  }
}

/** 不可变冻结 detail 副本，不修改原始对象 */
function freezeDetail(
  detail?: Record<string, string | number | boolean | null>
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  return detail !== undefined ? Object.freeze({ ...detail }) : undefined
}

/** 创建 intermediate-document 渲染计时器 */
export function createIntermediateDocumentRenderTiming(
  options?: CreateIntermediateDocumentRenderTimingOptions
): IntermediateDocumentRenderTiming {
  const callback = options?.callback
  const clock = options?.clock ?? defaultClock
  const envEnabled = options?.envEnabled ?? checkImportMetaEnv()
  const enabled = callback !== undefined || envEnabled

  /** 发射 entry：callback 优先；env 启用时同时输出 console.debug */
  function emit(entry: IntermediateDocumentRenderTimingEntry): void {
    if (callback) callback(entry)
    if (envEnabled) {
      console.debug('[hamster-reader][intermediate-document]', entry)
    }
  }

  return {
    enabled,

    start(stage, context) {
      if (!enabled) return noopFinish
      const startedAt = clock.now()
      const pageNumber = context?.pageNumber
      const detail = freezeDetail(context?.detail)
      return () => {
        const endedAt = clock.now()
        emit({
          stage,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          pageNumber,
          detail
        })
      }
    },

    measure(stage, context, fn) {
      if (!enabled) return fn()
      const startedAt = clock.now()
      const result = fn()
      const endedAt = clock.now()
      emit({
        stage,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        pageNumber: context?.pageNumber,
        detail: freezeDetail(context?.detail)
      })
      return result
    },

    record(entry) {
      if (!enabled) return
      emit(entry)
    }
  }
}

function noopFinish(): void {}
