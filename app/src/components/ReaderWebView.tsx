import { randomUUID } from 'expo-crypto'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewProps
} from 'react-native-webview'

import { READER_BRIDGE_PROTOCOL_VERSION } from '../../../src/bridge/protocol'
import type { BridgeCloseResult } from '../../../src/bridge/hostSession'
import {
  decideReaderNavigation,
  type ReaderNavigationContext
} from '../../../src/host/navigationPolicy'
import type {
  HostDocumentRecord,
  ReaderDataStore
} from '../../../src/host/readerDataStore'
import {
  createReaderHostSession,
  type ReaderHostSession
} from '../../../src/host/readerHostSession'

type ReaderWebViewProps = {
  readonly record: HostDocumentRecord
  readonly store: ReaderDataStore
  readonly entryUrl: string
  readonly baseUrl: string
  readonly publicationUrl: string
}

type HostState = 'loading' | 'connected' | 'error'

const HANDSHAKE_TIMEOUT_MS = 8000
// The pinned iOS patch uses this full list to suppress WKContentView menus,
// without installing react-native-webview's custom long-press recognizer.
const SUPPRESSED_READER_MENU_ITEMS: WebViewProps['suppressMenuItems'] = [
  'copy',
  'lookup',
  'translate',
  'share',
  'cut',
  'paste',
  'replace',
  'select',
  'selectAll',
  'bold',
  'italic',
  'underline'
]

function buildBootstrapScript(sessionId: string, sourceToken: string): string {
  const payload = JSON.stringify({ sessionId, sourceToken }).replace(
    /</g,
    '\\u003c'
  )
  return `
    window.__READER_HOST__ = Object.freeze(${payload});
    window.__READER_HOST_SECURITY__ = Object.freeze({
      protocolVersion: ${READER_BRIDGE_PROTOCOL_VERSION},
      publicationScripts: false,
      allowExternalNavigation: false
    });
    true;
  `
}

/** 关闭握手入口：宿主 UI 必须先 await close() 再卸载 WebView。 */
export type ReaderWebViewHandle = {
  readonly close: () => Promise<BridgeCloseResult>
}

export const ReaderWebView = forwardRef<
  ReaderWebViewHandle,
  ReaderWebViewProps
