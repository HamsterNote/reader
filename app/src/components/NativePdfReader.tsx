import type { IntermediateText } from '@hamster-note/types'
import type { ReaderData, ReaderEdgeCrop } from '../../../src/types/readerData'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { WebView } from 'react-native-webview'
import { randomUUID } from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import { ReaderPdfView, readerPdfModule } from '../../modules/reader-pdf'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../../src/host/readerDataStore'
import type {
  PdfCommand,
  PdfEvent,
  PdfIdentity,
  PdfTool
} from '../../../src/nativePdf/contracts'
import {
  createNativeAnnotationController,
  nativeAnnotationControllerStore,
  type NativeAnnotationSnapshot
} from '../../../src/nativePdf/annotationController'
import {
  nativeRectCommit,
  withNativeAnnotationData
} from '../../../src/nativePdf/drawing'
import {
  appendStrokeDocument,
  inkObjectsForNative,
  NATIVE_STROKE_COLOR,
  NATIVE_STROKE_WIDTH,
  paintingPageId
} from '../../../src/nativePdf/strokes'
import { restoreReaderSnapshot } from '../../../src/host/readerSnapshot'
import { NativePdfSession } from '../../../src/nativePdf/session'
import { NativePdfControls } from './NativePdfControls'
import { logNativePdfDiagnostic } from '../../../src/nativePdf/diagnostics'
import { NativeCanonicalDelivery } from '../../../src/nativePdf/canonicalDelivery'
import { nativeSelectionConfiguration } from '../../../src/nativePdf/selection'
import { reduceNativeMenu } from '../../../src/nativePdf/menuOwnership'
import { visibleOriginalPages } from '../../../src/nativePdf/geometry'
import {
  nativeLayoutProgress,
  nativeLayoutProgressFromGeometry,
  nativeProgressKey,
  readerDataFromNativeSnapshot,
  withNativeLayoutProgress,
  withNativeRenderMode,
  withNativeOcrTexts
} from '../../../src/nativePdf/hostProgress'
import type { ReaderWebViewHandle } from './ReaderWebView'
import type {
  ReaderExtraOcr,
  ReaderOcrOptions
} from '../../../src/types/readerOcr'
import {
  fetchOcrContent,
  prefixOcrTextIds
} from '../../../src/components/IntermediateDocumentViewer/ocrContent'
import {
  canRetryNativeOcrPage,
  nativeCanonicalPageFromOcr,
  nativeOcrSessionKey,
  shouldRequestNativeOcr,
  type NativeOcrPageAvailability
} from '../../../src/nativePdf/ocr'
import { NativeOperationQueue } from '../../../src/nativePdf/persistence'
import {
  applyNativePageEditOperation,
  createNativePageEditOperation,
  createNativePageEditUndo,
  nativeHiddenPageNumbers,
  nativePageEditGroups,
  mergeNativeExternalData,
  restoreNativePageEditFields,
  type NativePageEditOperation,
  type NativePageEditUndo,
  withNativePageEditData
} from '../../../src/nativePdf/pageEdit'
import {
  nativePdfErrorMessage,
  shouldReplaceNativePdfError
} from '../../../src/nativePdf/errors'

function nativeIdentityFor(fileId: string): PdfIdentity {
  return {
    fileId,
    paneId: 'development',
    sessionId: randomUUID(),
    generation: 1
  }
}

function resolveNativeIdentity(
  handoff: NativePdfHandoff | undefined,
  generated: PdfIdentity
): PdfIdentity {
  return handoff?.identity ?? generated
}

function nativeAnnotationScope(
  handoff: NativePdfHandoff | undefined,
  store: ReaderDataStore
) {
  return handoff ? store : undefined
}

function nativeEditingReady(
  snapshotReady: boolean,
  handoff: NativePdfHandoff | undefined,
  identity: PdfIdentity,
  closed: boolean
): boolean {
  return snapshotReady && (handoff?.canWrite(identity) ?? true) && !closed
}

function isReaderFileUrl(url: string, root: string): boolean {
  try {
    const candidate = decodeURI(url)
    const base = decodeURI(root).replace(/\/$/, '')
    return candidate.startsWith(`${base}/`)
  } catch {
    return url.startsWith(root)
  }
}

function refillNativeCanonical(
  delivery: NativeCanonicalDelivery,
  sender: PdfIdentity,
  requested: readonly number[],
  snapshotData: unknown,
  progressData: unknown,
  pageMetrics: ReadonlyMap<number, { width: number; height: number }>
): number[] {
  delivery.refill(sender, requested)
  const cachedTexts = readerDataFromNativeSnapshot(
    snapshotData,
    progressData
  )?.ocrTexts
  const needsGeometry: number[] = []
  for (const pageNumber of new Set(requested)) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) continue
    const texts = cachedTexts?.[pageNumber]
    if (!texts) continue
    const metrics = pageMetrics.get(pageNumber)
    if (!metrics) {
      needsGeometry.push(pageNumber)
      continue
    }
    const canonical = nativeCanonicalPageFromOcr(
      pageNumber,
      metrics.width,
      metrics.height,
      texts
    )
    if (canonical) delivery.publish(canonical)
  }
  return needsGeometry.sort((a, b) => b - a)
}

