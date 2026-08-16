import type {
  IntermediateContent,
  IntermediateDocument,
  IntermediateImage,
  IntermediateParagraph,
  IntermediateText
} from '@hamster-note/types'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

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
    useFlowLayout: boolean
    baseImage: string | undefined
    thumbnailScale: number | undefined
    texts: IntermediateText[]
    paragraphs: IntermediateParagraph[]
    images: IntermediateImage[]
    content: IntermediateContent[]
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
 * - `replaceRequiredPages`：替换当前必需页面集合，并让离开集合的在途结果失效。
 * - `cancelAll`：清空队列并忽略在途结果。
 */
export interface LazyPageQueueApi {
  enqueueInitialPages: (pageNumbers: number[]) => void
  enqueuePage: (pageNumber: number) => void
  replaceRequiredPages: (pageNumbers: readonly number[]) => void
  cancelAll: () => void
}

type LazyPageQueueMode = 'layout' | 'text'

const pageUsesFlowLayout = (page: unknown): boolean =>
  typeof page === 'object' &&
  page !== null &&
  'useFlowLayout' in page &&
  page.useFlowLayout === true

/**
 * intermediate-document 默认模式的懒加载页面队列 hook。
 *
 * 设计要点：
 * - 队列项是 **页码**（number），不是已加载的 `IntermediatePage` 对象。
 * - 在开始一个队列项前，重新检查：document 仍是当前活动文档、页码仍在当前 pageNumbers 中、未已加载/在途。
 * - 通过 `loadingPagesRef`（Set<number>）强制并发上限 `pageLoadConcurrency`。
 * - 对 queued/in-flight/loaded 页码去重。
 * - `cancelAll` 清空队列；在途 async 结果通过 generation token 被忽略。
 *
 * 加载流程：`getPageByPageNumber` → `getBaseImageFromPage` + `getPageContentEntries`
 * → 用 `isIntermediateText`/`isIntermediateImage` 过滤 → 调用 callbacks 更新状态。
 */
