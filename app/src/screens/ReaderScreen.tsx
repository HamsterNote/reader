import {
  NativePdfReader,
  type NativePdfHandoff
} from '../components/NativePdfReader'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { randomUUID } from 'expo-crypto'

import { pickLegacyJsonAndImport } from '../native/documents'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../../src/host/readerDataStore'
import {
  ReaderWebView,
  type ReaderWebViewHandle
} from '../components/ReaderWebView'
import { stageReaderDocument } from '../native/webAssets'
import type {
  ReaderExtraOcr,
  ReaderOcrOptions
} from '../../../src/types/readerOcr'
import type { IntermediateText } from '@hamster-note/types'
import type { PdfIdentity } from '../../../src/nativePdf/contracts'
import { PdfHandoffCoordinator } from '../../../src/nativePdf/handoff'
import type { BridgeCloseResult } from '../../../src/bridge/hostSession'
import { logNativePdfDiagnostic } from '../../../src/nativePdf/diagnostics'
import { readerDataFromNativeSnapshot } from '../../../src/nativePdf/hostProgress'
import {
  isLocalIosPdf,
  usesNativePdfLayout
} from '../../../src/nativePdf/routing'

type ReaderScreenProps = {
  readonly record: HostDocumentRecord
  readonly store: ReaderDataStore
  readonly entryUrl: string
  readonly baseUrl: string
  readonly onBack: () => void
  readonly onRecordUpdated: (record: HostDocumentRecord) => void
  /** Configured split hosts supply their stable pane key; standalone screens generate one. */
  readonly paneId?: string
  readonly isActivePane?: boolean
  /** 设备取证：递增该值触发一次 PDF.js 页面画布渲染计数采集。 */
  readonly debugCensusToken?: number
  /** 设备取证：递增该值制造一次可控的「待确认写入」。 */
  readonly debugHoldSaveToken?: number
  readonly ocr?: boolean | ReaderOcrOptions
  readonly extraOCR?: ReaderExtraOcr
  readonly onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  readonly onOcrTextsChange?: (
    pageNumber: number,
    texts: IntermediateText[]
  ) => void
}

type ReaderScreenSessionProps = ReaderScreenProps & {
  readonly closeRef: React.RefObject<(() => void) | null>
}

function identityFor(
  fileId: string,
  paneId: string,
  generation: number
): PdfIdentity {
  return {
    fileId,
    paneId,
    sessionId: randomUUID(),
    generation
  }
}

function sameIdentity(left: PdfIdentity, right: PdfIdentity): boolean {
  return (
    left.fileId === right.fileId &&
    left.paneId === right.paneId &&
    left.sessionId === right.sessionId &&
    left.generation === right.generation
  )
}