>(function ReaderWebView(
  { record, store, entryUrl, baseUrl, publicationUrl },
  ref
) {
  const webRef = useRef<WebView>(null)
  const sessionRef = useRef<ReaderHostSession | null>(null)
  const openedRef = useRef(false)
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<HostState>('loading')
  const [statusText, setStatusText] = useState('正在加载阅读资源…')
  // Native failures remain visible despite late bridge/load/timeout events.
  // Only an explicit reload clears the diagnostic; never auto-reload edits.
  const [hostError, setHostError] = useState<string | null>(null)
  const sessionId = useMemo(() => randomUUID(), [])
  const sourceToken = useMemo(() => randomUUID(), [])

  // 关闭握手入口：UI 先 await close()，成功后才允许卸载 WebView。
  useImperativeHandle(
    ref,
    () => ({
      close: async (): Promise<BridgeCloseResult> => {
        const session = sessionRef.current
        if (session === null) return { status: 'closed' }
        return session.close()
      }
    }),
    []
  )

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'inactive' || next === 'background') {
        const session = sessionRef.current
        session
          ?.flush()
          .then((result) => {
            if (session !== sessionRef.current) return
            if (result.status === 'unconfirmed')
              setStatusText('后台保存未确认，可继续阅读或重试')
          })
          .catch(() => {
            /* The confirmed snapshot remains authoritative. */
          })
      }
    })
    return () => subscription.remove()
  }, [])

  // 宿主会话随文档创建一次，不随 WebView 重载（generation）重建：
  // 会话内的已确认快照、幂等表与在途持久化队列在重载后仍然有效，
  // 页面重新 ready 时 restore 总是取最新确认数据，而不是打开时的旧 prop。
  useEffect(() => {
    // 新快照键损坏：不建立会话、不渲染阅读器，也不允许任何保存覆盖原件。
    if (record.snapshotError !== undefined) return
    const session = createReaderHostSession({
      sessionId,
      sourceToken,
      descriptor: {
        fileId: record.fileId,
        format: record.format,
        fileUrl: publicationUrl
      },
      confirmedSnapshot: record.snapshot,
      persist: (snapshot, previous) =>
        previous
          ? store.saveRebasedSnapshot(record.fileId, previous, snapshot)
          : store.saveSnapshot(record.fileId, snapshot),
      sendToWeb: (message) => {
        webRef.current?.postMessage(JSON.stringify(message))
      }
    })
    sessionRef.current = session
    return () => {
      session.dispose()
      sessionRef.current = null
    }
  }, [record, sessionId, sourceToken, store, publicationUrl])

  // WebView 每次（重）加载都只重置握手状态与超时；会话保持不变。
  useEffect(() => {
    openedRef.current = false
    setState('loading')
    setStatusText('正在加载阅读资源…')
    const timer = setTimeout(() => {
      if (openedRef.current) return
      setState('error')
      setStatusText('WebView 未完成握手（8 秒超时）')
    }, HANDSHAKE_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [generation])

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    const pending = sessionRef.current?.handleRawMessage(event.nativeEvent.data)
    if (!pending) return
    const outcome = await pending
    if (outcome.accepted) {
      openedRef.current = true
      setState('connected')
      setStatusText('已连接')
    } else {
      setState('error')
      setStatusText(`拒绝消息：${outcome.rejection?.code ?? 'INVALID_MESSAGE'}`)
    }
  }, [])

  const handleNavigation = useCallback(
    (request: ReaderNavigationContext & { readonly url: string }): boolean => {
      const decision = decideReaderNavigation(request.url, entryUrl, request)
      if (decision.action === 'allow') return true
      if (decision.action === 'external') {
        // 外链不进入阅读 WebView；交给系统浏览器，且仅在用户操作后发生。
        Linking.openURL(decision.url).catch(() => undefined)
        return false
      }
      setStatusText(`已拦截导航：${decision.reason}`)
      return false
    },
    [entryUrl]
  )

  const retry = (): void => {
    setHostError(null)
    setGeneration((current) => current + 1)
    setState('loading')
    setStatusText('正在重新加载…')
  }

  const reportHostError = (eventType: string, description: string): void => {
    const diagnostic = `${eventType}: ${description}`
    console.error('Reader WebView host error', diagnostic)
    setHostError(diagnostic)
    setState('error')
  }

  return (
    <View style={styles.container}>
      {record.snapshotError !== undefined ? (
        <View style={styles.overlay} pointerEvents='box-none'>
          <View style={styles.panel}>
            <Text style={styles.status}>
              该文档的标注数据无法读取：{record.snapshotError}
            </Text>
            <Text style={styles.linkText}>
              原始数据已保留，未自动退回旧格式。请勿继续编辑；可在书库删除该文档的阅读数据后重新打开。
            </Text>
          </View>
        </View>
      ) : (
        <>
          <WebView
            ref={webRef}
            key={`${record.fileId}-${generation}`}
            source={{ uri: entryUrl }}
            originWhitelist={['*']}
            injectedJavaScriptBeforeContentLoaded={buildBootstrapScript(
              sessionId,
              sourceToken
            )}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode='never'
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            suppressMenuItems={SUPPRESSED_READER_MENU_ITEMS}
            allowingReadAccessToURL={baseUrl}
            onShouldStartLoadWithRequest={handleNavigation}
            onMessage={handleMessage}
            onError={({ nativeEvent }) => {
              reportHostError(
                'onError',
                `${nativeEvent.description} (code=${nativeEvent.code}, domain=${nativeEvent.domain ?? 'unknown'})`
              )
            }}
            onHttpError={({ nativeEvent }) => {
              reportHostError(
                'onHttpError',
                `HTTP ${nativeEvent.statusCode}: ${nativeEvent.description ?? '资源加载失败'}`
              )
            }}
            onContentProcessDidTerminate={() => {
              reportHostError(
                'onContentProcessDidTerminate',
                'iOS WebView 内容进程已终止（系统未提供原因）'
              )
            }}
            onRenderProcessGone={({ nativeEvent }) => {
              reportHostError(
                'onRenderProcessGone',
                `Android WebView 渲染进程已退出 (didCrash=${nativeEvent.didCrash})`
              )
            }}
            onLoadEnd={() => {
              if (!openedRef.current) setStatusText('页面已加载，等待桥接握手…')
            }}
            style={styles.webview}
          />
          {hostError !== null || state !== 'connected' ? (
            <View style={styles.overlay} pointerEvents='box-none'>
              <View style={styles.panel}>
                {hostError === null && state === 'loading' ? (
                  <ActivityIndicator size='small' color='#8b5e3c' />
                ) : null}
                {hostError !== null ? (
                  <ScrollView style={styles.diagnostic}>
                    <Text role='alert' selectable style={styles.status}>
                      阅读宿主发生错误，请截图此信息{'\n'}
                      {hostError}
                    </Text>
                  </ScrollView>
                ) : (
                  <Text style={styles.status}>{statusText}</Text>
                )}
                {hostError !== null || state === 'error' ? (
                  <>
                    <TouchableOpacity style={styles.button} onPress={retry}>
                      <Text style={styles.buttonText}>重载 WebView</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.linkButton}
                      onPress={() =>
                        Alert.alert(
                          '浏览记录',
                          '宿主已确认的数据不受 WebView 重载影响；未确认的修改会丢失。'
                        )
                      }
                    >
                      <Text style={styles.linkText}>数据会怎样？</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  panel: {
    minWidth: 240,
    maxWidth: 320,
    alignItems: 'center',
    gap: 12,
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#fffdf8',
    borderWidth: 1,
    borderColor: '#ddd6ca'
  },
  status: { color: '#4d473f', textAlign: 'center' },
  diagnostic: { maxHeight: 240, alignSelf: 'stretch' },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8b5e3c'
  },
  buttonText: { color: '#8b5e3c', fontWeight: '600' },
  linkButton: { padding: 4 },
  linkText: { color: '#8b5e3c', fontSize: 12 }
})
