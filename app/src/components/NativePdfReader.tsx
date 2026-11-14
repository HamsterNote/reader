import { Image } from 'react-native'
import type { IntermediateText } from '@hamster-note/types'
import type { ReaderData, ReaderEdgeCrop } from '../../../src/types/readerData'
import {
  forwardRef,
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
import type { PdfCommand, PdfEvent } from '../../../src/nativePdf/contracts'
import { NativePdfSession } from '../../../src/nativePdf/session'
import { nativeSelectionConfiguration } from '../../../src/nativePdf/selection'
import { visibleOriginalPages } from '../../../src/nativePdf/geometry'
import {
  nativeLayoutProgress,
  nativeLayoutProgressFromGeometry,
  nativeProgressKey,
  readerDataFromNativeSnapshot,
  withNativeLayoutProgress,
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
  shouldRequestNativeOcr
} from '../../../src/nativePdf/ocr'
import { enqueueRecoverableSave } from '../../../src/nativePdf/persistence'
import {
  nativePageEditGroups,
  mergeNativeExternalData,
  restoreNativePageEditFields,
  type NativePageEditUndo,
  withNativePageEditData
} from '../../../src/nativePdf/pageEdit'
import {
  nativePdfErrorMessage,
  shouldReplaceNativePdfError
} from '../../../src/nativePdf/errors'

function isReaderFileUrl(url: string, root: string): boolean {
  try {
    const candidate = decodeURI(url)
    const base = decodeURI(root).replace(/\/$/, '')
    return candidate.startsWith(`${base}/`)
  } catch {
    return url.startsWith(root)
  }
}

type Props = {
  record: HostDocumentRecord
  store: ReaderDataStore
  entryUrl: string
  publicationUrl: string
  baseUrl: string
  ocr?: boolean | ReaderOcrOptions
  extraOCR?: ReaderExtraOcr
  onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  onOcrTextsChange?: (pageNumber: number, texts: IntermediateText[]) => void
}
/** Explicit development route until all acceptance gates are passed. */
export const NativePdfReader = forwardRef<ReaderWebViewHandle, Props>(
  function NativePdfReader(
    {
      record,
      store,
      entryUrl,
      publicationUrl,
      baseUrl,
      ocr,
      extraOCR,
      onOcrError,
      onOcrTextsChange
    },
    ref
  ) {
    const identity = useMemo(
      () => ({
        fileId: record.fileId,
        paneId: 'development',
        sessionId: randomUUID(),
        generation: 1
      }),
      [record.fileId]
    )
    const guard = useMemo(() => new NativePdfSession(identity), [identity])
    const web = useRef<WebView>(null)
    const [command, setCommand] = useState<PdfCommand | null>(null)
    const queue = useRef<PdfCommand[]>([])
    const inFlight = useRef<PdfCommand | null>(null)
    const counter = useRef(0)
    const [status, setStatus] = useState('正在加载原生 PDF…')
    const [webError, setWebError] = useState<string | null>(null)
    const [panelOpen, setPanelOpen] = useState(false)
    const [menu, setMenu] = useState<{ left: number; top: number } | null>(null)
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
    const [editOpen, setEditOpen] = useState(false)
    const [draftHiddenPages, setDraftHiddenPages] = useState<number[]>([])
    const [draftCrop, setDraftCrop] = useState<ReaderEdgeCrop>({})
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
    const save = useRef(Promise.resolve())
    const latest = useRef(record.snapshot)
    const committed = useRef(new Set<string>())
    const failedTransform = useRef<
      ((snapshot: typeof record.snapshot) => unknown) | undefined
    >(undefined)
    const alive = useRef(true)
    const closed = useRef(false)
    const lastNativeProgress = useRef<string | null>(null)
    const ocrRequests = useRef(new Map<string, number>())
    const ocrInFlight = useRef(new Set<string>())
    const ocrCompleted = useRef(new Set<string>())
    const ocrFailed = useRef(new Set<string>())
    const ocrEpoch = useRef(0)
    const nativeError = useRef<{ code: string; message?: string } | null>(null)
    const ocrError = useRef<{ code: string; message?: string } | null>(null)
    const pageMetrics = useRef(
      new Map<number, { width: number; height: number }>()
    )
    const previousOcrEnabled = useRef(ocrEnabled)
    const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    const post = (body: Record<string, unknown>) =>
      web.current?.postMessage(JSON.stringify({ ...body, identity }))
    function persist(transform: (snapshot: typeof record.snapshot) => unknown) {
      if (closed.current) return
      failedTransform.current = transform
      // Save at the existing authoritative key, in order; never overwrite failed saves.
      save.current = enqueueRecoverableSave(save.current, async () => {
        const next = await store.updateSnapshot(record.fileId, (base) => ({
          ...base,
          data: transform(base),
          revision: base.revision + 1
        }))
        latest.current = next
        if (failedTransform.current === transform)
          failedTransform.current = undefined
      }).catch((error) => {
        if (alive.current)
          setSaveError(error instanceof Error ? error.message : '保存失败')
        throw error
      })
      save.current.catch(() => undefined)
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
      const data = readerDataSnapshot()
      setDraftHiddenPages(
        (data.hiddenPages ?? []).flatMap((value) => {
          const pageNumber =
            typeof value === 'number'
              ? value
              : Number(String(value).replace(/^page-/, ''))
          return Number.isInteger(pageNumber) && pageNumber > 0
            ? [pageNumber]
            : []
        })
      )
      setDraftCrop(data.edgeCrop?.all ?? {})
      setEditOpen(true)
    }
    function commitPageEdit() {
      const previous = readerDataSnapshot()
      const next: ReaderData = {
        ...previous,
        hiddenPages: [...new Set(draftHiddenPages)].sort((a, b) => a - b),
        edgeCrop: { ...previous.edgeCrop, all: draftCrop }
      }
      persist((snapshot) => {
        const current =
          readerDataFromNativeSnapshot(snapshot.data, snapshot.progress) ?? {}
        return withNativePageEditData(
          snapshot.data,
          restoreNativePageEditFields(current, {
            hiddenPages: next.hiddenPages,
            edgeCrop: next.edgeCrop
          })
        )
      })
      layoutForReaderData(next)
      setHiddenPagesUndo({
        hiddenPages: previous.hiddenPages,
        edgeCrop: previous.edgeCrop
      })
      if (undoTimer.current) clearTimeout(undoTimer.current)
      undoTimer.current = setTimeout(() => {
        undoTimer.current = null
        setHiddenPagesUndo(null)
      }, 5000)
      setEditOpen(false)
    }
    async function undoPageEdit() {
      const undo = hiddenPagesUndo
      if (!undo) return
      await save.current.catch(() => undefined)
      const authoritative = await store.get(record.fileId)
      const snapshot = authoritative?.snapshot ?? latest.current
      latest.current = snapshot
      const current =
        readerDataFromNativeSnapshot(snapshot.data, snapshot.progress) ?? {}
      const next = restoreNativePageEditFields(current, undo)
      persist((currentSnapshot) => {
        const currentData =
          readerDataFromNativeSnapshot(
            currentSnapshot.data,
            currentSnapshot.progress
          ) ?? {}
        return withNativePageEditData(
          currentSnapshot.data,
          restoreNativePageEditFields(currentData, undo)
        )
      })
      layoutForReaderData(next)
      setHiddenPagesUndo(null)
      if (undoTimer.current) clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
    useImperativeHandle(ref, () => ({
      close: async () => {
        if (closed.current) return { status: 'closed' }
        ocrEpoch.current += 1
        ocrRequests.current.clear()
        ocrInFlight.current.clear()
        if (undoTimer.current) clearTimeout(undoTimer.current)
        enqueue({ type: 'cancel' })
        post({ type: 'dismiss' })
        setMenu(null)
        try {
          await save.current
          if (failedTransform.current !== undefined)
            return { status: 'unconfirmed', reason: '原生高亮尚未保存，请重试' }
          // The session is closed only after every queued snapshot has been
          // confirmed. A failed close remains usable so the retry can enqueue
          // the failed payload and advance the revision.
          closed.current = true
          post({ type: 'dispose' })
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
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          enqueue({ type: 'cancel' })
          post({ type: 'dismiss' })
          setMenu(null)
        }
      })
      return () => {
        alive.current = false
        closed.current = true
        ocrEpoch.current += 1
        ocrRequests.current.clear()
        if (undoTimer.current) clearTimeout(undoTimer.current)
        subscription.remove()
        post({ type: 'dispose' })
        guard.close()
      }
    }, [guard])
    useEffect(() => {
      if (previousOcrEnabled.current === ocrEnabled) return
      previousOcrEnabled.current = ocrEnabled
      ocrEpoch.current += 1
      ocrRequests.current.clear()
      ocrInFlight.current.clear()
      ocrFailed.current.clear()
      ocrError.current = null
      if (!ocrEnabled) {
        ocrCompleted.current.clear()
        enqueue({ type: 'text', pages: [], retain: [] })
      }
    }, [ocrEnabled])
    useEffect(() => {
      let active = true
      closed.current = false
      nativeError.current = null
      const open = (snapshot: typeof record.snapshot) => {
        if (!active) return
        // Text mode can persist progress while this native view is unmounted.
        // Re-read the authoritative snapshot before opening so switching back
        // does not restore the stale record prop at 0%.
        latest.current = snapshot
        enqueue({
          type: 'open',
          source: { fileId: record.fileId, localUri: publicationUrl }
        })
      }
      void store
        .get(record.fileId)
        .then((persisted) => open(persisted?.snapshot ?? record.snapshot))
        .catch(() => open(record.snapshot))
      return () => {
        active = false
      }
    }, [publicationUrl, record.fileId, record.snapshot, store])
    function persistNativeLayoutPage(
      geometry: Extract<PdfEvent, { type: 'geometry' }>['pages'][number]
    ) {
      if (!guard.ready) return
      const progress =
        nativeLayoutProgressFromGeometry(geometry, nativeViewportHeight) ??
        nativeLayoutProgress(geometry.pageNumber)
      if (!progress) return
      const key = nativeProgressKey(progress)
      if (lastNativeProgress.current === key) return
      lastNativeProgress.current = key
      persist((snapshot) => withNativeLayoutProgress(snapshot.data, progress))
    }
    async function runNativeOcr(
      pageNumber: number,
      uri: string,
      epoch: number
    ) {
      const key = nativeOcrSessionKey(record.fileId, pageNumber)
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64
        })
        if (epoch !== ocrEpoch.current || closed.current) return
        const content = await fetchOcrContent(
          `data:image/png;base64,${base64}`,
          extraOCR
        )
        if (epoch !== ocrEpoch.current || closed.current) return
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
        const metrics = pageMetrics.current.get(pageNumber)
        const canonical = metrics
          ? nativeCanonicalPageFromOcr(
              pageNumber,
              metrics.width,
              metrics.height,
              texts
            )
          : null
        if (!canonical) throw new Error(`OCR 未返回第 ${pageNumber} 页文字`)
        enqueue({ type: 'text', pages: [canonical], retain: [pageNumber] })
        persist((snapshot) =>
          withNativeOcrTexts(snapshot.data, pageNumber, texts)
        )
        onOcrTextsChange?.(pageNumber, texts)
        ocrCompleted.current.add(key)
      } catch (error) {
        if (epoch === ocrEpoch.current && !closed.current) {
          ocrFailed.current.add(key)
          ocrError.current = {
            code: 'OCR_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }
          setStatus(
            `原生 OCR [${pageNumber}]：${error instanceof Error ? error.message : String(error)}`
          )
          onOcrError?.(error, { pageNumber })
        }
      } finally {
        if (epoch === ocrEpoch.current) ocrInFlight.current.delete(key)
      }
    }
    function requestNativeOcr(
      pagesToCheck: readonly number[],
      availability: Readonly<Record<number, 'textLayer' | 'noTextLayer'>>
    ) {
      if (!ocrEnabled) return
      for (const pageNumber of pagesToCheck) {
        if (manualOcrPages && !manualOcrPages.includes(pageNumber)) continue
        if (
          !shouldRequestNativeOcr(
            true,
            pageNumber,
            availability,
            pageCountRef.current
          )
        )
          continue
        const key = nativeOcrSessionKey(record.fileId, pageNumber)
        if (
          !canRetryNativeOcrPage(
            key,
            ocrInFlight.current,
            ocrCompleted.current,
            ocrFailed.current
          )
        )
          continue
        ocrInFlight.current.add(key)
        const requestId = enqueue({ type: 'preview', pageNumber, width: 160 })
        ocrRequests.current.set(requestId, pageNumber)
      }
    }
    function diagnostic(event: PdfEvent) {
      if (
        __DEV__ &&
        ['loaded', 'displayed', 'restored', 'ready'].includes(event.type)
      )
        console.info('reader-pdf', guard.diagnostic())
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
        setMenu(null)
        if (event.pages[0]) {
          for (const geometry of event.pages)
            pageMetrics.current.set(geometry.pageNumber, {
              width: geometry.width,
              height: geometry.height
            })
          setPage(event.pages[0].pageNumber)
          persistNativeLayoutPage(event.pages[0])
        }
      }
      if (event.type === 'textNeeded')
        requestNativeOcr(event.pages, event.textAvailability ?? {})
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
        nativeError.current === null &&
        ocrError.current === null &&
        guard.ready
      )
        setStatus('PDFKit 已显示；数据恢复完成')
      else if (
        nativeError.current === null &&
        ocrError.current === null &&
        event.type === 'displayed'
      )
        setStatus('PDFKit 已显示；等待恢复完成')
    }
    const injected = `window.__READER_NATIVE_PDF__=${JSON.stringify({ ...identity, publicationUrl, snapshot: record.snapshot.data, progress: record.snapshot.progress }).replace(/</g, '\\u003c')};true;`
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
    return (
      <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <Text>{status}</Text>
          <Pressable onPress={() => setRangesOpen((v) => !v)}>
            <Text>高亮列表</Text>
          </Pressable>
          <Pressable onPress={() => setOutlineOpen((v) => !v)}>
            <Text>目录</Text>
          </Pressable>
          <Text>
            {page}/{pageCount}
          </Text>
          <Pressable
            accessibilityRole='button'
            accessibilityState={{
              checked: ocrEnabled,
              disabled: ocr !== undefined
            }}
            onPress={() => {
              if (ocr === undefined) setInternalOcrEnabled((value) => !value)
            }}
          >
            <Text>OCR {ocrEnabled ? '开' : '关'}</Text>
          </Pressable>
          <Pressable onPress={beginPageEdit}>
            <Text>裁切/隐藏页编辑</Text>
          </Pressable>
          {hiddenPagesUndo ? (
            <Pressable onPress={undoPageEdit}>
              <Text>撤销（5秒）</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() =>
              enqueue({
                type: 'navigate',
                pageNumber:
                  allowedPages[Math.max(0, allowedPages.indexOf(page) - 1)] ??
                  page
              })
            }
          >
            <Text>上一页</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              enqueue({
                type: 'navigate',
                pageNumber:
                  allowedPages[
                    Math.min(
                      allowedPages.length - 1,
                      allowedPages.indexOf(page) + 1
                    )
                  ] ?? page
              })
            }
          >
            <Text>下一页</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              enqueue({
                type: 'preview',
                pageNumber:
                  allowedPages[
                    Math.min(
                      allowedPages.length - 1,
                      allowedPages.indexOf(page) + 1
                    )
                  ] ?? page,
                width: 160
              })
            }
          >
            <Text>预览下一页</Text>
          </Pressable>
          <Pressable onPress={() => enqueue({ type: 'scale', value: 2 })}>
            <Text>200%</Text>
          </Pressable>
          <Pressable onPress={() => enqueue({ type: 'scale', value: 1 })}>
            <Text>100%</Text>
          </Pressable>
        </View>
        {rangesOpen ? (
          <View style={{ maxHeight: 180 }}>
            {ranges.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => {
                  post({ type: 'activate', rangeId: r.id })
                  setRangesOpen(false)
                }}
              >
                <Text numberOfLines={1}>{r.text}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {outlineOpen ? (
          <View style={{ maxHeight: 180 }}>
            {outline.map((item, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  enqueue({ type: 'navigate', pageNumber: item.pageNumber })
                  setOutlineOpen(false)
                }}
              >
                <Text>{item.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {saveError ? (
          <Pressable
            onPress={() => {
              const transform = failedTransform.current
              if (transform !== undefined) {
                setSaveError(null)
                persist(transform)
              }
            }}
          >
            <Text role='alert'>{saveError}（点此重试）</Text>
          </Pressable>
        ) : null}
        {preview ? (
          <Pressable onPress={() => setPreview(null)}>
            <Image
              source={{ uri: preview }}
              style={{ width: 100, height: 140 }}
              resizeMode='contain'
            />
            <Text>关闭预览</Text>
          </Pressable>
        ) : null}
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
                            selected
                              ? current.filter(
                                  (pageNumber) =>
                                    !group.pages.includes(pageNumber)
                                )
                              : [...new Set([...current, ...group.pages])].sort(
                                  (a, b) => a - b
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
            if (!guard.accepts(m as unknown as typeof identity)) return
            switch (m.type) {
              case 'outline':
                setOutline(m.items as { title: string; pageNumber: number }[])
                break
              case 'panel':
                setPanelOpen(true)
                setMenu({ left: 0, top: 0 })
                break
              case 'serviceReady':
                break
              case 'command': {
                const c = m.command as PdfCommand
                if (guard.accepts(c)) enqueue(c)
                break
              }
              case 'ranges':
                setRanges(m.items as { id: string; text: string }[])
                break
              case 'snapshot':
                if (
                  typeof m.commitId === 'string' &&
                  !committed.current.has(m.commitId)
                ) {
                  committed.current.add(m.commitId)
                  persist((snapshot) =>
                    mergeNativeExternalData(snapshot.data, m.data)
                  )
                }
                break
              case 'navigateRange':
                post({ type: 'navigateRange', rangeId: m.rangeId })
                break
              case 'menu': {
                setPanelOpen(false)
                const r = m.anchor as {
                  x: number
                  y: number
                  width: number
                  height: number
                }
                setMenu({
                  left: Math.max(
                    0,
                    Math.min(size.width - width, r.x + r.width / 2 - width / 2)
                  ),
                  top: Math.max(
                    0,
                    Math.min(size.height - height, r.y + nativeTop - height)
                  )
                })
                break
              }
              case 'hideMenu':
                setPanelOpen(false)
                setMenu(null)
                break
              case 'failure':
                if (nativeError.current === null)
                  setStatus(`规范文本：${String(m.code)}`)
                break
              case 'external':
                if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url))
                  Linking.openURL(m.url).catch(() => setStatus('无法打开外链'))
                break
            }
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
