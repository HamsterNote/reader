import { useCallback, useEffect, useRef } from 'react'

import type {
  IntermediateContent,
  IntermediateDocument,
  IntermediateImage,
  IntermediateText
} from '@hamster-note/types'

/**
 * 懒加载页面队列的参数配置。由 `IntermediateDocumentViewer` 通过
 * `lazyQueueConfigRef.current` 提供实时值，队列在每次调度时读取最新配置，
 * 避免参数膨胀并保证配置变更后立即生效。
 */
export interface LazyPageQueueConfig {
  /** 初始立即加载的页数（默认 1） */
  initialLoadedPages: number
  /** 同时并发加载的页数上限（默认 3） */
  pageLoadConcurrency: number
  /**
   * 页面进入可加载窗口后、真正发起加载前的延迟（毫秒）。
   * 当前阶段仅用于初始页面之后的可见性触发（后续任务实现），
   * 初始页面不受此延迟限制。
   */
  pageLoadEnterDelayMs: number
  /** 页面离开可加载窗口后、卸载其内容的延迟（毫秒），后续任务实现 */
  pageUnloadDelayMs: number
}

/**
 * 页面内容加载结果处理回调集合。队列加载完一页后调用这些回调，
 * 由 `IntermediateDocumentViewer` 提供具体的状态更新实现，
 * 复用现有的 immutable updater helpers（createSet*Handler）。
 */
export interface LazyPageQueueCallbacks {
  /** 页面加载成功后，更新底图/文本/图片/状态 */
  onPageLoaded: (params: {
    pageNumber: number
    baseImage: string | undefined
    texts: IntermediateText[]
    images: IntermediateImage[]
  }) => void
  /** 页面加载失败后，清空该页的状态并标记为 'error' */
  onPageError: (pageNumber: number) => void
  /** 判断某页是否已加载（texts map 已有该页条目） */
  isPageLoaded: (pageNumber: number) => boolean
}

/**
 * `useLazyPageQueue` 返回的稳定函数集合。
 * - `enqueueInitialPages`：在 shell 就绪后入队前 `initialLoadedPages` 页。
 * - `enqueuePage`：入队单个页码（例如由可见性观察器触发）。
 * - `cancelAll`：在文档/renderMode 变更时清空队列并忽略在途结果。
 */
export interface LazyPageQueueApi {
  enqueueInitialPages: (pageNumbers: number[]) => void
  enqueuePage: (pageNumber: number) => void
  cancelAll: () => void
}

/**
 * intermediate-document 默认模式的懒加载页面队列 hook。
 *
 * 设计要点：
 * - 队列项是 **页码**（number），不是已加载的 `IntermediatePage` 对象。
 * - 在开始一个队列项前，重新检查：renderMode 仍为 'intermediate-document'、
 *   document 仍是当前活动文档、页码仍在当前 pageNumbers 中、未已加载/在途。
 * - 通过 `loadingPagesRef`（Set<number>）强制并发上限 `pageLoadConcurrency`。
 * - 对 queued/in-flight/loaded 页码去重。
 * - document/renderMode 变更时，`cancelAll` 清空队列；在途 async 结果通过
 *   generation token 被忽略。
 * - 不与 html-parser 的 `decodingPageNumbersRef` 共享状态，保持模式隔离。
 *
 * 加载流程：`getPageByPageNumber` → `getBaseImageFromPage` + `getPageContentEntries`
 * → 用 `isIntermediateText`/`isIntermediateImage` 过滤 → 调用 callbacks 更新状态。
 */
