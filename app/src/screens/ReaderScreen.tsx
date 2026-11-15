import { NativePdfReader } from '../components/NativePdfReader'
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
import type { BridgeCloseResult } from '../../../src/bridge/hostSession'
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

export function ReaderScreen({
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
  const nativePdfRef = useRef(false)
  const modeEpochRef = useRef(0)
  const [webMounted, setWebMounted] = useState(true)
  const [importing, setImporting] = useState(false)
  const webReaderRef = useRef<ReaderWebViewHandle>(null)
  const nativeReaderRef = useRef<ReaderWebViewHandle>(null)
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
      const readers = nativePdfRef.current
        ? [nativeReaderRef.current, webReaderRef.current]
        : [webReaderRef.current]
      const results = await Promise.all(
        readers.map((reader) => reader?.close())
      )
      const failed = results.find(
        (result) => result !== undefined && result.status !== 'closed'
      )
      if (failed) {
        Alert.alert(
          '数据尚未保存',
          `${failed.reason}。已停留在当前页面，请稍后重试。`
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

  const retireWebForNative = async (epoch: number): Promise<void> => {
    let result: BridgeCloseResult | undefined
    try {
      result = await webReaderRef.current?.close()
    } catch (error) {
      result = {
        status: 'unconfirmed',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
    if (modeEpochRef.current !== epoch || !nativePdfRef.current) return
    if (result === undefined || result.status === 'closed') {
      setWebMounted(false)
      return
    }
    Alert.alert(
      '旧 Web 数据尚未保存',
      '原生阅读已打开；旧 Web 会话仍保留以便重试，不会丢弃未确认写入。',
      [
        {
          text: '重试保存',
          onPress: () => {
            void retireWebForNative(epoch)
          }
        },
        { text: '取消', style: 'cancel' }
      ]
    )
  }

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
      <>
        {webMounted ? (
          <View style={nativePdf ? styles.inactiveReader : styles.activeReader}>
            <ReaderWebView
              key={`${record.fileId}:${record.legacyImport?.importedAt ?? 0}`}
              ref={webReaderRef}
              record={record}
              store={store}
              entryUrl={staged.entryUrl}
              baseUrl={staged.baseUrl}
              publicationUrl={staged.publicationUrl}
            />
          </View>
        ) : null}
        {nativePdf ? (
          <View style={styles.activeReader}>
            <NativePdfReader
              key={`${record.fileId}:${record.legacyImport?.importedAt ?? 0}`}
              ref={nativeReaderRef}
              record={record}
              store={store}
              entryUrl={staged.entryUrl}
              baseUrl={staged.baseUrl}
              publicationUrl={staged.publicationUrl}
              ocr={ocr}
              extraOCR={extraOCR}
              onOcrError={onOcrError}
              onOcrTextsChange={onOcrTextsChange}
            />
          </View>
        ) : null}
      </>
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
        {__DEV__ && record.format === 'pdf' ? (
          <Pressable
            onPress={() => {
              if (nativePdfRef.current) {
                void (async () => {
                  const epoch = ++modeEpochRef.current
                  const result = await nativeReaderRef.current?.close()
                  if (modeEpochRef.current !== epoch || !nativePdfRef.current)
                    return
                  if (!result || result.status === 'closed') {
                    setWebMounted(true)
                    nativePdfRef.current = false
                    setNativePdf(false)
                  } else {
                    Alert.alert(
                      '数据尚未保存',
                      `${result.reason}。原生页面保持打开，请重试。`
                    )
                  }
                })()
                return
              }
              const epoch = ++modeEpochRef.current
              nativePdfRef.current = true
              setNativePdf(true)
              void retireWebForNative(epoch)
            }}
          >
            <Text>{nativePdf ? 'Web 对照' : '原生 PDF 验证'}</Text>
          </Pressable>
        ) : null}
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
  activeReader: { flex: 1 },
  inactiveReader: { display: 'none' },
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