function syncNativeWebAnnotations(
  data: unknown,
  annotations: ReturnType<typeof createNativeAnnotationController>,
  mirrorAnnotations: (snapshot: NativeAnnotationSnapshot) => void,
  setStatus: (status: string) => void
): boolean {
  try {
    const restored = restoreReaderSnapshot(data)
    const current = annotations.getSnapshot()
    annotations.replaceSnapshot(
      {
        ranges: restored.data.ranges ?? [],
        rects: [...current.rects],
        pagePaintings: current.pagePaintings
      },
      { preserveHistory: true }
    )
    mirrorAnnotations(annotations.getSnapshot())
    return true
  } catch (error) {
    setStatus(
      `标注同步失败：${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}

function toggleHiddenPageGroup(
  current: readonly number[],
  pages: readonly number[],
  selected: boolean
): number[] {
  if (selected)
    return current.filter((pageNumber) => !pages.includes(pageNumber))
  return [...new Set([...current, ...pages])].sort((a, b) => a - b)
}

type NativePdfMessageContext = {
  identity: PdfIdentity
  guard: NativePdfSession
  canonicalDelivery: NativeCanonicalDelivery
  refillCanonical: (sender: PdfIdentity, requested: readonly number[]) => void
  enqueue: (command: PdfCommand) => void
  canSubmit: () => boolean
  syncWebEditing: () => void
  rejectWebEdit: () => void
  isWebEditRejected: () => boolean
  setOutline: (items: { title: string; pageNumber: number }[]) => void
  setPanelOpen: (open: boolean) => void
  setMenuWithSource: (
    value: { left: number; top: number } | null,
    source: string
  ) => void
  menuFrame: (anchor: {
    x: number
    y: number
    width: number
    height: number
  }) => { left: number; top: number }
  setRanges: (items: { id: string; text: string }[]) => void
  saveWebSnapshot: (message: Record<string, unknown>) => void
  post: (body: Record<string, unknown>) => unknown
  nativeError: { current: { code: string; message?: string } | null }
  setStatus: (status: string) => void
}

function handleNativePdfControlMessage(
  m: Record<string, unknown>,
  context: NativePdfMessageContext
): boolean {
  const {
    identity,
    canonicalDelivery,
    refillCanonical,
    enqueue,
    setOutline,
    setPanelOpen,
    setMenuWithSource,
    setRanges,
    saveWebSnapshot
  } = context
  switch (m.type) {
    case 'web-ready':
      logNativePdfDiagnostic('reader-pdf-web-ready', {
        ...identity,
        role: 'canonical-popover-service',
        renderer: 'pdfkit'
      })
      canonicalDelivery.webReady(identity)
      context.syncWebEditing()
      return true
    case 'canonical-request':
      if (Array.isArray(m.pages)) {
        const pages = m.pages.filter(
          (n): n is number =>
            typeof n === 'number' && Number.isInteger(n) && n > 0
        )
        console.info('reader-pdf-canonical-refill', {
          sessionId: identity.sessionId,
          pages
        })
        refillCanonical(identity, pages)
      }
      return true
    case 'outline':
      setOutline(m.items as { title: string; pageNumber: number }[])
      return true
    case 'panel':
      setPanelOpen(true)
      setMenuWithSource({ left: 0, top: 0 }, 'web-panel')
      return true
    case 'serviceReady':
      return true
    case 'command': {
      const command = m.command as PdfCommand
      if (!context.guard.accepts(command)) return true
      if (command.type === 'selection' && context.isWebEditRejected())
        return true
      if (
        !['navigate', 'scale', 'preview', 'text', 'selection'].includes(
          command.type
        ) &&
        !context.canSubmit()
      ) {
        context.rejectWebEdit()
        return true
      }
      enqueue(command)
      return true
    }
    case 'ranges':
      if (!context.canSubmit()) {
        context.rejectWebEdit()
        return true
      }
      setRanges(m.items as { id: string; text: string }[])
      return true
    case 'edit-rejected':
      context.rejectWebEdit()
      return true
    case 'snapshot':
      saveWebSnapshot(m)
      return true
    default:
      return false
  }
}

function handleNativePdfNavigationMessage(
  m: Record<string, unknown>,
  context: NativePdfMessageContext
): void {
  const {
    setPanelOpen,
    setMenuWithSource,
    menuFrame,
    post,
    nativeError,
    setStatus
  } = context
  switch (m.type) {
    case 'navigateRange':
      post({ type: 'navigateRange', rangeId: m.rangeId })
      break
    case 'menu': {
      setPanelOpen(false)
      const anchor = m.anchor as {
        x: number
        y: number
        width: number
        height: number
      }
      setMenuWithSource(menuFrame(anchor), 'web-menu')
      break
    }
    case 'hideMenu':
      setPanelOpen(false)
      setMenuWithSource(null, 'web-hide-menu')
      break
    case 'nativeSelectionConsumed':
      setMenuWithSource(null, 'native-selection-consumed')
      break
    case 'failure':
      if (nativeError.current === null) setStatus(`规范文本：${String(m.code)}`)
      break
    case 'external':
      if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url))
        Linking.openURL(m.url).catch(() => setStatus('无法打开外链'))
      break
  }
}

function handleNativePdfMessage(
  m: Record<string, unknown>,
  context: NativePdfMessageContext
): void {
  if (!context.guard.accepts(m as unknown as PdfIdentity)) return
  if (!handleNativePdfControlMessage(m, context))
    handleNativePdfNavigationMessage(m, context)
}

type NativeOcrRuntime = {
  fileId: string
  extraOCR?: ReaderExtraOcr
  pageMetrics: Map<number, { width: number; height: number }>
  canonicalDelivery: NativeCanonicalDelivery
  enqueue: (
    body:
      | Omit<
          PdfCommand,
          'fileId' | 'paneId' | 'sessionId' | 'generation' | 'requestId'
        >
      | Record<string, unknown>
  ) => string
  persist: (
    transform: (snapshot: HostDocumentRecord['snapshot']) => unknown
  ) => void
  onOcrTextsChange?: (pageNumber: number, texts: IntermediateText[]) => void
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  ocrEpoch: { current: number }
  ocrFailed: Set<string>
  ocrError: { current: { code: string; message?: string } | null }
  setStatus: (status: string) => void
  closed: { current: boolean }
  ocrInFlight: Set<string>
  ocrEnabled: boolean
  manualOcrPages?: readonly number[]
  pageCountRef: { current: number }
  ocrCached: Set<string>
  ocrCompleted: Set<string>
  ocrRequests: Map<string, number>
}

async function performNativeOcr(
  pageNumber: number,
  uri: string,
  epoch: number,
  context: NativeOcrRuntime
): Promise<void> {
  const key = nativeOcrSessionKey(context.fileId, pageNumber)
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    })
    if (epoch !== context.ocrEpoch.current || context.closed.current) return
    const content = await fetchOcrContent(
      `data:image/png;base64,${base64}`,
      context.extraOCR
    )
    if (epoch !== context.ocrEpoch.current || context.closed.current) return
    const texts = prefixOcrTextIds(
      content.filter(
        (value): value is IntermediateText =>
          typeof value === 'object' &&
          value !== null &&
          'content' in value &&
          typeof value.content === 'string' &&
          'polygon' in value &&
          Array.isArray(value.polygon)
      ),
      pageNumber
    )
    const metrics = context.pageMetrics.get(pageNumber)
    const canonical = metrics
      ? nativeCanonicalPageFromOcr(
          pageNumber,
          metrics.width,
          metrics.height,
          texts
        )
      : null
    if (!canonical) throw new Error(`OCR 未返回第 ${pageNumber} 页文字`)
    context.canonicalDelivery.publish(canonical)
    context.enqueue({
      type: 'text',
      pages: [canonical],
      retain: [pageNumber],
      source: 'ocr'
    })
    context.persist((snapshot) =>
      withNativeOcrTexts(snapshot.data, pageNumber, texts)
    )
    context.onOcrTextsChange?.(pageNumber, texts)
    context.ocrCompleted.add(key)
  } catch (error) {
    if (epoch === context.ocrEpoch.current && !context.closed.current) {
      context.ocrFailed.add(key)
      context.ocrError.current = {
        code: 'OCR_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
      context.setStatus(
        `原生 OCR [${pageNumber}]：${error instanceof Error ? error.message : String(error)}`
      )
      context.onOcrError?.(error, { pageNumber })
    }
  } finally {
    if (epoch === context.ocrEpoch.current) context.ocrInFlight.delete(key)
  }
}

function requestNativeOcrPages(
  context: NativeOcrRuntime,
  pagesToCheck: readonly number[],
  availability: Readonly<Record<number, NativeOcrPageAvailability>>
): void {
  if (!context.ocrEnabled) return
  for (const pageNumber of pagesToCheck) {
    if (context.manualOcrPages && !context.manualOcrPages.includes(pageNumber))
      continue
    if (
      !shouldRequestNativeOcr(
        true,
        pageNumber,
        availability,
        context.pageCountRef.current
      )
    )
      continue
    const key = nativeOcrSessionKey(context.fileId, pageNumber)
    if (context.ocrCached.has(key)) continue
    if (
      !canRetryNativeOcrPage(
        key,
        context.ocrInFlight,
        context.ocrCompleted,
        context.ocrFailed
      )
    )
      continue
    context.ocrInFlight.add(key)
    const requestId = context.enqueue({
      type: 'preview',
      pageNumber,
      width: 160
    } as PdfCommand)
    context.ocrRequests.set(requestId, pageNumber)
  }
}

export type NativePdfHandoff = {
  readonly identity: PdfIdentity
  readonly refreshToken: number
  readonly canWrite: (identity: PdfIdentity) => boolean
  readonly assertWriter: (identity: PdfIdentity) => void
  readonly leaseEpoch: () => number
  readonly onAuthoritativeSnapshot: (
    identity: PdfIdentity,
    snapshot: HostDocumentRecord['snapshot']
  ) => boolean
  readonly onOperationConfirmed: () => void
}

type NativeSaveResult = {
  readonly snapshot: HostDocumentRecord['snapshot']
  readonly layout?: ReaderData
  readonly pageEditUndo?: NativePageEditUndo
  readonly clearPageEditUndo?: boolean
}

type Props = {
  record: HostDocumentRecord
  store: ReaderDataStore
  entryUrl: string
  publicationUrl: string
  baseUrl: string
  handoff?: NativePdfHandoff
  isActivePane?: boolean
  persistLayoutMode?: boolean
  ocr?: boolean | ReaderOcrOptions
  extraOCR?: ReaderExtraOcr
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  onOcrTextsChange?: (pageNumber: number, texts: IntermediateText[]) => void
}
/** iOS local PDF Layout, with Web retained for canonical text and popovers. */
export const NativePdfReader = forwardRef<ReaderWebViewHandle, Props>(
  function NativePdfReader(
    {
      record,
      store,
      entryUrl,
      publicationUrl,
      baseUrl,
      handoff,
      isActivePane = true,
      persistLayoutMode = false,
      ocr,
      extraOCR,
      onOcrError,
      onOcrTextsChange
    },
    ref
  ) {
    const generatedIdentity = useMemo(
      () => nativeIdentityFor(record.fileId),
      [record.fileId]
    )
    const identity = resolveNativeIdentity(handoff, generatedIdentity)
    const guard = useMemo(() => new NativePdfSession(identity), [identity])
    const annotationScope = nativeAnnotationScope(handoff, store)
    const annotations = useMemo(
      () =>
        nativeAnnotationControllerStore.get(
          record.fileId,
          undefined,
          annotationScope,
          identity.paneId
        ),
      [record.fileId, annotationScope, identity.paneId]
    )
    const annotationCommits = useRef(0)
    const [tool, setTool] = useState<PdfTool>('none')
    const [ink, setInk] = useState({
      color: NATIVE_STROKE_COLOR,
      width: NATIVE_STROKE_WIDTH
    })
    const web = useRef<WebView>(null)
    const webDisposed = useRef(false)
    const [command, setCommand] = useState<PdfCommand | null>(null)
    const queue = useRef<PdfCommand[]>([])
    const inFlight = useRef<PdfCommand | null>(null)
    const counter = useRef(0)
    const [status, setStatus] = useState('正在加载原生 PDF…')
    const [webError, setWebError] = useState<string | null>(null)
    const [panelOpen, setPanelOpen] = useState(false)
    const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
    const menuOwner = useRef<'native' | 'web' | null>(null)
    const [size, setSize] = useState({ width: 0, height: 0 })
    const [allowedPages, setAllowedPages] = useState<number[]>([])
    const [nativeTop, setNativeTop] = useState(0)
    const [nativeViewportHeight, setNativeViewportHeight] = useState(0)
    const [pageCount, setPageCount] = useState(0)
    const pageCountRef = useRef(0)
    const [page, setPage] = useState(1)
    const [outline, setOutline] = useState<
      { title: string; pageNumber: number }[]
    >([])
    const [rangesOpen, setRangesOpen] = useState(false)
    const [ranges, setRanges] = useState<{ id: string; text: string }[]>([])
    const [outlineOpen, setOutlineOpen] = useState(false)
    const [preview, setPreview] = useState<string | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [snapshotReady, setSnapshotReady] = useState(false)
    const [authoritativeFailed, setAuthoritativeFailed] = useState(false)
    const [recoveryRetry, setRecoveryRetry] = useState(0)
    const [editOpen, setEditOpen] = useState(false)
    const [draftHiddenPages, setDraftHiddenPages] = useState<number[]>([])
    const [draftCrop, setDraftCrop] = useState<ReaderEdgeCrop>({})
    const pageEditBase = useRef<Pick<
      ReaderData,
      'hiddenPages' | 'edgeCrop'
    > | null>(null)
    const [hiddenPagesUndo, setHiddenPagesUndo] =
      useState<NativePageEditUndo | null>(null)
    const [internalOcrEnabled, setInternalOcrEnabled] = useState(false)
    const ocrEnabled =
      ocr === true ||
      (typeof ocr === 'object' && ocr !== null && ocr.enabled === true) ||
      (ocr === undefined && internalOcrEnabled)
    const manualOcrPages =
      typeof ocr === 'object' && ocr !== null && Array.isArray(ocr.pages)
        ? ocr.pages
        : undefined
    const latest = useRef(record.snapshot)
    const handoffRef = useRef(handoff)
    handoffRef.current = handoff
    const authoritativeReady = useRef(false)
    const webEditRejected = useRef(false)
    const committed = useRef(new Set<string>())
    const alive = useRef(true)
    const closed = useRef(false)
    const lastNativeProgress = useRef<string | null>(null)
    const activePane = useRef(isActivePane)
    activePane.current = isActivePane
    useEffect(() => {
      lastNativeProgress.current = null
    }, [isActivePane])
    const layoutModeWritten = useRef(false)
    const ocrRequests = useRef(new Map<string, number>())
    const ocrInFlight = useRef(new Set<string>())
    const ocrCompleted = useRef(new Set<string>())
    const ocrCached = useRef(new Set<string>())
    const ocrFailed = useRef(new Set<string>())
    const ocrEpoch = useRef(0)
    const nativeError = useRef<{ code: string; message?: string } | null>(null)
    const ocrError = useRef<{ code: string; message?: string } | null>(null)
    const pageMetrics = useRef(
      new Map<number, { width: number; height: number }>()
    )
    const previousOcrEnabled = useRef(ocrEnabled)
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const saveQueueRef = useRef<NativeOperationQueue<NativeSaveResult> | null>(
      null
    )
    if (saveQueueRef.current === null) {
      saveQueueRef.current = new NativeOperationQueue<NativeSaveResult>({
        onConfirmed: (_operation, result) => confirmNativeSave(result),
        onFailed: (_operation, error) => {
          if (alive.current) {
            setSaveError(error instanceof Error ? error.message : '保存失败')
          }
        }
      })
    }
    const saveQueue = saveQueueRef.current
    function pump() {
      if (!inFlight.current && queue.current.length) {
        inFlight.current = queue.current.shift()!
        setCommand(inFlight.current)
      }
    }
    function enqueue(
      body:
        | Omit<
            PdfCommand,
            'fileId' | 'paneId' | 'sessionId' | 'generation' | 'requestId'
          >
        | Record<string, unknown>
    ): string {
      const requestId = `host-${++counter.current}`
      queue.current.push({
        ...identity,
        ...body,
        requestId
      } as PdfCommand)
      pump()
      return requestId
    }
    const post = useCallback(
      (body: Record<string, unknown>) => {
        const alive = web.current !== null
        const event = body.event as
          | {
              type?: string
              start?: { offset?: number; selectionId?: string }
              end?: { offset?: number; selectionId?: string }
            }
          | undefined
        const payload = {
          type: body.type,
          eventType: event?.type,
          page: event?.start?.selectionId ?? event?.end?.selectionId,
          startOffset: event?.start?.offset,
          endOffset: event?.end?.offset
        }
        const message = JSON.stringify({ ...body, identity })
        const result = alive ? web.current?.postMessage(message) : undefined
        logNativePdfDiagnostic('reader-pdf-native-post', {
          alive,
          payload,
          result
        })
        return result
      },
      [identity]
    )
    const canonicalDelivery = useMemo(
      () =>
        new NativeCanonicalDelivery(identity, (canonicalPage) => {
          if (!web.current || webDisposed.current) return false
          post({ type: 'ocrText', canonicalPage })
          return true
        }),
      [identity, post]
    )
    function refillCanonical(
      sender: typeof identity,
      requested: readonly number[]
    ) {
      const needsGeometry = refillNativeCanonical(
        canonicalDelivery,
        sender,
        requested,
        latest.current.data,
        latest.current.progress,
        pageMetrics.current
      )
      // Navigating in reverse leaves the highlight's first page visible last.
      // Each geometry event then constructs that page's persisted OCR mapping.
      for (const pageNumber of needsGeometry)
        enqueue({ type: 'navigate', pageNumber })
    }
    function setMenuWithSource(
      value: { left: number; top: number } | null,
      source: string
    ) {
      const reduced = reduceNativeMenu(
        { owner: menuOwner.current, value: menu },
        { source, value }
      )
      if (reduced.ignored) {
        if (__DEV__)
          console.info('reader-pdf-menu-state', {
            source,
            value,
            ignored: 'native-owner'
          })
        return
      }
      menuOwner.current = reduced.state.owner
      if (__DEV__) console.info('reader-pdf-menu-state', { source, value })
      setMenu(value)
    }
    function menuFrame(anchor: {
      x: number
      y: number
      width: number
      height: number
    }) {
      const x = anchor.x + anchor.width / 2 - width / 2
      // anchor is in ReaderPdfView coordinates; nativeTop moves it into the
      // parent container. Prefer below the selection, then clamp to the host.
      const y = anchor.y + nativeTop + anchor.height
      return {
        left: Math.max(0, Math.min(size.width - width, x)),
        top: Math.max(0, Math.min(size.height - height, y))
      }
    }
    function disposeWebOnce() {
      canonicalDelivery.close()
      if (webDisposed.current) return
      webDisposed.current = true
      post({ type: 'dispose' })
    }
    function setAuthoritativeReady(ready: boolean) {
      authoritativeReady.current = ready
      setSnapshotReady(ready)
    }
    function canSubmit(): boolean {
      if (closed.current || !authoritativeReady.current) return false
      return handoffRef.current?.canWrite(identity) ?? true
    }
    function rejectNotReady(): false {
      setStatus('权威数据或写权尚未就绪（not-ready）')
      return false
    }
    function syncWebEditing() {
      post({
        type: 'editing-state',
        canEdit: canSubmit(),
        snapshot: latest.current.data,
        progress: latest.current.progress
      })
      const restored = restoreReaderSnapshot(
        latest.current.data,
        latest.current.progress
      )
      setRanges(
        (restored.data.ranges ?? []).map(({ id, text }) => ({ id, text }))
      )
    }
    function rejectWebEdit() {
      if (webEditRejected.current) return
      webEditRejected.current = true
      syncWebEditing()
      rehydrateAnnotations()
      enqueue({ type: 'selection', range: null })
      setMenuWithSource(null, 'native-edit-rejected')
      setPanelOpen(false)
      setStatus(
        '编辑未保存：权威数据或写权尚未就绪，已恢复已确认内容，请稍后重试'
      )
    }
    const webEditingReady = canSubmit()
    useEffect(() => {
      webEditRejected.current = false
      syncWebEditing()
    }, [webEditingReady, snapshotReady])
    function confirmNativeSave(result: NativeSaveResult) {
      latest.current = result.snapshot
      if (alive.current) {
        setSaveError(null)
        if (result.layout) layoutForReaderData(result.layout)
        if (result.clearPageEditUndo) {
          setHiddenPagesUndo(null)
          if (undoTimer.current) clearTimeout(undoTimer.current)
          undoTimer.current = null
        }
        if (result.pageEditUndo) {
          setHiddenPagesUndo(result.pageEditUndo)
          if (undoTimer.current) clearTimeout(undoTimer.current)
          undoTimer.current = setTimeout(() => {
            undoTimer.current = null
            setHiddenPagesUndo(null)
          }, 5000)
        }
        handoffRef.current?.onOperationConfirmed()
      }
    }
    function persist(
      transform: (snapshot: typeof record.snapshot) => unknown,
      options: {
        pageEdit?: NativePageEditOperation
        undoPageEdit?: NativePageEditUndo
        positionOnly?: boolean
      } = {}
    ): boolean {
      if (!canSubmit()) return rejectNotReady()
      saveQueue.add(
        options.pageEdit?.operationId ?? `save-${randomUUID()}`,
        async () => {
          let layout: ReaderData | undefined
          let pageEditUndo: NativePageEditUndo | undefined
          const next = await store.updateSnapshot(
            record.fileId,
            (base) => {
              handoffRef.current?.assertWriter(identity)
              // Focus may change while this waits behind another pane's write.
              if (options.positionOnly && !activePane.current) return base
              if (options.pageEdit || options.undoPageEdit) {
                const current =
                  readerDataFromNativeSnapshot(base.data, base.progress) ?? {}
                if (options.pageEdit) {
                  pageEditUndo = createNativePageEditUndo(
                    current,
                    options.pageEdit
                  )
                  layout = applyNativePageEditOperation(
                    current,
                    options.pageEdit
                  )
                } else if (options.undoPageEdit) {
                  layout = restoreNativePageEditFields(
                    current,
                    options.undoPageEdit
                  )
                }
                return {
                  ...base,
                  data: withNativePageEditData(base.data, layout ?? current),
                  revision: base.revision + 1
                }
              }
              return {
                ...base,
                data: transform(base),
                revision: base.revision + 1
              }
            },
            () => handoffRef.current?.assertWriter(identity)
          )
          return {
            snapshot: next,
            layout,
            pageEditUndo,
            clearPageEditUndo: options.undoPageEdit !== undefined
          }
        }
      )
      return true
    }
    function mirrorAnnotations(snapshot: NativeAnnotationSnapshot) {
      enqueue({
        type: 'annotations',
        ranges: snapshot.ranges,
        rects: snapshot.rects
      })
      enqueue({
        type: 'ink',
        objects: inkObjectsForNative(snapshot.pagePaintings)
      })
    }
    /** Only the annotation container is owned here; the patch reads the newest base. */
    function saveAnnotations(snapshot: NativeAnnotationSnapshot): boolean {
      return persist((base) => withNativeAnnotationData(base.data, snapshot))
    }
    function rehydrateAnnotations() {
      try {
        // The V5 container is the authoritative annotation read path.
        const restored = restoreReaderSnapshot(
          latest.current.data,
          latest.current.progress
        )
        annotations.replaceSnapshot(restored.data, { preserveHistory: true })
      } catch (error) {
        setStatus(
          `标注读取失败：${error instanceof Error ? error.message : String(error)}`
        )
        return
      }
      mirrorAnnotations(annotations.getSnapshot())
    }
    function syncWebAnnotations(data: unknown): boolean {
      return syncNativeWebAnnotations(
        data,
        annotations,
        mirrorAnnotations,
        setStatus
      )
    }
    function saveWebSnapshot(message: Record<string, unknown>) {
      if (!canSubmit()) {
        rejectWebEdit()
        return
      }
      const commitId = message.commitId
      if (typeof commitId !== 'string' || committed.current.has(commitId))
        return
      if (!syncWebAnnotations(message.data)) return
      committed.current.add(commitId)
      persist((snapshot) =>
        mergeNativeExternalData(snapshot.data, message.data)
      )
    }
    function selectTool(next: PdfTool) {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      setTool(next)
      enqueue({ type: 'tool', tool: next })
      enqueue({ type: 'inkStyle', color: ink.color, width: ink.width })
    }
    /** Brush used for new strokes; the persisted object keeps the same style. */
    function selectInk(next: { color?: string; width?: number }) {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      const value = {
        color: next.color ?? ink.color,
        width: next.width ?? ink.width
      }
      setInk(value)
      enqueue({ type: 'inkStyle', ...value })
    }
    function nextAnnotationCommitId(kind: 'rect' | 'stroke' | 'clear'): string {
      return `${kind}-${Date.now()}-${randomUUID()}-${++annotationCommits.current}`
    }
    /** Native gesture → existing 4.x annotation controller → V5 snapshot. */
    function commitNativeRect(event: Extract<PdfEvent, { type: 'rect' }>) {
      const commit = nativeRectCommit(event, nextAnnotationCommitId('rect'))
      if (!commit) return
      const result = annotations.apply(commit)
      if (result.status !== 'changed') return
      mirrorAnnotations(result.snapshot)
      saveAnnotations(result.snapshot)
    }
    function undoNativeDrawing() {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      if (!annotations.undo()) {
        setStatus('没有可撤销的标注')
        return
      }
      const snapshot = annotations.getSnapshot()
      mirrorAnnotations(snapshot)
      if (saveAnnotations(snapshot)) setStatus('已撤销上一步标注')
    }
    function redoNativeDrawing() {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      if (!annotations.redo()) {
        setStatus('没有可重做的标注')
        return
      }
      const snapshot = annotations.getSnapshot()
      mirrorAnnotations(snapshot)
      if (saveAnnotations(snapshot)) setStatus('已重做上一步标注')
    }
    /** Native freehand stroke → existing control layer → V5 snapshot. */
    function commitNativeStroke(event: Extract<PdfEvent, { type: 'stroke' }>) {
      if (event.phase !== 'commit') return
      const commitId = nextAnnotationCommitId('stroke')
      const pageId = paintingPageId(event.pageNumber)
      const document = appendStrokeDocument(
        annotations.getSnapshot().pagePaintings[pageId],
        commitId,
        event.points,
        { color: ink.color, width: ink.width }
      )
      if (!document) {
        setStatus('笔迹未保存：点数不足或文档校验失败')
        return
      }
      const result = annotations.setPainting(commitId, pageId, document)
      if (result.status !== 'changed') return
      mirrorAnnotations(result.snapshot)
      saveAnnotations(result.snapshot)
    }
    /** In-progress gestures stay native; only finished ones reach the controller. */
    function handleDrawEvent(
      event: Extract<PdfEvent, { type: 'rect' } | { type: 'stroke' }>
    ) {
      if (event.phase !== 'commit') return
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      if (event.type === 'rect') commitNativeRect(event)
      else commitNativeStroke(event)
    }
    function clearCurrentPageInk() {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      const pageId = paintingPageId(page)
      if (!annotations.getSnapshot().pagePaintings[pageId]) {
        setStatus('当前页没有笔迹')
        return
      }
      const result = annotations.clearPainting(
        nextAnnotationCommitId('clear'),
        pageId
      )
      if (result.status !== 'changed') return
      mirrorAnnotations(result.snapshot)
      if (saveAnnotations(result.snapshot)) setStatus('已清空当前页笔迹')
    }
    function readerDataSnapshot(): ReaderData {
      return (
        readerDataFromNativeSnapshot(
          latest.current.data,
          latest.current.progress
        ) ?? {}
      )
    }
    function layoutForReaderData(data: ReaderData) {
      const count = pageCountRef.current
      const allowed = visibleOriginalPages(count, data.hiddenPages ?? [])
      const crop = data.edgeCrop
      const crops = Object.fromEntries(
        allowed.map((n) => [
          String(n),
          crop?.pages?.[`page-${n}`] ??
            crop?.pages?.[String(n)] ??
            crop?.all ??
            {}
        ])
      )
      setAllowedPages(allowed)
      if (count > 0) enqueue({ type: 'layout', pages: allowed, crops })
    }
    function beginPageEdit() {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      const data = readerDataSnapshot()
      pageEditBase.current = {
        hiddenPages: data.hiddenPages ? [...data.hiddenPages] : undefined,
        edgeCrop: data.edgeCrop
      }
      setDraftHiddenPages(nativeHiddenPageNumbers(data.hiddenPages))
      setDraftCrop({ ...(data.edgeCrop?.all ?? {}) })
      setEditOpen(true)
    }
    function commitPageEdit() {
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      const previous = pageEditBase.current ?? readerDataSnapshot()
      const operation = createNativePageEditOperation({
        operationId: `page-${Date.now()}-${randomUUID()}`,
        identity,
        leaseEpoch: handoffRef.current?.leaseEpoch() ?? 0,
        baseRevision: latest.current.revision,
        base: previous,
        draftHiddenPages,
        draftCrop
      })
      if (!operation.dirty.hiddenPages && !operation.dirty.cropAll) {
        setEditOpen(false)
        return
      }
      if (persist((snapshot) => snapshot.data, { pageEdit: operation })) {
        setEditOpen(false)
      }
    }
    function undoPageEdit() {
      const undo = hiddenPagesUndo
      if (!undo) return
      if (!canSubmit()) {
        rejectNotReady()
        return
      }
      persist((snapshot) => snapshot.data, { undoPageEdit: undo })
    }
    useImperativeHandle(ref, () => ({
      setRenderMode: (mode) =>
        persist((snapshot) => withNativeRenderMode(snapshot.data, mode)),
      close: async (options?: { retry?: boolean }) => {
        if (closed.current) return { status: 'closed' }
        if (options?.retry) saveQueue.retry()?.catch(() => undefined)
        ocrEpoch.current += 1
        ocrRequests.current.clear()
        ocrInFlight.current.clear()
        ocrCached.current.clear()
        if (undoTimer.current) clearTimeout(undoTimer.current)
        enqueue({ type: 'cancel' })
        post({ type: 'dismiss' })
        setMenuWithSource(null, 'close')
        try {
          await saveQueue.drain()
          if (saveQueue.pending !== 0)
            return { status: 'unconfirmed', reason: '原生编辑尚未保存，请重试' }
          closed.current = true
          disposeWebOnce()
          enqueue({ type: 'close' })
          guard.close()
          return { status: 'closed' }
        } catch {
          return { status: 'unconfirmed', reason: '原生高亮保存失败，请重试' }
        }
      }
    }))
    useEffect(() => {
      alive.current = true
      closed.current = false
      webDisposed.current = false
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          enqueue({ type: 'cancel' })
          post({ type: 'dismiss' })
          setMenuWithSource(null, 'app-state')
        }
      })
      return () => {
        alive.current = false
        closed.current = true
        ocrEpoch.current += 1
        ocrRequests.current.clear()
        if (undoTimer.current) clearTimeout(undoTimer.current)
        subscription.remove()
        disposeWebOnce()
        guard.close()
      }
    }, [guard])
    useEffect(() => {
      if (previousOcrEnabled.current === ocrEnabled) return
      previousOcrEnabled.current = ocrEnabled
      ocrEpoch.current += 1
      ocrRequests.current.clear()
      ocrInFlight.current.clear()
      ocrCached.current.clear()
      ocrFailed.current.clear()
      ocrError.current = null
      canonicalDelivery.clear()
      if (!ocrEnabled) {
        ocrCompleted.current.clear()
        enqueue({
          type: 'text',
          pages: [],
          retain: [],
          source: 'ocr-disabled',
          clear: true
        })
      }
    }, [ocrEnabled])
    useEffect(() => {
      closed.current = false
      nativeError.current = null
      enqueue({
        type: 'open',
        source: { fileId: record.fileId, localUri: publicationUrl }
      })
    }, [publicationUrl, record.fileId])
    useEffect(() => {
      let active = true
      setAuthoritativeReady(false)
      const load = async () => {
        try {
          const persisted = await store.get(record.fileId)
          if (!active) return
          const snapshot = persisted?.snapshot ?? record.snapshot
          latest.current = snapshot
          if (pageCountRef.current > 0) {
            layoutForReaderData(readerDataSnapshot())
            rehydrateAnnotations()
          }
          const granted = handoffRef.current
            ? handoffRef.current.onAuthoritativeSnapshot(identity, snapshot)
            : true
          setAuthoritativeReady(granted)
          setAuthoritativeFailed(false)
          if (!granted) setStatus('PDFKit 可读；等待旧 Web 保存与写权交接')
        } catch (error) {
          if (!active) return
          setAuthoritativeReady(false)
          setAuthoritativeFailed(true)
          setStatus(
            `权威数据读取失败：${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      void load()
      return () => {
        active = false
      }
    }, [
      store,
      record.fileId,
      record.snapshot,
      handoff?.refreshToken,
      recoveryRetry,
      identity
    ])
    useEffect(() => {
      if (!persistLayoutMode || !snapshotReady || layoutModeWritten.current)
        return
      if (persist((snapshot) => withNativeRenderMode(snapshot.data, 'layout')))
        layoutModeWritten.current = true
    }, [persistLayoutMode, snapshotReady])
    function persistNativeLayoutPage(
      geometry: Extract<PdfEvent, { type: 'geometry' }>['pages'][number]
    ) {
      if (!isActivePane || !guard.ready || !canSubmit()) return
      const progress =
        nativeLayoutProgressFromGeometry(geometry, nativeViewportHeight) ??
        nativeLayoutProgress(geometry.pageNumber)
      if (!progress) return
      const key = nativeProgressKey(progress)
      if (lastNativeProgress.current === key) return
      lastNativeProgress.current = key
      persist((snapshot) => withNativeLayoutProgress(snapshot.data, progress), {
        positionOnly: true
      })
    }
    const ocrRuntime: NativeOcrRuntime = {
      fileId: record.fileId,
      extraOCR,
      pageMetrics: pageMetrics.current,
      canonicalDelivery,
      enqueue,
      persist,
      onOcrTextsChange,
      onOcrError,
      ocrEpoch,
      ocrFailed: ocrFailed.current,
      ocrError,
      setStatus,
      closed,
      ocrInFlight: ocrInFlight.current,
      ocrEnabled,
      manualOcrPages,
      pageCountRef,
      ocrCached: ocrCached.current,
      ocrCompleted: ocrCompleted.current,
      ocrRequests: ocrRequests.current
    }
    async function runNativeOcr(
      pageNumber: number,
      uri: string,
      epoch: number
    ) {
      return performNativeOcr(pageNumber, uri, epoch, ocrRuntime)
    }
    function requestNativeOcr(
      pagesToCheck: readonly number[],
      availability: Readonly<Record<number, 'textLayer' | 'noTextLayer'>>
    ) {
      requestNativeOcrPages(ocrRuntime, pagesToCheck, availability)
    }
    function diagnostic(event: PdfEvent) {
      if (
        __DEV__ &&
        ['loaded', 'displayed', 'restored', 'ready'].includes(event.type)
      )
        console.info('reader-pdf', guard.diagnostic())
      // 设备取证同样需要 JS 侧的结构化 documentOpened（Swift 日志在设备
      // 控制台），便于一条时间线里核对 route → opened → pageCount。
      if (event.type === 'loaded')
        logNativePdfDiagnostic('reader-pdf-document-opened', {
          renderer: 'pdfkit',
          documentOpened: true,
          pageCount: event.pageCount,
          ...identity
        })
    }
    // This handler is the single native event reducer; keep its ordering explicit.
    // eslint-disable-next-line sonarjs/cognitive-complexity
    function onEvent(event: PdfEvent) {
      if (!guard.receive(event)) return
      post({ type: 'nativeEvent', event })
      diagnostic(event)
      if (event.type === 'complete' || event.type === 'error') {
        if (
          'requestId' in event &&
          event.requestId === inFlight.current?.requestId
        ) {
          inFlight.current = null
          pump()
        }
      }
      if (event.type === 'complete' && event.uri) {
        const ocrPage = ocrRequests.current.get(event.requestId)
        if (ocrPage !== undefined) {
          ocrRequests.current.delete(event.requestId)
          void runNativeOcr(ocrPage, event.uri, ocrEpoch.current)
        } else setPreview(event.uri)
      }
      if (event.type === 'loaded') {
        pageCountRef.current = event.pageCount
        setPageCount(event.pageCount)
        const data = latest.current.data as { readerData?: ReaderData } | null
        for (const page of ocrEnabled
          ? Object.keys(data?.readerData?.ocrTexts ?? {})
          : []) {
          const pageNumber = Number(page)
          if (
            Number.isInteger(pageNumber) &&
            pageNumber > 0 &&
            pageNumber <= event.pageCount
          )
            ocrCached.current.add(
              nativeOcrSessionKey(record.fileId, pageNumber)
            )
        }
        const hidden = data?.readerData?.hiddenPages ?? []
        const allowed = visibleOriginalPages(event.pageCount, hidden)
        setAllowedPages(allowed)
        const crop = data?.readerData?.edgeCrop
        const crops = Object.fromEntries(
          allowed.map((n) => [
            String(n),
            crop?.pages?.[`page-${n}`] ??
              crop?.pages?.[String(n)] ??
              crop?.all ??
              {}
          ])
        )
        enqueue({ type: 'layout', pages: allowed, crops })
        enqueue({ type: 'restoreComplete' })
        rehydrateAnnotations()
        const saved = readerDataFromNativeSnapshot(
          latest.current.data,
          latest.current.progress
        )?.layoutReadingProgress
        if (
          saved &&
          'pageNumber' in saved &&
          allowed.includes(saved.pageNumber)
        )
          enqueue({
            type: 'navigate',
            pageNumber: saved.pageNumber,
            ...('verticalPercentage' in saved
              ? { verticalPercentage: saved.verticalPercentage }
              : {})
          })
      }
      if (event.type === 'geometry') {
        setMenuWithSource(null, 'native-geometry')
        if (event.pages[0]) {
          for (const geometry of event.pages)
            pageMetrics.current.set(geometry.pageNumber, {
              width: geometry.width,
              height: geometry.height
            })
          const cachedTexts = ocrEnabled
            ? readerDataFromNativeSnapshot(
                latest.current.data,
                latest.current.progress
              )?.ocrTexts
            : undefined
          for (const geometry of event.pages) {
            const texts = cachedTexts?.[geometry.pageNumber]
            if (!texts) continue
            const canonical = nativeCanonicalPageFromOcr(
              geometry.pageNumber,
              geometry.width,
              geometry.height,
              texts
            )
            if (canonical) {
              canonicalDelivery.publish(canonical)
              enqueue({
                type: 'text',
                pages: [canonical],
                retain: [geometry.pageNumber],
                source: 'geometry-cache'
              })
              ocrCompleted.current.add(
                nativeOcrSessionKey(record.fileId, geometry.pageNumber)
              )
            } else {
              ocrCached.current.delete(
                nativeOcrSessionKey(record.fileId, geometry.pageNumber)
              )
            }
          }
          setPage(event.pages[0].pageNumber)
          persistNativeLayoutPage(event.pages[0])
        }
      }
      if (event.type === 'textNeeded')
        requestNativeOcr(event.pages, event.textAvailability ?? {})
      if (event.type === 'rect' || event.type === 'stroke')
        handleDrawEvent(event)
      if (event.type === 'selection' && event.phase === 'end') {
        webEditRejected.current = false
        // The native surface owns the gesture and emits the canonical
        // endpoints.  The WebView remains the existing popover/annotation
        // surface, so make it visible from the native anchor as well; without
        // this bridge native OCR could select internally but never expose the
        // annotation menu.
        const anchor = event.anchor
        console.info('reader-pdf-native-selection-end', {
          start: event.start,
          end: event.end,
          anchor,
          size,
          nativeTop,
          webAlive: web.current !== null
        })
        setPanelOpen(false)
        const nextMenu = menuFrame(anchor)
        console.info('reader-pdf-native-menu', nextMenu)
        setMenuWithSource(nextMenu, 'native-selection-end')
        const first = Math.min(
          Number(/^page-(\d+)$/.exec(event.start.selectionId)?.[1]),
          Number(/^page-(\d+)$/.exec(event.end.selectionId)?.[1])
        )
        const last = Math.max(
          Number(/^page-(\d+)$/.exec(event.start.selectionId)?.[1]),
          Number(/^page-(\d+)$/.exec(event.end.selectionId)?.[1])
        )
        const cachedTexts = ocrEnabled
          ? readerDataFromNativeSnapshot(
              latest.current.data,
              latest.current.progress
            )?.ocrTexts
          : undefined
        const pages = allowedPages
          .filter((n) => n >= first && n <= last)
          .flatMap((pageNumber) => {
            const texts = cachedTexts?.[pageNumber]
            const metrics = pageMetrics.current.get(pageNumber)
            if (!texts || !metrics) return []
            const canonical = nativeCanonicalPageFromOcr(
              pageNumber,
              metrics.width,
              metrics.height,
              texts
            )
            return canonical ? [canonical] : []
          })
        console.info('reader-pdf-native-selection-canonical', {
          pages: pages.map((page) => ({
            page: page.pageNumber,
            utf16: page.text.length
          })),
          first,
          last
        })
        for (const canonical of pages) canonicalDelivery.publish(canonical)
        post({ type: 'nativeSelection', event, canonicalPages: pages })
      }
      if (event.type === 'error') {
        if (event.requestId) {
          const ocrPage = ocrRequests.current.get(event.requestId)
          if (ocrPage !== undefined) {
            ocrRequests.current.delete(event.requestId)
            const key = nativeOcrSessionKey(record.fileId, ocrPage)
            ocrInFlight.current.delete(key)
            ocrFailed.current.add(key)
            ocrError.current = {
              code: 'OCR_FAILED',
              message: event.message ?? `OCR 预览失败：${event.code}`
            }
            onOcrError?.(
              new Error(event.message ?? `OCR 预览失败：${event.code}`),
              { pageNumber: ocrPage }
            )
          }
        }
        const nextError = { code: event.code, message: event.message }
        if (shouldReplaceNativePdfError(nativeError.current, nextError)) {
          nativeError.current = nextError
          setStatus(
            `原生 PDF [${event.code}]：${nativePdfErrorMessage(nextError)}`
          )
        }
      } else if (
        !webEditRejected.current &&
        nativeError.current === null &&
        ocrError.current === null &&
        guard.ready &&
        authoritativeReady.current
      )
        setStatus('PDFKit 已显示；数据恢复完成')
      else if (
        !webEditRejected.current &&
        nativeError.current === null &&
        ocrError.current === null &&
        (event.type === 'displayed' || guard.ready)
      )
        setStatus('PDFKit 已显示；等待权威数据与写权交接')
    }
    const injected = `window.__READER_NATIVE_PDF__=${JSON.stringify({ ...identity, publicationUrl, snapshot: record.snapshot.data, progress: record.snapshot.progress, canEdit: false }).replace(/</g, '\\u003c')};true;`
    if (Platform.OS !== 'ios' || !ReaderPdfView || !readerPdfModule)
      return (
        <Text role='alert'>
          原生 PDF 需要重新构建 iOS dev client：yarn host:ios（Expo Go
          不支持）。
        </Text>
      )
    if (record.snapshotError)
      return (
        <Text role='alert'>快照损坏，已禁止编辑：{record.snapshotError}</Text>
      )
    const width = Math.min(size.width || 300, 300),
      height = Math.min(size.height || 160, panelOpen ? size.height : 160)
    const draftGroups = nativePageEditGroups(draftHiddenPages, pageCount)
    const editingReady = nativeEditingReady(
      snapshotReady,
      handoff,
      identity,
      closed.current
    )
    return (
      <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
        {authoritativeFailed ? (
          <Pressable onPress={() => setRecoveryRetry((value) => value + 1)}>
            <Text role='alert'>重试数据恢复</Text>
          </Pressable>
        ) : null}
        <NativePdfControls
          status={status}
          rangesOpen={rangesOpen}
          setRangesOpen={setRangesOpen}
          outlineOpen={outlineOpen}
          setOutlineOpen={setOutlineOpen}
          page={page}
          pageCount={pageCount}
          ocrEnabled={ocrEnabled}
          ocrDisabled={ocr !== undefined || !editingReady}
          editingDisabled={!editingReady}
          toggleOcr={() => {
            if (ocr === undefined && canSubmit())
              setInternalOcrEnabled((value) => !value)
          }}
          beginPageEdit={beginPageEdit}
          tool={tool}
          selectTool={selectTool}
          undoNativeDrawing={undoNativeDrawing}
          redoNativeDrawing={redoNativeDrawing}
          clearCurrentPageInk={clearCurrentPageInk}
          ink={ink}
          selectInk={selectInk}
          hiddenPagesUndo={hiddenPagesUndo}
          undoPageEdit={undoPageEdit}
          allowedPages={allowedPages}
          enqueue={enqueue}
          ranges={ranges}
          post={post}
          outline={outline}
          saveError={saveError}
          retryFailedSave={() => {
            saveQueue.retry()?.catch(() => undefined)
          }}
          preview={preview}
          setPreview={setPreview}
        />
        <ReaderPdfView
          onLayout={(event) => {
            setNativeTop(event.nativeEvent.layout.y)
            setNativeViewportHeight(event.nativeEvent.layout.height)
          }}
          command={command}
          configuration={nativeSelectionConfiguration}
          onPdfEvent={(e) => onEvent(e.nativeEvent)}
          style={{ flex: 1 }}
        />
        <Modal visible={editOpen} transparent animationType='fade'>
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              padding: 24,
              backgroundColor: 'rgba(0,0,0,0.35)'
            }}
          >
            <View
              style={{
                maxHeight: '85%',
                padding: 16,
                gap: 10,
                borderRadius: 12,
                backgroundColor: 'white'
              }}
            >
              <Text>裁切与隐藏页</Text>
              <Text>选择要隐藏的原页（分组编辑）</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  onPress={() =>
                    setDraftHiddenPages(
                      Array.from({ length: pageCount }, (_, index) => index + 1)
                    )
                  }
                >
                  <Text>全选</Text>
                </Pressable>
                <Pressable onPress={() => setDraftHiddenPages([])}>
                  <Text>取消选择</Text>
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 220 }}>
                {draftGroups.length === 0 ? (
                  <Text>当前没有隐藏段</Text>
                ) : (
                  draftGroups.map((group) => {
                    const selected = group.pages.every((pageNumber) =>
                      draftHiddenPages.includes(pageNumber)
                    )
                    return (
                      <Pressable
                        key={`${group.start}-${group.end}`}
                        onPress={() =>
                          setDraftHiddenPages((current) =>
                            toggleHiddenPageGroup(
                              current,
                              group.pages,
                              selected
                            )
                          )
                        }
                      >
                        <Text>
                          {selected ? '☑' : '☐'} 第 {group.start}–{group.end}{' '}
                          页（
                          {group.pages.length} 页）
                        </Text>
                      </Pressable>
                    )
                  })
                )}
              </ScrollView>
              <Text>全局裁切：{Math.round((draftCrop.top ?? 0) * 100)}%</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  onPress={() =>
                    setDraftCrop({
                      top: 0.05,
                      right: 0.05,
                      bottom: 0.05,
                      left: 0.05
                    })
                  }
                >
                  <Text>裁切四边 5%</Text>
                </Pressable>
                <Pressable onPress={() => setDraftCrop({})}>
                  <Text>恢复裁切</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={() => setEditOpen(false)}>
                  <Text>取消</Text>
                </Pressable>
                <Pressable onPress={commitPageEdit}>
                  <Text>确认</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <WebView
          ref={web}
          source={{ uri: entryUrl }}
          injectedJavaScriptBeforeContentLoaded={injected}
          style={{ backgroundColor: 'transparent' }}
          containerStyle={{
            position: 'absolute',
            left: menu?.left ?? 0,
            top: menu?.top ?? 0,
            width: menu ? width : 1,
            height: menu ? height : 1,
            opacity: menu ? 1 : 0
          }}
          pointerEvents={menu ? 'auto' : 'none'}
          originWhitelist={['file://*', 'about:blank']}
          allowingReadAccessToURL={baseUrl}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode='never'
          javaScriptCanOpenWindowsAutomatically={false}
          onShouldStartLoadWithRequest={(request) => {
            const allowed =
              request.url === 'about:blank' ||
              isReaderFileUrl(request.url, baseUrl)
            if (__DEV__)
              console.info('reader-webview-navigation', {
                url: request.url,
                baseUrl,
                entryUrl,
                allowed
              })
            return allowed
          }}
          onLoadStart={({ nativeEvent }) => {
            canonicalDelivery.webLoading()
            if (__DEV__)
              console.info('reader-webview-load-start', nativeEvent.url)
          }}
          onError={({ nativeEvent }) => {
            const message = `WebView 加载失败：${nativeEvent.description}（${entryUrl}）`
            setWebError(message)
            if (nativeError.current === null) setStatus(message)
          }}
          onHttpError={({ nativeEvent }) => {
            const message = `WebView HTTP ${nativeEvent.statusCode}（${nativeEvent.url}）`
            setWebError(message)
            if (nativeError.current === null) setStatus(message)
          }}
          onMessage={(e) => {
            let m: Record<string, unknown>
            try {
              m = JSON.parse(e.nativeEvent.data)
            } catch {
              return
            }
            handleNativePdfMessage(m, {
              identity,
              guard,
              canonicalDelivery,
              refillCanonical,
              enqueue,
              canSubmit,
              syncWebEditing,
              rejectWebEdit,
              isWebEditRejected: () => webEditRejected.current,
              setOutline,
              setPanelOpen,
              setMenuWithSource,
              menuFrame,
              setRanges,
              saveWebSnapshot,
              post,
              nativeError,
              setStatus
            })
          }}
        />
        {webError ? (
          <Text role='alert' style={{ color: '#a33' }}>
            {webError}
          </Text>
        ) : null}
      </View>
    )
  }
)