export function useLazyPageQueue(
  configRef: React.MutableRefObject<LazyPageQueueConfig>,
  runtimeDocument: IntermediateDocument | null,
  options: {
    renderMode: string
    activeDocumentRef: React.MutableRefObject<IntermediateDocument | null>
    isMountedRef: React.MutableRefObject<boolean>
    loadingPagesRef: React.MutableRefObject<Set<number>>
    getBaseImageFromPage: (page: unknown) => Promise<string | undefined>
    getPageContentEntries: (page: unknown) => Promise<IntermediateContent[]>
    isIntermediateText: (
      content: IntermediateContent
    ) => content is IntermediateText
    isIntermediateImage: (
      content: IntermediateContent
    ) => content is IntermediateImage
    callbacks: LazyPageQueueCallbacks
  }
): LazyPageQueueApi {
  const {
    renderMode,
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getBaseImageFromPage,
    getPageContentEntries,
    isIntermediateText,
    isIntermediateImage,
    callbacks
  } = options

  // 待加载页码队列（保持插入顺序，不去重存储层，enqueuePage 内去重）
  const queuedPageNumbersRef = useRef<number[]>([])
  // 每次 document/renderMode 变化时递增的代际 token；
  // 在途 async 结果在 resolve 时比对，不匹配则丢弃。
  const generationRef = useRef(0)
  // 当前 pageNumbers 快照，用于在开始加载前校验页码仍被需要。
  // 由 enqueueInitialPages 调用时更新。
  const currentRangePageNumbersRef = useRef<number[]>([])
  // pumpQueue 的 stable ref，用于解决 startPageLoad <-> pumpQueue 循环依赖。
  // pumpQueueRef.current 始终指向最新的 pumpQueue 实现。
  const pumpQueueRef = useRef<(generation: number) => void>(() => {})

  /**
   * 从队列中取出首个仍可加载的页码。
   * 可加载 = 页码仍在当前 range、未加载、未在途。
   */
  const dequeueNextLoadable = useCallback((): number | undefined => {
    const rangeSet = new Set(currentRangePageNumbersRef.current)
    while (queuedPageNumbersRef.current.length > 0) {
      const pageNumber = queuedPageNumbersRef.current.shift()
      if (pageNumber === undefined) {
        continue
      }
      // 页码不在当前 range → 跳过
      if (!rangeSet.has(pageNumber)) {
        continue
      }
      // 已加载 → 跳过
      if (callbacks.isPageLoaded(pageNumber)) {
        continue
      }
      // 已在途 → 跳过
      if (loadingPagesRef.current.has(pageNumber)) {
        continue
      }
      return pageNumber
    }
    return undefined
  }, [callbacks, loadingPagesRef])

  /**
   * 实际发起单页加载。读取最新 config/document，
   * 在 resolve 前后做 stale 守卫。
   */
  const startPageLoad = useCallback(
    (pageNumber: number, generation: number) => {
      const document = runtimeDocument
      // document 可能在 generation 检查之间变为 null
      if (!document) {
        return
      }

      // 二次守卫：renderMode/document/页码仍有效
      if (renderMode !== 'intermediate-document') {
        return
      }
      if (activeDocumentRef.current !== document) {
        return
      }
      if (callbacks.isPageLoaded(pageNumber)) {
        return
      }
      if (loadingPagesRef.current.has(pageNumber)) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>
      try {
        pagePromise = document.getPageByPageNumber(pageNumber)
      } catch {
        callbacks.onPageError(pageNumber)
        return
      }

      if (!pagePromise) {
        callbacks.onPageError(pageNumber)
        return
      }

      // 标记在途，入队并发计数
      loadingPagesRef.current.add(pageNumber)

      pagePromise
        .then((page) =>
          Promise.all([getBaseImageFromPage(page), getPageContentEntries(page)])
        )
        .then(([baseImage, content]) => {
          // stale 守卫：unmount / document 切换 / generation 过期
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== document ||
            generationRef.current !== generation
          ) {
            return
          }

          const texts = content.filter(isIntermediateText)
          const images = content.filter(isIntermediateImage)
          callbacks.onPageLoaded({ pageNumber, baseImage, texts, images })
        })
        .catch(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== document ||
            generationRef.current !== generation
          ) {
            return
          }
          callbacks.onPageError(pageNumber)
        })
        .finally(() => {
          // 清除在途标记（仅当仍在同一 generation）
          if (generationRef.current === generation) {
            loadingPagesRef.current.delete(pageNumber)
          }
          // 尝试启动队列中下一个页码（保持并发满载）
          // 使用 microtask 延迟以避免在 finally 中同步触发新加载
          // 导致 React 批处理问题。
          queueMicrotask(() => {
            if (
              !isMountedRef.current ||
              activeDocumentRef.current !== document ||
              generationRef.current !== generation
            ) {
              return
            }
            pumpQueueRef.current(generation)
          })
        })
      // 注意：startPageLoad 内部不直接 pump；由调用方 pumpQueue 驱动
    },
    [
      runtimeDocument,
      renderMode,
      activeDocumentRef,
      isMountedRef,
      loadingPagesRef,
      callbacks,
      getBaseImageFromPage,
      getPageContentEntries,
      isIntermediateText,
      isIntermediateImage
    ]
  )

  /**
   * 驱动队列：在并发预算内启动尽可能多的页码加载。
   * `generation` 用于防止跨代际的递归 pump。
   */
  const pumpQueue = useCallback(
    (generation: number) => {
      // 快速 stale 检查
      if (generationRef.current !== generation) {
        return
      }
      if (renderMode !== 'intermediate-document') {
        return
      }
      if (!runtimeDocument || activeDocumentRef.current !== runtimeDocument) {
        return
      }

      const concurrency = configRef.current.pageLoadConcurrency
      while (loadingPagesRef.current.size < concurrency) {
        const pageNumber = dequeueNextLoadable()
        if (pageNumber === undefined) {
          break
        }
        startPageLoad(pageNumber, generation)
      }
    },
    [
      configRef,
      runtimeDocument,
      renderMode,
      activeDocumentRef,
      loadingPagesRef,
      dequeueNextLoadable,
      startPageLoad
    ]
  )

  // 始终将最新 pumpQueue 暴露给 startPageLoad 的 finally 回调（通过 ref 打破循环）
  pumpQueueRef.current = pumpQueue

  /**
   * 在 shell 就绪后入队前 `initialLoadedPages` 页并启动加载。
   * 初始页面不受 `pageLoadEnterDelayMs` 延迟限制。
   */
  const enqueueInitialPages = useCallback(
    (pageNumbers: number[]) => {
      // 更新当前 range 快照
      currentRangePageNumbersRef.current = pageNumbers
      // 仅 intermediate-document 模式生效
      if (renderMode !== 'intermediate-document' || !runtimeDocument) {
        return
      }

      const initialCount = configRef.current.initialLoadedPages
      if (initialCount <= 0) {
        return
      }

      const targetPages = pageNumbers.slice(0, initialCount)
      // 去重后入队
      for (const pageNumber of targetPages) {
        if (
          !callbacks.isPageLoaded(pageNumber) &&
          !loadingPagesRef.current.has(pageNumber) &&
          !queuedPageNumbersRef.current.includes(pageNumber)
        ) {
          queuedPageNumbersRef.current.push(pageNumber)
        }
      }

      pumpQueue(generationRef.current)
    },
    [
      configRef,
      runtimeDocument,
      renderMode,
      callbacks,
      loadingPagesRef,
      pumpQueue
    ]
  )

  /**
   * 入队单个页码（例如由可见性观察器在 500ms 防抖后触发）。
   * 当前阶段仅暴露 API，实际可见性触发在后续任务实现。
   */
  const enqueuePage = useCallback(
    (pageNumber: number) => {
      if (renderMode !== 'intermediate-document' || !runtimeDocument) {
        return
      }
      // 页码不在当前 range → 忽略
      if (!currentRangePageNumbersRef.current.includes(pageNumber)) {
        return
      }
      // 去重
      if (callbacks.isPageLoaded(pageNumber)) {
        return
      }
      if (loadingPagesRef.current.has(pageNumber)) {
        return
      }
      if (queuedPageNumbersRef.current.includes(pageNumber)) {
        return
      }
      queuedPageNumbersRef.current.push(pageNumber)
      pumpQueue(generationRef.current)
    },
    [runtimeDocument, renderMode, callbacks, loadingPagesRef, pumpQueue]
  )

  /**
   * 在 document/renderMode 变更时清空队列并使在途结果失效。
   * 递增 generation token，使所有在途 promise 的 resolve 被忽略。
   */
  const cancelAll = useCallback(() => {
    queuedPageNumbersRef.current = []
    generationRef.current += 1
    // loadingPagesRef.current.clear() 由外层 document-change effect 统一处理，
    // 此处不重复清理以避免与 document effect 竞争。
  }, [])

  // document/renderMode 变化时自动 cancelAll：这两个 dep 作为触发键，
  // effect body 不直接使用它们的值，仅通过 cancelAll 重置队列代际。
  useEffect(() => {
    cancelAll()
  }, [runtimeDocument, renderMode, cancelAll])

  // unmount 时清空队列
  useEffect(() => {
    return () => {
      queuedPageNumbersRef.current = []
      generationRef.current += 1
    }
  }, [])

  return { enqueueInitialPages, enqueuePage, cancelAll }
}
