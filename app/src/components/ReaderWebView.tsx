import { randomUUID } from 'expo-crypto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
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

export function ReaderWebView({
  record,
  store,
  entryUrl,
  baseUrl,
  publicationUrl
}: ReaderWebViewProps) {
  const webRef = useRef<WebView>(null)
  const sessionRef = useRef<ReaderHostSession | null>(null)
  const openedRef = useRef(false)
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<HostState>('loading')
  const [statusText, setStatusText] = useState('正在加载阅读资源…')
  const sessionId = useMemo(() => randomUUID(), [])
  const sourceToken = useMemo(() => randomUUID(), [])

  // 宿主会话随文档创建一次，不随 WebView 重载（generation）重建：
  // 会话内的已确认快照、幂等表与在途持久化队列在重载后仍然有效，
  // 页面重新 ready 时 restore 总是取最新确认数据，而不是打开时的旧 prop。
  useEffect(() => {
    const session = createReaderHostSession({
      sessionId,
      sourceToken,
      descriptor: {
        fileId: record.fileId,
        format: record.format,
        fileUrl: publicationUrl
      },
      confirmedSnapshot: record.snapshot,
      persist: (snapshot) => store.saveSnapshot(record.fileId, snapshot),
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
    setGeneration((current) => current + 1)
    setState('loading')
    setStatusText('正在重新加载…')
  }

  return (
    <View style={styles.container}>
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
          setState('error')
          setStatusText(`WebView 错误：${nativeEvent.description}`)
        }}
        onHttpError={({ nativeEvent }) => {
          setState('error')
          setStatusText(`资源加载失败：HTTP ${nativeEvent.statusCode}`)
        }}
        onLoadEnd={() => {
          if (!openedRef.current) setStatusText('页面已加载，等待桥接握手…')
        }}
        style={styles.webview}
      />
      {state !== 'connected' ? (
        <View style={styles.overlay} pointerEvents='box-none'>
          <View style={styles.panel}>
            {state === 'loading' ? (
              <ActivityIndicator size='small' color='#8b5e3c' />
            ) : null}
            <Text style={styles.status}>{statusText}</Text>
            {state === 'error' ? (
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
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