export function useLazyPageQueue(
  configRef: React.MutableRefObject<LazyPageQueueConfig>,
  runtimeDocument: IntermediateDocument | null,
  options: {
    mode?: LazyPageQueueMode
    activeDocumentRef: React.MutableRefObject<IntermediateDocument | null>
    isMountedRef: React.MutableRefObject<boolean>
    loadingPagesRef: React.MutableRefObject<Set<number>>
    getBaseImageFromPage?: (
      page: unknown,
      scale?: number
    ) => Promise<string | undefined>
    getPageContentEntries: (page: unknown) => Promise<IntermediateContent[]>
    isIntermediateText: (
      content: IntermediateContent
    ) => content is IntermediateText
    isIntermediateImage?: (
      content: IntermediateContent
    ) => content is IntermediateImage
    callbacks: LazyPageQueueCallbacks
    getThumbnailScale?: (pageNumber: number) => number
  }
): LazyPageQueueApi {
  const {
    mode = 'layout',
    activeDocumentRef,
    isMountedRef,
    loadingPagesRef,
    getBaseImageFromPage,
    getPageContentEntries,
    isIntermediateText,
    isIntermediateImage,
    callbacks,
    getThumbnailScale
  } = options

  // 待加载页码队列（保持插入顺序，不去重存储层，enqueuePage 内去重）
  const queuedPageNumbersRef = useRef<number[]>([])
  // 本 hook 自己写入 loadingPagesRef 的页码集合。借此集合维护「懒队列拥有」的边界：cancelAll 仅清除这些页码。
  const lazyInFlightPagesRef = useRef(new Set<number>())
  const physicalInFlightPagesRef = useRef(new Set<number>())
  const pageRequestEpochRef = useRef(new Map<number, number>())
  // 每次取消时递增的代际 token；
  // 在途 async 结果在 resolve 时比对，不匹配则丢弃。
  const generationRef = useRef(0)
  // 当前 pageNumbers 快照，用于在开始加载前校验页码仍被需要。
  // 由 enqueueInitialPages 调用时更新。
  const currentRangePageNumbersRef = useRef<number[]>([])
  const previousRuntimeDocumentRef = useRef<IntermediateDocument | null>(null)
  const callbacksRef = useRef(callbacks)
  useLayoutEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])
  // pumpQueue 的 stable ref，用于解决 startPageLoad <-> pumpQueue 循环依赖。
  // pumpQueueRef.current 始终指向最新的 pumpQueue 实现。
  const pumpQueueRef = useRef<(generation: number) => void>(() => {})
  const hasRuntimeDocument = runtimeDocument !== null

  /**
   * 从队列中取出首个仍可加载的页码。
   * 可加载 = 页码仍在当前 range、未加载、未在途。
   */
  const dequeueNextLoadable = useCallback((): number | undefined => {
    const rangeSet = new Set(currentRangePageNumbersRef.current)
    let remainingCandidates = queuedPageNumbersRef.current.length
    while (remainingCandidates > 0) {
      remainingCandidates -= 1
      const pageNumber = queuedPageNumbersRef.current.shift()
      if (pageNumber === undefined) {
        continue
      }
      // 页码不在当前 range → 跳过
      if (!rangeSet.has(pageNumber)) {
        continue
      }
      // 已加载 → 跳过
      if (callbacksRef.current.isPageLoaded(pageNumber)) {
        continue
      }
      // 已在途 → 跳过
      if (loadingPagesRef.current.has(pageNumber)) {
        continue
      }
      if (physicalInFlightPagesRef.current.has(pageNumber)) {
        queuedPageNumbersRef.current.push(pageNumber)
        continue
      }
      return pageNumber
    }
    return undefined
  }, [loadingPagesRef])

  /**
   * 实际发起单页加载。读取最新 config/document，
   * 在 resolve 前后做 stale 守卫。
   */
  const startPageLoad = useCallback(
    (pageNumber: number, generation: number) => {
      const document = activeDocumentRef.current
      const requestEpoch = pageRequestEpochRef.current.get(pageNumber) ?? 0
      pageRequestEpochRef.current.set(pageNumber, requestEpoch)
      // document 可能在 generation 检查之间变为 null
      if (!document) {
        return
      }

      // 二次守卫：document/页码仍有效
      if (activeDocumentRef.current !== document) {
        return
      }
      if (callbacksRef.current.isPageLoaded(pageNumber)) {
        return
      }
      if (loadingPagesRef.current.has(pageNumber)) {
        return
      }

      let pagePromise: ReturnType<IntermediateDocument['getPageByPageNumber']>
      try {
        pagePromise = document.getPageByPageNumber(pageNumber)
      } catch {
        callbacksRef.current.onPageError(pageNumber)
        return
      }

      if (!pagePromise) {
        callbacksRef.current.onPageError(pageNumber)
        return
      }

      // 标记在途，入队并发计数
      loadingPagesRef.current.add(pageNumber)
      lazyInFlightPagesRef.current.add(pageNumber)
      physicalInFlightPagesRef.current.add(pageNumber)

      pagePromise
        .then((page) => {
          if (mode === 'text') {
            return Promise.all([
              Promise.resolve(undefined),
              getPageContentEntries(page),
              Promise.resolve(undefined),
              Promise.resolve(pageUsesFlowLayout(page)),
              Promise.resolve(
                Array.isArray(page.paragraphs) ? page.paragraphs : []
              )
            ])
          }

          const thumbnailScale = getThumbnailScale?.(pageNumber)
          return Promise.all([
            getBaseImageFromPage?.(page, thumbnailScale) ??
              Promise.resolve(undefined),
            getPageContentEntries(page),
            Promise.resolve(thumbnailScale),
            Promise.resolve(pageUsesFlowLayout(page)),
            Promise.resolve(
              Array.isArray(page.paragraphs) ? page.paragraphs : []
            )
          ])
        })
        .then(
          ([baseImage, content, thumbnailScale, useFlowLayout, paragraphs]) => {
            // stale 守卫：unmount / document 切换 / generation 过期
            if (
              !isMountedRef.current ||
              activeDocumentRef.current !== document ||
              generationRef.current !== generation ||
              pageRequestEpochRef.current.get(pageNumber) !== requestEpoch ||
              !currentRangePageNumbersRef.current.includes(pageNumber)
            ) {
              return
            }

            const texts = content.filter(isIntermediateText)
            const images = isIntermediateImage
              ? content.filter(isIntermediateImage)
              : []
            callbacksRef.current.onPageLoaded({
              pageNumber,
              useFlowLayout,
              baseImage,
              thumbnailScale,
              texts,
              paragraphs,
              images,
              content
            })
          }
        )
        .catch(() => {
          if (
            !isMountedRef.current ||
            activeDocumentRef.current !== document ||
            generationRef.current !== generation ||
            pageRequestEpochRef.current.get(pageNumber) !== requestEpoch ||
            !currentRangePageNumbersRef.current.includes(pageNumber)
          ) {
            return
          }
          callbacksRef.current.onPageError(pageNumber)
        })
        .finally(() => {
          physicalInFlightPagesRef.current.delete(pageNumber)
          // 清除在途标记（仅当仍在同一 generation）
          if (
            generationRef.current === generation &&
            pageRequestEpochRef.current.get(pageNumber) === requestEpoch
          ) {
            loadingPagesRef.current.delete(pageNumber)
            lazyInFlightPagesRef.current.delete(pageNumber)
          }
          // 尝试启动队列中下一个页码（保持并发满载）
          // 使用 microtask 延迟以避免在 finally 中同步触发新加载
          // 导致 React 批处理问题。
          queueMicrotask(() => {
            if (!isMountedRef.current || !activeDocumentRef.current) return
            pumpQueueRef.current(generationRef.current)
          })
        })
      // 注意：startPageLoad 内部不直接 pump；由调用方 pumpQueue 驱动
    },
    [
      activeDocumentRef,
      isMountedRef,
      loadingPagesRef,
      mode,
      getBaseImageFromPage,
      getPageContentEntries,
      isIntermediateText,
      isIntermediateImage,
      getThumbnailScale
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
      if (!activeDocumentRef.current) {
        return
      }

      const concurrency = configRef.current.pageLoadConcurrency
      while (physicalInFlightPagesRef.current.size < concurrency) {
        const pageNumber = dequeueNextLoadable()
        if (pageNumber === undefined) {
          break
        }
        startPageLoad(pageNumber, generation)
      }
    },
    [configRef, activeDocumentRef, dequeueNextLoadable, startPageLoad]
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
      if (!hasRuntimeDocument) {
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
          !callbacksRef.current.isPageLoaded(pageNumber) &&
          !loadingPagesRef.current.has(pageNumber) &&
          !queuedPageNumbersRef.current.includes(pageNumber)
        ) {
          queuedPageNumbersRef.current.push(pageNumber)
        }
      }

      pumpQueue(generationRef.current)
    },
    [configRef, hasRuntimeDocument, loadingPagesRef, pumpQueue]
  )

  /**
   * 入队单个页码（例如由可见性观察器在 500ms 防抖后触发）。
   * 当前阶段仅暴露 API，实际可见性触发在后续任务实现。
   */
  const enqueuePage = useCallback(
    (pageNumber: number) => {
      if (!hasRuntimeDocument) {
        return
      }
      // 页码不在当前 range → 忽略
      if (!currentRangePageNumbersRef.current.includes(pageNumber)) {
        return
      }
      // 去重
      if (callbacksRef.current.isPageLoaded(pageNumber)) {
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
    [hasRuntimeDocument, loadingPagesRef, pumpQueue]
  )

  const replaceRequiredPages = useCallback(
    (pageNumbers: readonly number[]) => {
      const requiredPages = [...new Set(pageNumbers)]
      const requiredPageSet = new Set(requiredPages)
      currentRangePageNumbersRef.current = requiredPages
      queuedPageNumbersRef.current = queuedPageNumbersRef.current.filter(
        (pageNumber) => requiredPageSet.has(pageNumber)
      )
      lazyInFlightPagesRef.current.forEach((pageNumber) => {
        if (requiredPageSet.has(pageNumber)) return
        pageRequestEpochRef.current.set(
          pageNumber,
          (pageRequestEpochRef.current.get(pageNumber) ?? 0) + 1
        )
        lazyInFlightPagesRef.current.delete(pageNumber)
        loadingPagesRef.current.delete(pageNumber)
      })
      pumpQueue(generationRef.current)
    },
    [loadingPagesRef, pumpQueue]
  )

  /**
   * 清空队列并使在途结果失效。
   * 递增 generation token，使所有在途 promise 的 resolve 被忽略。
   */
  const cancelAll = useCallback(() => {
    queuedPageNumbersRef.current = []
    generationRef.current += 1
    // 清除懒队列自己写入的在途标记。
    lazyInFlightPagesRef.current.forEach((pageNumber) => {
      loadingPagesRef.current.delete(pageNumber)
    })
    lazyInFlightPagesRef.current.clear()
    pageRequestEpochRef.current.clear()
  }, [loadingPagesRef])

  // document identity 变化时自动 cancelAll。
  useEffect(() => {
    if (previousRuntimeDocumentRef.current === runtimeDocument) {
      return
    }
    previousRuntimeDocumentRef.current = runtimeDocument
    cancelAll()
  }, [runtimeDocument, cancelAll])

  // unmount 时清空队列
  useEffect(() => {
    const lazyInFlightPages = lazyInFlightPagesRef.current
    const loadingPages = loadingPagesRef.current
    return () => {
      queuedPageNumbersRef.current = []
      generationRef.current += 1
      lazyInFlightPages.forEach((pageNumber) => {
        loadingPages.delete(pageNumber)
      })
      lazyInFlightPages.clear()
      pageRequestEpochRef.current.clear()
    }
  }, [loadingPagesRef])

  return { enqueueInitialPages, enqueuePage, replaceRequiredPages, cancelAll }
}
