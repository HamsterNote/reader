import { Image } from 'react-native'
import type { IntermediateText } from '@hamster-note/types'
import type { ReaderData } from '../../../src/types/readerData'
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
  Platform,
  Pressable,
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
  withNativeLayoutProgress
} from '../../../src/nativePdf/hostProgress'
import type { ReaderWebViewHandle } from './ReaderWebView'
import type {
  ReaderExtraOcr,
  ReaderOcrOptions
} from '../../../src/components/IntermediateDocumentViewer'
import {
  fetchOcrContent,
  prefixOcrTextIds
} from '../../../src/components/IntermediateDocumentViewer/ocrContent'
import {
  nativeCanonicalPageFromOcr,
  nativeOcrSessionKey,
  shouldRequestNativeOcr
} from '../../../src/nativePdf/ocr'

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
    const failedData = useRef<unknown>(undefined)
    const alive = useRef(true)
    const closed = useRef(false)
    const lastNativeProgress = useRef<string | null>(null)
    const ocrRequests = useRef(new Map<string, number>())
    const ocrCompleted = useRef(new Set<string>())
    const ocrEpoch = useRef(0)
    const pageMetrics = useRef(
      new Map<number, { width: number; height: number }>()
    )
    const previousOcrEnabled = useRef(ocrEnabled)
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
    function persist(data: unknown) {
      if (closed.current) return
      failedData.current = data
      // Save at the existing authoritative key, in order; never overwrite failed saves.
      save.current = save.current
        .then(async () => {
          const next = {
            ...latest.current,
            data,
            revision: latest.current.revision + 1
          }
          await store.saveSnapshot(record.fileId, next)
          latest.current = next
          if (failedData.current === data) failedData.current = undefined
        })
        .catch((error) => {
          if (alive.current)
            setSaveError(error instanceof Error ? error.message : '保存失败')
          throw error
        })
      save.current.catch(() => undefined)
    }
    useImperativeHandle(ref, () => ({
      close: async () => {
        if (closed.current) return { status: 'closed' }
        closed.current = true
        ocrEpoch.current += 1
        ocrRequests.current.clear()
        enqueue({ type: 'cancel' })
        post({ type: 'dismiss' })
        setMenu(null)
        try {
          await save.current
          if (failedData.current !== undefined)
            return { status: 'unconfirmed', reason: '原生高亮尚未保存，请重试' }
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
      if (!ocrEnabled) {
        ocrCompleted.current.clear()
        enqueue({ type: 'text', pages: [], retain: [] })
      }
    }, [ocrEnabled])
    useEffect(() => {
      closed.current = false
      enqueue({
        type: 'open',
        source: { fileId: record.fileId, localUri: publicationUrl }
      })
    }, [publicationUrl, record.fileId])
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
      persist(withNativeLayoutProgress(latest.current.data, progress))
    }
    async function runNativeOcr(
      pageNumber: number,
      uri: string,
      epoch: number
    ) {
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
        onOcrTextsChange?.(pageNumber, texts)
        ocrCompleted.current.add(nativeOcrSessionKey(record.fileId, pageNumber))
      } catch (error) {
        if (epoch === ocrEpoch.current && !closed.current) {
          setStatus(
            `原生 OCR [${pageNumber}]：${error instanceof Error ? error.message : String(error)}`
          )
          onOcrError?.(error, { pageNumber })
        }
      }
    }
    function requestNativeOcr(
      pagesToCheck: readonly number[],
      availability: Readonly<Record<number, 'textLayer' | 'noTextLayer'>>
    ) {
      if (!ocrEnabled) return
      const epoch = ocrEpoch.current
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
        if (ocrCompleted.current.has(key) || ocrRequests.current.has(key))
          continue
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
        const data = record.snapshot.data as { readerData?: ReaderData } | null
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
            onOcrError?.(
              new Error(event.message ?? `OCR 预览失败：${event.code}`),
              { pageNumber: ocrPage }
            )
          }
        }
        const detail = event.message ? `：${event.message}` : ''
        setStatus(`原生 PDF [${event.code}]${detail}`)
      } else if (guard.ready) setStatus('PDFKit 已显示；数据恢复完成')
      else if (event.type === 'displayed')
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
              const data = failedData.current
              if (data !== undefined) {
                save.current = Promise.resolve()
                setSaveError(null)
                persist(data)
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
            setStatus(message)
          }}
          onHttpError={({ nativeEvent }) => {
            const message = `WebView HTTP ${nativeEvent.statusCode}（${nativeEvent.url}）`
            setWebError(message)
            setStatus(message)
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
                  persist(m.data)
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
