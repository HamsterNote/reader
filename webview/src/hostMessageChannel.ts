// 宿主 → Web 的消息通道监听。react-native-webview 的平台差异：
// Android（RNCWebViewManagerImpl）把默认不冒泡的 MessageEvent 派发到
// document，window 上的冒泡监听收不到；iOS 派发到 window。两个目标都监听，
// 并按事件对象去重（冒泡事件会先后到达 document 与 window）。

export type HostMessageListener = (data: unknown) => void

/**
 * 同时监听 document（Android）与 window（iOS）的 message 事件。
 * 返回解绑函数；同一事件对象只投递一次。
 */
export function listenHostMessages(onMessage: HostMessageListener): () => void {
  const delivered = new WeakSet<object>()
  const handle = (event: Event): void => {
    if (!(event instanceof MessageEvent)) return
    if (delivered.has(event)) return
    delivered.add(event)
    onMessage(event.data)
  }
  document.addEventListener('message', handle)
  window.addEventListener('message', handle)
  return () => {
    document.removeEventListener('message', handle)
    window.removeEventListener('message', handle)
  }
}