/** 关闭 Web 会话（含放弃未确认内容）；任何异常都归为 unconfirmed。 */
async function closeWebSession(
  ref: React.RefObject<ReaderWebViewHandle | null>,
  discard: boolean
): Promise<BridgeCloseResult> {
  try {
    if (discard)
      return (
        (await ref.current?.discardUnconfirmed?.()) ?? {
          status: 'unconfirmed',
          reason: '当前会话未提供放弃未确认内容的出口'
        }
      )
    return (await ref.current?.close({ handoff: true })) ?? { status: 'closed' }
  } catch (error) {
    return {
      status: 'unconfirmed',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

type ReaderContentContext = {
  readonly staged: Awaited<ReturnType<typeof stageReaderDocument>> | null
  readonly stageError: string | null
  readonly onStageRetry: () => void
  readonly nativePdf: boolean
  readonly webMounted: boolean
  readonly webRecord: HostDocumentRecord
  readonly record: HostDocumentRecord
  readonly webIdentity: PdfIdentity
  readonly sourceToken: string
  readonly webRef: React.RefObject<ReaderWebViewHandle | null>
  readonly nativeRef: React.RefObject<ReaderWebViewHandle | null>
  readonly webHandoff: import('../components/ReaderWebView').ReaderWebViewHandoff
  readonly nativeIdentity: PdfIdentity
  readonly nativeHandoff: NativePdfHandoff
  readonly store: ReaderDataStore
  readonly isActivePane: boolean
  readonly persistLayoutMode: boolean
  readonly ocr?: boolean | ReaderOcrOptions
  readonly extraOCR?: ReaderExtraOcr
  readonly onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  readonly onOcrTextsChange?: (
    pageNumber: number,
    texts: IntermediateText[]
  ) => void
}

function renderReaderContent(context: ReaderContentContext) {
  const {
    staged,
    stageError,
    onStageRetry,
    nativePdf,
    webMounted,
    webRecord,
    record,
    webIdentity,
    sourceToken,
    webRef,
    nativeRef,
    webHandoff,
    nativeIdentity,
    nativeHandoff,
    store,
    isActivePane,
    persistLayoutMode,
    ocr,
    extraOCR,
    onOcrError,
    onOcrTextsChange
  } = context
  if (stageError) {
    return (
      <View>
        <Text role='alert'>{stageError}</Text>
        <Pressable onPress={onStageRetry}>
          <Text>重试</Text>
        </Pressable>
      </View>
    )
  }
  if (!staged) return <ActivityIndicator />
  const shared = {
    store,
    entryUrl: staged.entryUrl,
    baseUrl: staged.baseUrl,
    publicationUrl: staged.publicationUrl,
    ocr,
    extraOCR,
    onOcrError,
    onOcrTextsChange
  }
  return (
    <View style={styles.reader}>
      {webMounted ? (
        <View
          style={styles.reader}
          pointerEvents={nativePdf ? 'none' : 'auto'}
          accessibilityElementsHidden={nativePdf}
          importantForAccessibility={nativePdf ? 'no-hide-descendants' : 'auto'}
        >
          <ReaderWebView
            key={`${webIdentity.sessionId}:${webIdentity.generation}`}
            ref={webRef}
            record={webRecord.fileId === record.fileId ? webRecord : record}
            sessionId={webIdentity.sessionId}
            sourceToken={sourceToken}
            handoff={webHandoff}
            {...shared}
          />
        </View>
      ) : null}
      {nativePdf ? (
        <View style={webMounted ? styles.nativeOverlay : styles.reader}>
          <NativePdfReader
            key={nativeIdentity.sessionId}
            ref={nativeRef}
            record={record}
            handoff={nativeHandoff}
            isActivePane={isActivePane}
            persistLayoutMode={persistLayoutMode}
            {...shared}
          />
        </View>
      ) : null}
      {!nativePdf && !webMounted ? <ActivityIndicator /> : null}
    </View>
  )
}

function ReaderScreenSession({
  record,
  store,
  baseUrl,
  onBack,
  onRecordUpdated,
  closeRef,
  paneId = 'standalone',
  isActivePane = true,
  debugCensusToken,
  debugHoldSaveToken,
  ocr,
  extraOCR,
  onOcrError,
  onOcrTextsChange
}: ReaderScreenSessionProps) {
  const [initialNative] = useState(() =>
    usesNativePdfLayout(Platform.OS, record)
  )
  const [nativePdf, setNativePdf] = useState(initialNative)
  const [webMounted, setWebMounted] = useState(!initialNative)
  const [webRecord, setWebRecord] = useState(record)
  const [importing, setImporting] = useState(false)
  const [, setHandoffVersion] = useState(0)
  const [nativeRefreshToken, setNativeRefreshToken] = useState(0)
  const [persistLayoutMode, setPersistLayoutMode] = useState(false)
  const webRef = useRef<ReaderWebViewHandle>(null)
  const nativeRef = useRef<ReaderWebViewHandle>(null)
  const webCloseInFlight = useRef<PdfIdentity | null>(null)
  const nativeCloseInFlight = useRef<PdfIdentity | null>(null)
  const backNotified = useRef(false)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const [staged, setStaged] = useState<Awaited<
    ReturnType<typeof stageReaderDocument>
  > | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [initialWeb] = useState(() => identityFor(record.fileId, paneId, 0))
  const [nativeIdentity, setNativeIdentity] = useState(() =>
    identityFor(record.fileId, paneId, 1)
  )
  const [coordinator] = useState(
    () =>
      new PdfHandoffCoordinator(
        initialWeb,
        initialNative ? nativeIdentity : undefined
      )
  )
  const coordinatorRef = useRef(coordinator)
  coordinatorRef.current = coordinator
  const mounted = useRef(true)
  useEffect(() => {
    return () => {
      mounted.current = false
      coordinator.invalidate()
    }
  }, [coordinator])
  const sourceTokens = useRef(new Map<string, string>())
  const webIdentity = coordinator.snapshot.web
  if (!sourceTokens.current.has(webIdentity.sessionId)) {
    sourceTokens.current.set(webIdentity.sessionId, randomUUID())
  }
  const sourceToken = sourceTokens.current.get(webIdentity.sessionId)!
  useEffect(() => {
    logNativePdfDiagnostic('reader-pdf-route', {
      ...(nativePdf ? nativeIdentity : webIdentity),
      renderer: nativePdf ? 'pdfkit' : 'web',
      outerWebMounted: webMounted
    })
  }, [nativePdf, nativeIdentity, webIdentity, webMounted])

  // 设备取证：宿主显式请求时向当前 Web 侧采集一次页面画布渲染计数。
  const lastCensusToken = useRef(debugCensusToken)
  useEffect(() => {
    if (debugCensusToken === undefined) return
    if (lastCensusToken.current === debugCensusToken) return
    lastCensusToken.current = debugCensusToken
    logNativePdfDiagnostic('reader-pdf-page-render-census-request', {
      ...(nativePdf ? nativeIdentity : webIdentity),
      renderer: nativePdf ? 'pdfkit' : 'web',
      outerWebMounted: webMounted,
      token: debugCensusToken
    })
    // 同一机制两侧都发：原生向 PDFKit 服务请求，Web 对照向页面内真实 render 计数请求。
    if (nativePdf) nativeRef.current?.requestPageRenderCensus?.()
    else webRef.current?.requestPageRenderCensus?.()
  }, [debugCensusToken, nativePdf, nativeIdentity, webIdentity, webMounted])

  // 设备取证：制造可控的「待确认写入」窗口，供换源时观察 drain 包住 confirmed。
  const lastHoldToken = useRef(debugHoldSaveToken)
  useEffect(() => {
    if (debugHoldSaveToken === undefined) return
    if (lastHoldToken.current === debugHoldSaveToken) return
    lastHoldToken.current = debugHoldSaveToken
    const holdMs = 10000
    const accepted = nativePdf
      ? (nativeRef.current?.debugHoldNextSave?.(holdMs) ?? false)
      : false
    logNativePdfDiagnostic('reader-pdf-debug-held-save-request', {
      ...(nativePdf ? nativeIdentity : webIdentity),
      renderer: nativePdf ? 'pdfkit' : 'web',
      holdMs,
      accepted,
      token: debugHoldSaveToken
    })
  }, [debugHoldSaveToken, nativePdf, nativeIdentity, webIdentity])

  useEffect(() => {
    let active = true
    setStaged(null)
    setStageError(null)
    stageReaderDocument(baseUrl, record)
      .then((result) => {
        if (active) setStaged(result)
      })
      .catch((error: unknown) => {
        if (active) {
          setStageError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      active = false
    }
  }, [baseUrl, record, retry])

  function sync(scope: PdfHandoffCoordinator): void {
    if (mounted.current && coordinatorRef.current === scope)
      setHandoffVersion((value) => value + 1)
  }

  function notifyBack(scope: PdfHandoffCoordinator): void {
    if (
      !mounted.current ||
      coordinatorRef.current !== scope ||
      backNotified.current
    )
      return
    backNotified.current = true
    onBackRef.current()
  }

  async function mountFreshWeb(scope: PdfHandoffCoordinator): Promise<void> {
    const expected = scope.snapshot.web
    try {
      const persisted = await store.get(expected.fileId)
      if (
        !mounted.current ||
        coordinatorRef.current !== scope ||
        scope.snapshot.phase !== 'WEB_REFRESHING' ||
        !sameIdentity(scope.snapshot.web, expected)
      ) {
        return
      }
      setWebRecord(persisted ?? record)
      setNativePdf(false)
      setWebMounted(true)
      sync(scope)
    } catch (error) {
      if (!mounted.current || coordinatorRef.current !== scope) return
      Alert.alert(
        'Web 数据恢复失败',
        error instanceof Error ? error.message : String(error),
        [{ text: '重试', onPress: () => void mountFreshWeb(scope) }]
      )
    }
  }

  function showWebDrainError(
    scope: PdfHandoffCoordinator,
    result: Extract<BridgeCloseResult, { status: 'unconfirmed' }>
  ): void {
    Alert.alert(
      '旧 Web 数据尚未保存',
      `${result.reason}。原生阅读保持只读；确认旧数据后才能交接写权。`,
      [
        {
          text: '重试旧 Web 保存',
          onPress: () => {
            if (scope.retryWebDrain()) {
              sync(scope)
              void startWebClose(scope)
            }
          }
        },
        { text: '返回原阅读模式', onPress: () => requestWeb() },
        {
          text: '放弃未确认内容…',
          style: 'destructive',
          onPress: () => confirmDiscardWeb(scope)
        }
      ]
    )
  }

  function confirmDiscardWeb(scope: PdfHandoffCoordinator): void {
    const failed = scope.snapshot
    if (coordinatorRef.current !== scope || failed.phase !== 'WEB_DRAIN_FAILED')
      return
    Alert.alert(
      '放弃未确认内容？',
      '将保留已落盘的数据；未确认的修改和最终阅读进度可能丢失。已接收的写盘操作完成后返回原阅读模式。',
      [
        { text: '继续保留并重试', style: 'cancel' },
        {
          text: '放弃并返回原阅读模式',
          style: 'destructive',
          onPress: () => {
            if (coordinatorRef.current !== scope || scope.snapshot !== failed)
              return
            const nextWeb = identityFor(
              record.fileId,
              paneId,
              scope.snapshot.web.generation + 1
            )
            if (!scope.requestWeb(nextWeb)) return
            sync(scope)
            void startWebClose(scope, true)
          }
        }
      ]
    )
  }

  async function startWebClose(
    scope: PdfHandoffCoordinator,
    discard = false
  ): Promise<void> {
    const identity = scope.snapshot.web
    if (webCloseInFlight.current !== null) return
    webCloseInFlight.current = identity
    const startedAt = Date.now()
    logNativePdfDiagnostic('reader-pdf-handoff-barrier-start', {
      ...identity,
      direction: 'web',
      phase: scope.snapshot.phase,
      discard
    })
    const result = await closeWebSession(webRef, discard)
    logNativePdfDiagnostic('reader-pdf-handoff-barrier-end', {
      ...identity,
      direction: 'web',
      status: result.status,
      waitedMs: Date.now() - startedAt,
      discard,
      ...(result.status === 'unconfirmed' ? { reason: result.reason } : {})
    })
    if (!mounted.current || coordinatorRef.current !== scope) return
    const previousEpoch = scope.snapshot.epoch
    if (result.status === 'closed') scope.webDrained(identity)
    else scope.webDrainFailed(identity)
    if (scope.snapshot.epoch === previousEpoch && result.status === 'closed') {
      webCloseInFlight.current = null
      return
    }
    webCloseInFlight.current = null
    sync(scope)
    if (result.status === 'unconfirmed') {
      showWebDrainError(scope, result)
      return
    }
    setWebMounted(false)
    if (scope.snapshot.phase === 'NATIVE_REFRESHING') {
      setNativePdf(true)
      setNativeRefreshToken((value) => value + 1)
    } else if (scope.snapshot.phase === 'WEB_REFRESHING') {
      await mountFreshWeb(scope)
    } else if (scope.snapshot.phase === 'NATIVE_DRAINING') {
      await startNativeClose(scope)
    } else if (scope.snapshot.phase === 'CLOSED') {
      notifyBack(scope)
    }
  }

  function showNativeDrainError(scope: PdfHandoffCoordinator): void {
    Alert.alert('原生数据尚未保存', '已停留在原生页面，可重试保存后继续。', [
      {
        text: '重试保存',
        onPress: () => {
          if (scope.retryNativeDrain()) {
            sync(scope)
            void startNativeClose(scope, true)
          }
        }
      }
    ])
  }

  async function startNativeClose(
    scope: PdfHandoffCoordinator,
    retrySave = false
  ): Promise<void> {
    const identity = scope.snapshot.native
    if (!identity) return
    if (nativeCloseInFlight.current !== null) return
    nativeCloseInFlight.current = identity
    const startedAt = Date.now()
    logNativePdfDiagnostic('reader-pdf-handoff-barrier-start', {
      ...identity,
      direction: 'native',
      phase: scope.snapshot.phase,
      retrySave
    })
    const result = (await nativeRef.current?.close({ retry: retrySave })) ?? {
      status: 'closed'
    }
    logNativePdfDiagnostic('reader-pdf-handoff-barrier-end', {
      ...identity,
      direction: 'native',
      status: result?.status ?? 'closed',
      waitedMs: Date.now() - startedAt,
      ...(result?.status === 'unconfirmed' ? { reason: result.reason } : {})
    })
    if (!mounted.current || coordinatorRef.current !== scope) return
    const previous = scope.snapshot
    if (result?.status === 'closed') scope.nativeDrained(identity)
    else scope.nativeDrainFailed(identity)
    nativeCloseInFlight.current = null
    if (scope.snapshot === previous) return
    sync(scope)
    if (scope.snapshot.phase === 'NATIVE_DRAIN_FAILED') {
      showNativeDrainError(scope)
      return
    }
    setNativePdf(false)
    if (scope.snapshot.phase === 'WEB_REFRESHING') await mountFreshWeb(scope)
    else if (scope.snapshot.phase === 'CLOSED') notifyBack(scope)
  }

  function requestNative(): void {
    const scope = coordinator
    const nextNative = identityFor(
      record.fileId,
      paneId,
      nativeIdentity.generation + 1
    )
    if (!scope.requestNative(nextNative)) return
    setNativeIdentity(nextNative)
    setPersistLayoutMode(
      readerDataFromNativeSnapshot(
        webRecord.snapshot.data,
        webRecord.snapshot.progress
      )?.renderMode === 'text'
    )
    setNativePdf(true)
    setWebMounted(true)
    sync(scope)
    void startWebClose(scope)
  }

  function requestWeb(): void {
    const scope = coordinator
    const current = scope.snapshot
    const nextWeb =
      current.target === 'web' && current.nextWeb
        ? current.nextWeb
        : identityFor(record.fileId, paneId, current.web.generation + 1)
    const retry = current.phase === 'NATIVE_DRAIN_FAILED'
    if (!scope.requestWeb(nextWeb)) return
    sync(scope)
    if (scope.snapshot.phase === 'WEB_DRAINING') void startWebClose(scope)
    else if (scope.snapshot.phase === 'NATIVE_DRAINING') {
      void startNativeClose(scope, retry)
    }
  }

  function requestText(): void {
    if (nativeRef.current?.setRenderMode?.('text')) requestWeb()
  }

  function closeReader(): void {
    const scope = coordinator
    const retry = scope.snapshot.phase === 'NATIVE_DRAIN_FAILED'
    if (!scope.requestClosed()) return
    sync(scope)
    if (scope.snapshot.phase === 'WEB_DRAINING') void startWebClose(scope)
    else if (scope.snapshot.phase === 'NATIVE_DRAINING') {
      void startNativeClose(scope, retry)
    }
  }
  closeRef.current = () => {
    if (coordinator.snapshot.phase === 'CLOSED') {
      // A host can reuse the container after a completed library return.
      backNotified.current = false
      notifyBack(coordinator)
    } else closeReader()
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        closeReader()
        return true
      }
    )
    return () => subscription.remove()
  })

  const nativeHandoff: NativePdfHandoff = {
    identity: nativeIdentity,
    refreshToken: nativeRefreshToken,
    canWrite: (identity) => coordinator.canAccept(identity),
    assertWriter: (identity) => coordinator.assertWriter(identity),
    leaseEpoch: () => coordinator.snapshot.epoch,
    onAuthoritativeSnapshot: (identity, _snapshot) => {
      const granted = coordinator.nativeRefreshed(identity)
      if (granted) sync(coordinator)
      return granted
    },
    onOperationConfirmed: () => {
      if (coordinator.retryNativeDrain()) {
        sync(coordinator)
        void startNativeClose(coordinator)
      }
    }
  }
  const webHandoff = {
    identity: webIdentity,
    canWrite: (identity: PdfIdentity) => coordinator.canAccept(identity),
    assertWriter: (identity: PdfIdentity) => coordinator.assertWriter(identity),
    onReady: (identity: PdfIdentity) => {
      coordinator.webReady(identity)
      sync(coordinator)
    }
  }

  const importLegacy = async (): Promise<void> => {
    if (coordinator.snapshot.phase !== 'WEB_ACTIVE') {
      Alert.alert('交接期间不能导入', '请先完成或取消当前 PDF 交接。')
      return
    }
    setImporting(true)
    try {
      const updated = await pickLegacyJsonAndImport(store, record.fileId, () =>
        coordinator.assertWriter(coordinator.snapshot.web)
      )
      if (updated) {
        setWebRecord(updated)
        onRecordUpdated(updated)
        Alert.alert(
          '导入完成',
          `已导入 v${updated.legacyImport?.version ?? '?'} 高亮数据；重新打开文档后生效。`
        )
      }
    } catch (error) {
      Alert.alert(
        '导入失败',
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setImporting(false)
    }
  }

  const content = renderReaderContent({
    staged,
    stageError,
    onStageRetry: () => setRetry((value) => value + 1),
    nativePdf,
    webMounted,
    webRecord,
    record,
    webIdentity,
    sourceToken,
    webRef,
    nativeRef,
    webHandoff,
    nativeIdentity,
    nativeHandoff,
    store,
    isActivePane,
    persistLayoutMode,
    ocr,
    extraOCR,
    onOcrError,
    onOcrTextsChange
  })
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={closeReader} hitSlop={12}>
          <Text style={styles.back}>返回</Text>
        </Pressable>
        <View style={styles.headerMain}>
          <Text style={styles.title} numberOfLines={1}>
            {record.fileName}
          </Text>
          <Text style={styles.muted}>
            {record.format.toUpperCase()}
            {record.legacyImport
              ? ` · 旧数据 v${record.legacyImport.version}`
              : ''}
          </Text>
        </View>
        {isLocalIosPdf(Platform.OS, record) ? (
          <Pressable onPress={nativePdf ? requestText : requestNative}>
            <Text>{nativePdf ? 'Text' : 'Layout'}</Text>
          </Pressable>
        ) : null}
        {__DEV__ && isLocalIosPdf(Platform.OS, record) ? (
          <Pressable onPress={nativePdf ? requestWeb : requestNative}>
            <Text>{nativePdf ? 'Web 对照' : '原生 PDF 验证'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void importLegacy()}
          disabled={
            importing ||
            nativePdf ||
            coordinator.snapshot.phase !== 'WEB_ACTIVE'
          }
        >
          {importing ? (
            <ActivityIndicator size='small' color='#8b5e3c' />
          ) : (
            <Text style={styles.action}>导入旧数据</Text>
          )}
        </Pressable>
      </View>
      {content}
    </View>
  )
}

export function ReaderScreen(props: ReaderScreenProps) {
  const [generatedPaneId] = useState(() => `pane-${randomUUID()}`)
  const [active, setActive] = useState(props)
  const [replacement, setReplacement] = useState(0)
  const retained = useRef(props)
  const closeRef = useRef<(() => void) | null>(null)
  const switchRequested = useRef(false)
  const requested = useRef(props)
  requested.current = props
  const replacing =
    active.record.fileId !== props.record.fileId ||
    active.store !== props.store ||
    active.paneId !== props.paneId
  // A configured file switch uses the same save barrier as returning to the
  // library. Failed saves keep the old session mounted, including retry UI.
  useEffect(() => {
    if (replacing) {
      switchRequested.current = true
      closeRef.current?.()
    }
  }, [replacing, props.record.fileId, props.store, props.paneId])
  if (!replacing) retained.current = props
  const current = replacing ? retained.current : props
  const paneId = current.paneId ?? generatedPaneId
  return (
    <ReaderScreenSession
      key={JSON.stringify([paneId, current.record.fileId, replacement])}
      {...current}
      paneId={paneId}
      closeRef={closeRef}
      onBack={() => {
        const next = requested.current
        if (
          switchRequested.current ||
          next.record.fileId !== current.record.fileId ||
          next.store !== current.store ||
          next.paneId !== current.paneId
        ) {
          switchRequested.current = false
          setActive(next)
          setReplacement((value) => value + 1)
        } else next.onBack()
      }}
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  reader: { flex: 1 },
  // Keep the draining WKWebView laid out: stable-progress needs a nonzero
  // viewport and animation frames. The opaque native layer covers its input.
  nativeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f5f3ee'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd6ca'
  },
  headerMain: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: '#1f1d1a' },
  muted: { fontSize: 12, color: '#6d675f' },
  back: { color: '#8b5e3c', fontSize: 14 },
  action: { color: '#8b5e3c', fontSize: 13 }
})
