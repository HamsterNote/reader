import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
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
  parseDebugUrl,
  type DebugRoute
} from './src/debug/route'
import { pickAndCacheDocument, removeDocument } from './src/native/documents'
import { createFileSystemStorage } from './src/native/storage'
import {
  preparePackagedWebReader,
  type PackagedWebReader
} from './src/native/webAssets'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { ReaderScreen } from './src/screens/ReaderScreen'
import { AppErrorBoundary } from './src/components/AppErrorBoundary'

export function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  )
}

function AppContent() {
  const storeRef = useRef<ReaderDataStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new Store(createFileSystemStorage())
  }
  const store = storeRef.current
  const [documents, setDocuments] = useState<HostDocumentSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [panes, setPanes] = useState<PaneRecords>(EMPTY_PANES)
  const [split, setSplit] = useState(false)
  const [activePane, setActivePane] = useState<PaneId>('left')
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [packaged, setPackaged] = useState<PackagedWebReader | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  const closeAll = (): void => {
    setPanes(EMPTY_PANES)
    setSourcePickerOpen(false)
    void refresh()
  }

  /** 调试入口（仅 __DEV__）：深链接 / 环境变量直接指定 PDF，不依赖 HID 点击。 */
  const openDebugRoute = useCallback(
    async (route: DebugRoute): Promise<void> => {
      const outcome = await resolveDebugTarget(store, route.target)
      logNativePdfDiagnostic('reader-debug-route', {
        ...debugRouteLog(route),
        ok: outcome.status === 'opened',
        ...(outcome.status === 'failed' ? { reason: outcome.reason } : {})
      })
      if (outcome.status === 'failed') {
        Alert.alert('调试入口失败', outcome.reason)
        return
      }
      setSplit(route.layout === 'split')
      setPanes((state) =>
        mirrorActivePane(setPaneRecord(state, 'left', outcome.record), 'left')
      )
      setActivePane('left')
      void refresh()
    },
    [store, refresh]
  )

  const debugHandled = useRef(false)
  useEffect(() => {
    if (!__DEV__) return
    void (async () => {
      if (debugHandled.current) return
      debugHandled.current = true
      const envRoute = debugRouteFromEnv({
        EXPO_PUBLIC_HAM278_ROUTE: process.env.EXPO_PUBLIC_HAM278_ROUTE,
        EXPO_PUBLIC_HAM278_OPEN_FILE_ID:
          process.env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID,
        EXPO_PUBLIC_HAM278_OPEN_PDF: process.env.EXPO_PUBLIC_HAM278_OPEN_PDF,
        EXPO_PUBLIC_HAM278_LAYOUT: process.env.EXPO_PUBLIC_HAM278_LAYOUT
      })
      if (envRoute) {
        await openDebugRoute(envRoute)
        return
      }
      const initial = await Linking.getInitialURL().catch(() => null)
      const parsed = initial ? parseDebugUrl(initial) : null
      if (parsed) await openDebugRoute(parsed)
    })()
  }, [openDebugRoute])

  useEffect(() => {
    if (!__DEV__) return
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const parsed = parseDebugUrl(url)
      logNativePdfDiagnostic('reader-debug-route-link', {
        url,
        accepted: parsed !== null
      })
      if (parsed) void openDebugRoute(parsed)
    })
    return () => subscription.remove()
  }, [openDebugRoute])

  const toggleSplit = (): void => {
    if (split) {
      setSplit(false)
      return
    }
    setPanes((state) => mirrorActivePane(state, focusPane))
    setSplit(true)
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

  if (loadError !== null) {
    return (
      <SafeAreaView style={styles.container}>
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
      </SafeAreaView>
    )
  }

  if (packaged === null || busy) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style='dark' />
        <View style={styles.center}>
          <ActivityIndicator color='#8b5e3c' />
          <Text style={styles.hint}>
            {packaged === null ? '正在解压阅读资源…' : '正在处理文件…'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (!hasAnyPane(panes)) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style='dark' />
        <LibraryScreen
          documents={documents}
          busy={busy}
          onPickDocument={() => void pick()}
          onOpenDocument={(summary) => void open(summary)}
          onRemoveDocument={remove}
        />
      </SafeAreaView>
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
    <SafeAreaView style={styles.container}>
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
                record={record}
                store={store}
                entryUrl={packaged.entryUrl}
                baseUrl={packaged.baseUrl}
                paneId={pane}
                isActivePane={split ? pane === focusPane : true}
                onBack={() => closePane(pane)}
                onRecordUpdated={(updated) => {
                  setPanes((state) => setPaneRecord(state, pane, updated))
                  void refresh()
                }}
              />
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
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
