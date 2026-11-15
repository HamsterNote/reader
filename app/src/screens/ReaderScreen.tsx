import { NativePdfReader } from '../components/NativePdfReader'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type SessionKind = 'web' | 'native'
type CurrentSession = { readonly kind: SessionKind; readonly epoch: number }
type PendingHandoff = {
  readonly epoch: number
  readonly promise: Promise<void>
  readonly release: () => void
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
  const currentSessionRef = useRef<CurrentSession>({ kind: 'web', epoch: 0 })
  const modeEpochRef = useRef(0)
  const handoffRef = useRef<PendingHandoff | null>(null)
  const operationRef = useRef<Promise<unknown>>(Promise.resolve())
  const [webMounted, setWebMounted] = useState(true)
  const [webGeneration, setWebGeneration] = useState(0)
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
    const epoch = ++modeEpochRef.current
    currentSessionRef.current = {
      kind: currentSessionRef.current.kind,
      epoch
    }
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

  const nativeStore = useMemo(
    () =>
      new Proxy(store, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown
          if (typeof value !== 'function') return value
          return async (...args: unknown[]) => {
            await handoffRef.current?.promise
            return Reflect.apply(value, target, args)
          }
        }
      }),
    [store]
  )

  const queueOperation = (task: () => Promise<void>): Promise<void> => {
    const result = operationRef.current.then(task, task)
    operationRef.current = result.catch(() => undefined)
    return result
  }

  const isCurrent = (kind: SessionKind, epoch: number): boolean =>
    currentSessionRef.current.kind === kind &&
    currentSessionRef.current.epoch === epoch

  const cancelNativeEntry = (epoch: number): void => {
    if (!isCurrent('native', epoch)) return
    currentSessionRef.current = {
      kind: 'web',
      epoch: ++modeEpochRef.current
    }
    setNativePdf(false)
    handoffRef.current?.release()
  }

  const retireWebForNative = async (epoch: number): Promise<void> => {
    const handoff = handoffRef.current
    if (!handoff || handoff.epoch !== epoch) return
    let result: BridgeCloseResult | undefined
    try {
      result = await webReaderRef.current?.close()
    } catch (error) {
      result = {
        status: 'unconfirmed',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
    if (!isCurrent('native', epoch) || handoffRef.current !== handoff) return
    if (result === undefined || result.status === 'closed') {
      setWebMounted(false)
      handoff.release()
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
        {
          text: '返回 Web 对照',
          onPress: () => cancelNativeEntry(epoch),
          style: 'cancel'
        }
      ]
    )
  }

  const closeReader = useCallback(async (): Promise<void> => {
    if (closingRef.current) return
    closingRef.current = true
    void queueOperation(async () => {
      try {
        const startingKind = currentSessionRef.current.kind
        if (startingKind === 'native') await handoffRef.current?.promise
        const startingHandle =
          startingKind === 'native'
            ? nativeReaderRef.current
            : webReaderRef.current
        const result = await startingHandle?.close()
        if (result !== undefined && result.status !== 'closed') {
          Alert.alert(
            '数据尚未保存',
            `${result.reason}。已停留在当前页面，请稍后重试。`
          )
          return
        }
        if (
          startingKind === 'web' &&
          currentSessionRef.current.kind === 'native'
        ) {
          await handoffRef.current?.promise
          const nativeResult = await nativeReaderRef.current?.close()
          if (nativeResult !== undefined && nativeResult.status !== 'closed') {
            Alert.alert(
              '数据尚未保存',
              `${nativeResult.reason}。已停留在当前页面，请稍后重试。`
            )
            return
          }
        }
        onBack()
      } finally {
        closingRef.current = false
      }
    })
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
      <>
        {webMounted ? (
          <View style={nativePdf ? styles.inactiveReader : styles.activeReader}>
            <ReaderWebView
              key={`${record.fileId}:${record.legacyImport?.importedAt ?? 0}:${webGeneration}`}
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
              store={nativeStore}
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
              if (currentSessionRef.current.kind === 'native') {
                const epoch = currentSessionRef.current.epoch
                void queueOperation(async () => {
                  await handoffRef.current?.promise
                  if (!isCurrent('native', epoch)) return
                  const result = await nativeReaderRef.current?.close()
                  if (!isCurrent('native', epoch)) return
                  if (!result || result.status === 'closed') {
                    currentSessionRef.current = {
                      kind: 'web',
                      epoch: ++modeEpochRef.current
                    }
                    setWebGeneration((value) => value + 1)
                    setWebMounted(true)
                    setNativePdf(false)
                  } else {
                    Alert.alert(
                      '数据尚未保存',
                      `${result.reason}。原生页面保持打开，请重试。`
                    )
                  }
                })
                return
              }
              const epoch = ++modeEpochRef.current
              currentSessionRef.current = { kind: 'native', epoch }
              setNativePdf(true)
              let release!: () => void
              const promise = new Promise<void>((resolve) => {
                release = resolve
              })
              handoffRef.current = { epoch, promise, release }
              operationRef.current = operationRef.current.then(
                () => promise,
                () => promise
              )
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
