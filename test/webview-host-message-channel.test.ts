import { describe, expect, it, vi } from 'vitest'

import { listenHostMessages } from '../webview/src/hostMessageChannel'

// react-native-webview 13.15.0 的平台差异回归：
// Android（RNCWebViewManagerImpl.kt）向 document 派发默认不冒泡的
// MessageEvent，只挂 window 的监听一次都收不到；iOS 向 window 派发。

describe('listenHostMessages', () => {
  it('receives messages dispatched to document without bubbling (Android)', () => {
    const onMessage = vi.fn()
    const unlisten = listenHostMessages(onMessage)

    // Android：bubbles 默认为 false，目标是 document。
    document.dispatchEvent(
      new MessageEvent('message', { data: '{"type":"open"}' })
    )

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith('{"type":"open"}')
    unlisten()
  })

  it('receives messages dispatched to window (iOS)', () => {
    const onMessage = vi.fn()
    const unlisten = listenHostMessages(onMessage)

    window.dispatchEvent(
      new MessageEvent('message', { data: '{"type":"ack"}' })
    )

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith('{"type":"ack"}')
    unlisten()
  })

  it('delivers a bubbling event only once though both targets see it', () => {
    const onMessage = vi.fn()
    const unlisten = listenHostMessages(onMessage)

    // 冒泡事件会先后到达 document 与 window 的同一监听器。
    document.dispatchEvent(
      new MessageEvent('message', { data: '{"type":"restore"}', bubbles: true })
    )

    expect(onMessage).toHaveBeenCalledTimes(1)
    unlisten()
  })

  it('ignores non-MessageEvent events and stops after unlisten', () => {
    const onMessage = vi.fn()
    const unlisten = listenHostMessages(onMessage)

    document.dispatchEvent(new Event('message'))
    expect(onMessage).not.toHaveBeenCalled()

    unlisten()
    document.dispatchEvent(new MessageEvent('message', { data: 'x' }))
    window.dispatchEvent(new MessageEvent('message', { data: 'y' }))
    expect(onMessage).not.toHaveBeenCalled()
  })
})
