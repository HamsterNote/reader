import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import { DebugEntryBar } from './src/debug/DebugEntryBar'
import { pickAndCacheDocument, removeDocument } from './src/native/documents'
import { createFileSystemStorage } from './src/native/storage'
import {
  preparePackagedWebReader,
  type PackagedWebReader
} from './src/native/webAssets'
import { LibraryScreen } from './src/screens/LibraryScreen'
import {
  ReaderScreen,
  type ReaderScreenHandle
} from './src/screens/ReaderScreen'
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
  const readerRef = useRef<ReaderScreenHandle>(null)
  const closeInFlight = useRef<Promise<void> | null>(null)
  const [documents, setDocuments] = useState<HostDocumentSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [record, setRecord] = useState<HostDocumentRecord | null>(null)
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [censusToken, setCensusToken] = useState(0)
  const [holdSaveToken, setHoldSaveToken] = useState(0)
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

  const openRecord = useCallback((next: HostDocumentRecord): void => {
    setRecord(next)
  }, [])

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
      const next = await store.get(summary.fileId)
      if (!next) {
        Alert.alert('文件记录不存在', '请重新选择该文件。')
        await refresh()
        return
      }
      openRecord(next)
    } finally {
      setBusy(false)
    }
  }

  const deleteDocument = async (
    summary: HostDocumentSummary
  ): Promise<void> => {
    const current = await store.get(summary.fileId)
    if (current) await removeDocument(store, current)
    setRecord((value) => (value?.fileId === summary.fileId ? null : value))
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

  const returnToLibrary = (): void => {
    setRecord(null)
    setSourcePickerOpen(false)
    void refresh()
  }

  const closeAll = async (): Promise<void> => {
    if (closeInFlight.current) return closeInFlight.current
    const operation = (async () => {
      const result = (await readerRef.current?.close()) ?? {
        status: 'closed' as const
      }
      if (result.status === 'closed') {
        returnToLibrary()
        return
      }
      Alert.alert(
        '阅读数据尚未保存',
        '当前页面已保留。请重试，保存确认后才会关闭。',
        [{ text: '重试', onPress: () => void closeAll() }]
      )
    })()
    closeInFlight.current = operation
    try {
      await operation
    } finally {
      closeInFlight.current = null
    }
  }

  const replaceSource = (summary: HostDocumentSummary): void => {
    setSourcePickerOpen(false)
    void (async () => {
      const next = await store.get(summary.fileId)
      if (!next) {
        Alert.alert('文件记录不存在', '请重新选择该文件。')
        await refresh()
        return
      }
      // 换掉配置记录后 ReaderScreen 会先关闭旧会话并等待保存，成功才重开。
      setRecord(next)
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

  if (record === null) {
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style='dark' />
      <View style={styles.workspace}>
        {__DEV__ ? (
          <DebugEntryBar
            documents={documents}
            currentFileId={record.fileId}
            sourcePickerOpen={sourcePickerOpen}
            onToggleSourcePicker={() => setSourcePickerOpen((value) => !value)}
            onReplaceSource={replaceSource}
            onRequestCensus={() => setCensusToken((value) => value + 1)}
            onHoldSave={() => setHoldSaveToken((value) => value + 1)}
            onClose={() => void closeAll()}
          />
        ) : null}
        <View style={styles.reader}>
          <ReaderScreen
            ref={readerRef}
            record={record}
            store={store}
            entryUrl={packaged.entryUrl}
            baseUrl={packaged.baseUrl}
            paneId='left'
            isActivePane
            debugCensusToken={censusToken}
            debugHoldSaveToken={holdSaveToken}
            onBack={returnToLibrary}
            onRecordUpdated={(updated) => {
              setRecord(updated)
              void refresh()
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  workspace: { flex: 1 },
  reader: { flex: 1 },
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
