import {
  NativePdfReader,
  type NativePdfHandoff
} from '../components/NativePdfReader'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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

type ReaderScreenProps = {
  readonly record: HostDocumentRecord
  readonly store: ReaderDataStore
  readonly entryUrl: string
  readonly baseUrl: string
  readonly onBack: () => void
  readonly onRecordUpdated: (record: HostDocumentRecord) => void
  readonly ocr?: boolean | ReaderOcrOptions
  readonly extraOCR?: ReaderExtraOcr
  readonly onOcrError?: (error: unknown, detail: { pageNumber: number }) => void
  readonly onOcrTextsChange?: (
    pageNumber: number,
    texts: IntermediateText[]
  ) => void
}

function identityFor(fileId: string, generation: number): PdfIdentity {
  return {
    fileId,
    paneId: 'development',
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
    <>
      {webMounted ? (
        <View style={nativePdf ? styles.hidden : styles.reader}>
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
        <NativePdfReader
          key={nativeIdentity.sessionId}
          ref={nativeRef}
          record={record}
          handoff={nativeHandoff}
          {...shared}
        />
      ) : null}
      {!nativePdf && !webMounted ? <ActivityIndicator /> : null}
    </>
  )
}

function ReaderScreenSession({
  record,
  store,
  baseUrl,
  onBack,
  onRecordUpdated,
  ocr,
  extraOCR,
  onOcrError,
  onOcrTextsChange
}: ReaderScreenProps) {
  const [nativePdf, setNativePdf] = useState(false)
  const [webMounted, setWebMounted] = useState(true)
  const [webRecord, setWebRecord] = useState(record)
  const [importing, setImporting] = useState(false)
  const [, setHandoffVersion] = useState(0)
  const [nativeRefreshToken, setNativeRefreshToken] = useState(0)
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
  const [initialWeb] = useState(() => identityFor(record.fileId, 0))
  const [coordinator] = useState(() => new PdfHandoffCoordinator(initialWeb))
  const [nativeIdentity] = useState(() => identityFor(record.fileId, 1))
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
        { text: '返回 Web 对照', onPress: () => requestWeb() }
      ]
    )
  }

  async function startWebClose(scope: PdfHandoffCoordinator): Promise<void> {
    const identity = scope.snapshot.web
    if (webCloseInFlight.current !== null) return
    webCloseInFlight.current = identity
    let result: BridgeCloseResult
    try {
      result = (await webRef.current?.close({ handoff: true })) ?? {
        status: 'closed'
      }
    } catch (error) {
      result = {
        status: 'unconfirmed',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
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
    const identity = nativeIdentity
    if (nativeCloseInFlight.current !== null) return
    nativeCloseInFlight.current = identity
    const result = await nativeRef.current?.close({ retry: retrySave })
    if (!mounted.current || coordinatorRef.current !== scope) return
    const previousEpoch = scope.snapshot.epoch
    if (result?.status === 'closed') scope.nativeDrained(identity)
    else scope.nativeDrainFailed(identity)
    nativeCloseInFlight.current = null
    if (scope.snapshot.epoch === previousEpoch) return
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
    if (!scope.requestNative(nativeIdentity)) return
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
        : identityFor(record.fileId, current.web.generation + 1)
    const retry = current.phase === 'NATIVE_DRAIN_FAILED'
    if (!scope.requestWeb(nextWeb)) return
    sync(scope)
    if (scope.snapshot.phase === 'WEB_DRAINING') void startWebClose(scope)
    else if (scope.snapshot.phase === 'NATIVE_DRAINING') {
      void startNativeClose(scope, retry)
    }
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
        {__DEV__ && record.format === 'pdf' ? (
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
  return <ReaderScreenSession key={props.record.fileId} {...props} />
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  reader: { flex: 1 },
  hidden: { display: 'none' },
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
