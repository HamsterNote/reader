import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'

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

type ReaderScreenProps = {
  readonly record: HostDocumentRecord
  readonly store: ReaderDataStore
  readonly entryUrl: string
  readonly baseUrl: string
  readonly onBack: () => void
  readonly onRecordUpdated: (record: HostDocumentRecord) => void
}

export function ReaderScreen({
  record,
  store,
  baseUrl,
  onBack,
  onRecordUpdated
}: ReaderScreenProps) {
  const [importing, setImporting] = useState(false)
  const readerRef = useRef<ReaderWebViewHandle>(null)
  const closingRef = useRef(false)
  const [staged, setStaged] = useState<Awaited<
    ReturnType<typeof stageReaderDocument>
  > | null>(null)
  const [stageError, setStageError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setStaged(null)
    setStageError(null)
    stageReaderDocument(baseUrl, record)
      .then((result) => {
        if (active) setStaged(result)
      })
      .catch((error: unknown) => {
        if (active)
          setStageError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [baseUrl, record, retry])

  const closeReader = useCallback(async (): Promise<void> => {
    if (closingRef.current) return
    closingRef.current = true
    try {
      const result = await readerRef.current?.close()
      if (result !== undefined && result.status !== 'closed') {
        // 未确认写入：阻止关闭，保留会话与磁盘原件，提示重试。
        Alert.alert(
          '数据尚未保存',
          `${result.reason}。已停留在当前页面，请稍后重试。`
        )
        return
      }
      onBack()
    } finally {
      closingRef.current = false
    }
  }, [onBack])

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        void closeReader()
        return true
      }
    )
    return () => subscription.remove()
  }, [closeReader])

  const importLegacy = async (): Promise<void> => {
    setImporting(true)
    try {
      const updated = await pickLegacyJsonAndImport(store, record.fileId)
      if (updated) {
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

  let content = <ActivityIndicator />
  if (staged) {
    content = (
      <ReaderWebView
        key={`${record.fileId}:${record.legacyImport?.importedAt ?? 0}`}
        ref={readerRef}
        record={record}
        store={store}
        entryUrl={staged.entryUrl}
        baseUrl={staged.baseUrl}
        publicationUrl={staged.publicationUrl}
      />
    )
  } else if (stageError) {
    content = (
      <View>
        <Text role='alert'>{stageError}</Text>
        <Pressable onPress={() => setRetry((value) => value + 1)}>
          <Text>重试</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => void closeReader()} hitSlop={12}>
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
        <Pressable onPress={() => void importLegacy()} disabled={importing}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
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
