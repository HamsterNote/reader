import { StatusBar } from 'expo-status-bar'
import { useNavigation } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'

import type {
  HostDocumentRecord,
  HostDocumentSummary,
  ReaderDataStore
} from '../src/host/readerDataStore'
import { ReaderDataStore as Store } from '../src/host/readerDataStore'
import { logNativePdfDiagnostic } from '../src/nativePdf/diagnostics'
import { DebugEntryBar } from './src/debug/DebugEntryBar'
import {
  clearPaneRecord,
  EMPTY_PANES,
  hasAnyPane,
  mirrorActivePane,
  otherPane,
  resolveActivePane,
  setPaneRecord,
  withoutRecord,
  type PaneId,
  type PaneRecords
} from './src/debug/panes'
import { resolveDebugTarget } from './src/debug/resolveTarget'
import {
  debugRouteFromEnv,
  debugRouteLog,
  type DebugRoute
} from './src/debug/route'
import { pickAndCacheDocument, removeDocument } from './src/native/documents'
import { createFileSystemStorage } from './src/native/storage'
import {
  resolveReaderHeaderTitle,
  updateReaderNativeHeader
} from './src/nativeHeader'
import {
  preparePackagedWebReader,
  type PackagedWebReader
} from './src/native/webAssets'
import { LibraryScreen } from './src/screens/LibraryScreen'
import {
  ReaderScreen,
  type ReaderScreenHandle,
  type ReaderScreenHeaderState
} from './src/screens/ReaderScreen'
import { AppErrorBoundary } from './src/components/AppErrorBoundary'

type HostCloseAction = {
  readonly shouldClose: (pane: PaneId, fileId: string) => boolean
  readonly complete: () => void
  running: boolean
}

export function App({
  debugRoute
}: {
  readonly debugRoute?: DebugRoute | null
}) {
  return (
    <AppErrorBoundary>
      <AppContent debugRoute={debugRoute} />
    </AppErrorBoundary>
  )
}

function AppContent({
  debugRoute
}: {
  readonly debugRoute?: DebugRoute | null
}) {
  const navigation = useNavigation()
  const storeRef = useRef<ReaderDataStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new Store(createFileSystemStorage())
  }
  const store = storeRef.current
  const leftReader = useRef<ReaderScreenHandle>(null)
  const rightReader = useRef<ReaderScreenHandle>(null)
  const readerRefs = useRef({ left: leftReader, right: rightReader }).current
  const hostClose = useRef<HostCloseAction | null>(null)
  const queuedHostClose = useRef<HostCloseAction | null>(null)
  const [documents, setDocuments] = useState<HostDocumentSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [panes, setPanes] = useState<PaneRecords>(EMPTY_PANES)
  const [split, setSplit] = useState(false)
  const [activePane, setActivePane] = useState<PaneId>('left')
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [censusToken, setCensusToken] = useState(0)
  const [holdSaveToken, setHoldSaveToken] = useState(0)
  const [packaged, setPackaged] = useState<PackagedWebReader | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [headerStates, setHeaderStates] = useState<
    Partial<Record<PaneId, ReaderScreenHeaderState>>
  >({})
  const updateHeaderState = useCallback(
    (pane: string, state: ReaderScreenHeaderState): void => {
      if (pane !== 'left' && pane !== 'right') return
      setHeaderStates((current) => ({ ...current, [pane]: state }))
    },
    []
  )

  const refresh = useCallback(async (): Promise<void> => {
    const list = await store.list()
    setDocuments(list)
  }, [store])

  const prepare = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      const [webReader] = await Promise.all([
        preparePackagedWebReader(),
        refresh()
      ])
      setPackaged(webReader)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [refresh])

  useEffect(() => {
    void prepare()
  }, [prepare])

  const focusPane = resolveActivePane(panes, activePane)

  const openRecord = useCallback(
    (record: HostDocumentRecord): void => {
      setPanes((state) => setPaneRecord(state, focusPane, record))
    },
    [focusPane]
  )

  const pick = async (): Promise<void> => {
    setBusy(true)
    try {
      const picked = await pickAndCacheDocument(store)
      if (!picked) return
      await refresh()
      openRecord(picked.record)
    } catch (error) {
      Alert.alert(
        '无法打开文件',
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      setBusy(false)
    }
  }

  const open = async (summary: HostDocumentSummary): Promise<void> => {
    setBusy(true)
    try {
      const record = await store.get(summary.fileId)
      if (!record) {
        Alert.alert('文件记录不存在', '请重新选择该文件。')
        await refresh()
        return
      }
      openRecord(record)
    } finally {
      setBusy(false)
    }
  }

  const deleteDocument = async (
    summary: HostDocumentSummary
  ): Promise<void> => {
    const record = await store.get(summary.fileId)
    if (record) await removeDocument(store, record)
    setPanes((state) => withoutRecord(state, summary.fileId))
    await refresh()
  }

  const remove = (summary: HostDocumentSummary): void => {
    Alert.alert(
      '删除阅读数据',
      `将删除「${summary.fileName}」的标注、进度和缓存副本。原文件不受影响。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => void deleteDocument(summary)
        }
      ]
    )
  }

  const closePane = (pane: PaneId): void => {
    const next = clearPaneRecord(panes, pane)
    setPanes(next)
    const other = otherPane(pane)
    if (split && !next[pane] && next[other]) setActivePane(other)
    void refresh()
  }

  const runHostClose = useCallback(
    async (action: HostCloseAction): Promise<void> => {
      if (action.running) return
      action.running = true
      const results = await Promise.all(
        (['left', 'right'] as const).map(async (pane) => {
          const reader = readerRefs[pane].current
          if (!reader || !action.shouldClose(pane, reader.fileId))
            return { status: 'closed' as const }
          try {
            return await reader.close()
          } catch {
            return { status: 'unconfirmed' as const, reason: '关闭保存失败' }
          }
        })
      )
      action.running = false
      if (hostClose.current !== action) return
      if (results.some((result) => result.status !== 'closed')) {
        Alert.alert(
          '阅读数据尚未保存',
          '原栏与分栏状态已保留。请重试，全部保存确认后才会关闭。',
          [{ text: '重试', onPress: () => void runHostClose(action) }]
        )
        return
      }
      hostClose.current = null
      action.complete()
      void refresh()
      const queued = queuedHostClose.current
      queuedHostClose.current = null
      if (queued) {
        hostClose.current = queued
        void runHostClose(queued)
      }
    },
    [readerRefs, refresh]
  )

  const enqueueHostClose = useCallback(
    (action: HostCloseAction): void => {
      if (hostClose.current) {
        queuedHostClose.current = action
        return
      }
      hostClose.current = action
      void runHostClose(action)
    },
    [runHostClose]
  )

  const closeAll = (): void => {
    const pending = hostClose.current
    if (pending) {
      void runHostClose(pending)
      return
    }
    const action: HostCloseAction = {
      shouldClose: () => true,
      running: false,
      complete: () => {
        setPanes(EMPTY_PANES)
        setSourcePickerOpen(false)
      }
    }
    enqueueHostClose(action)
  }

  const handleReaderBack = (pane: PaneId): void => {
    const pending = hostClose.current
    if (pending) {
      void runHostClose(pending)
      return
    }
    closePane(pane)
  }

  /** 路由打开书库记录，开发环境还可从文件路径导入。 */
  const openDebugRoute = useCallback(
    async (route: DebugRoute): Promise<void> => {
      const outcome = await resolveDebugTarget(store, route.target)
      logNativePdfDiagnostic('reader-debug-route', {
        ...debugRouteLog(route),
        ok: outcome.status === 'opened',
        ...(outcome.status === 'failed' ? { reason: outcome.reason } : {})
      })
      if (outcome.status === 'failed') {
        Alert.alert('打开文件失败', outcome.reason)
        return
      }
      const record = outcome.record
      enqueueHostClose({
        shouldClose: (pane, fileId) =>
          pane === 'left'
            ? fileId !== record.fileId
            : route.layout === 'single',
        running: false,
        complete: () => {
          setSplit(route.layout === 'split')
          setPanes((state) => ({
            left: record,
            right: route.layout === 'split' ? (state.right ?? record) : null
          }))
          setActivePane('left')
          void refresh()
        }
      })
    },
    [store, refresh, enqueueHostClose]
  )

  const debugHandled = useRef(false)
  useEffect(() => {
    if (debugRoute) {
      void openDebugRoute(debugRoute)
      return
    }
    if (!__DEV__ || debugHandled.current) return
    debugHandled.current = true
    const envRoute = debugRouteFromEnv({
      EXPO_PUBLIC_HAM278_ROUTE: process.env.EXPO_PUBLIC_HAM278_ROUTE,
      EXPO_PUBLIC_HAM278_OPEN_FILE_ID:
        process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID,
      EXPO_PUBLIC_HAM278_OPEN_PDF: process.env.EXPO_PUBLIC_HAM278_OPEN_PDF,
      EXPO_PUBLIC_HAM278_LAYOUT: process.env.EXPO_PUBLIC_HAM278_LAYOUT
    })
    if (envRoute) void openDebugRoute(envRoute)
  }, [openDebugRoute, debugRoute])

  const toggleSplit = (): void => {
    const target = otherPane(focusPane)
    enqueueHostClose({
      shouldClose: (pane) => split && pane === target,
      running: false,
      complete: () => {
        if (split) {
          setPanes((state) => clearPaneRecord(state, target))
          setSplit(false)
          return
        }
        setPanes((state) => mirrorActivePane(state, focusPane))
        setSplit(true)
      }
    })
  }

  const replaceSource = (summary: HostDocumentSummary): void => {
    setSourcePickerOpen(false)
    void (async () => {
      const record = await store.get(summary.fileId)
      if (!record) {
        Alert.alert('文件记录不存在', '请重新选择该文件。')
        await refresh()
        return
      }
      // 换掉配置记录后 ReaderScreen 会先关闭旧会话并等待保存，成功才重开。
      setPanes((state) => setPaneRecord(state, focusPane, record))
    })()
  }

  const readerOpen = hasAnyPane(panes) && panes[focusPane] !== null
  const headerTitle = resolveReaderHeaderTitle(
    readerOpen,
    split,
    panes,
    focusPane,
    headerStates
  )
  useEffect(() => {
    updateReaderNativeHeader({
      navigation,
      readerRefs,
      focusPane,
      headerState: headerStates[focusPane],
      readerOpen,
      headerTitle
    })
  }, [focusPane, headerStates, headerTitle, navigation, readerOpen, readerRefs])

  if (loadError !== null) {
    return (
      <View style={styles.container}>
        <StatusBar style='dark' />
        <View style={styles.errorPanel}>
          <Text style={styles.errorTitle}>阅读资源未就绪</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Text style={styles.hint}>
            先运行 `yarn build:webview` 生成
            app/assets/webreader.zip，再重新构建 应用。
          </Text>
          <Pressable style={styles.button} onPress={() => void prepare()}>
            <Text style={styles.buttonText}>重试</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (packaged === null || busy) {
    return (
      <View style={styles.container}>
        <StatusBar style='dark' />
        <View style={styles.center}>
          <ActivityIndicator color='#8b5e3c' />
          <Text style={styles.hint}>
            {packaged === null ? '正在解压阅读资源…' : '正在处理文件…'}
          </Text>
        </View>
      </View>
    )
  }

  if (!hasAnyPane(panes)) {
    return (
      <View style={styles.container}>
        <StatusBar style='dark' />
        <LibraryScreen
          documents={documents}
          busy={busy}
          onPickDocument={() => void pick()}
          onOpenDocument={(summary) => void open(summary)}
          onRemoveDocument={remove}
        />
      </View>
    )
  }

  const openPanes = (['left', 'right'] as const)
    .map((pane) => ({ pane, record: panes[pane] }))
    .filter(
      (entry): entry is { pane: PaneId; record: HostDocumentRecord } =>
        entry.record !== null
    )
  const visiblePanes = split
    ? openPanes
    : openPanes.filter((entry) => entry.pane === focusPane)
  return (
    <View style={styles.container}>
      <StatusBar style='dark' />
      <View style={styles.workspace}>
        {__DEV__ ? (
          <DebugEntryBar
            split={split}
            activePane={focusPane}
            documents={documents}
            currentFileId={panes[focusPane]?.fileId ?? ''}
            sourcePickerOpen={sourcePickerOpen}
            onToggleSplit={toggleSplit}
            onActivatePane={setActivePane}
            onToggleSourcePicker={() => setSourcePickerOpen((value) => !value)}
            onReplaceSource={replaceSource}
            onRequestCensus={() => setCensusToken((value) => value + 1)}
            onHoldSave={() => setHoldSaveToken((value) => value + 1)}
            onClose={closeAll}
          />
        ) : null}
        <View style={styles.panes}>
          {visiblePanes.map(({ pane, record }) => (
            <View
              key={pane}
              style={[styles.pane, split && styles.paneBorder]}
              accessibilityLabel={`${pane}-pane`}
            >
              <ReaderScreen
                ref={readerRefs[pane]}
                record={record}
                store={store}
                entryUrl={packaged.entryUrl}
                baseUrl={packaged.baseUrl}
                paneId={pane}
                isActivePane={split ? pane === focusPane : true}
                debugCensusToken={censusToken}
                debugHoldSaveToken={holdSaveToken}
                onBack={() => handleReaderBack(pane)}
                onHeaderStateChange={updateHeaderState}
                onRecordUpdated={(updated) => {
                  setPanes((state) => setPaneRecord(state, pane, updated))
                  void refresh()
                }}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  workspace: { flex: 1 },
  panes: { flex: 1, flexDirection: 'row' },
  pane: { flex: 1 },
  paneBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#ddd6ca'
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { color: '#6d675f', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  errorPanel: {
    margin: 24,
    marginTop: 64,
    padding: 20,
    gap: 12,
    borderRadius: 14,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#ddd6ca'
  },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#b3261e' },
  errorBody: { color: '#4d473f' },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8b5e3c'
  },
  buttonText: { color: '#8b5e3c', fontWeight: '600' }
})
