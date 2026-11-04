import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useReadingProgressSaves } from '../src/components/Reader/useLayoutReadingProgressSave'
import { createReaderHostSession } from '../src/host/readerHostSession'
import { serializeReaderSnapshot } from '../src/host/readerSnapshot'
import { createWebBridgeClient } from '../webview/src/bridgeClient'
import type { ReaderData } from '../src/types/readerData'

describe('Reader progress through the complete persistence barrier', () => {
  it.each(['close', 'flush', 'flush-close'] as const)(
    '%s collects the sub-100ms Reader queue before ack, and flush retains the session',
    async (operation) => {
      let release!: () => void
      const writing = new Promise<void>((resolve) => {
        release = resolve
      })
      const persist = vi.fn(async () => {
        await writing
      })
      const dispose = vi.fn()
      const reader: { flush?: () => void } = {}
      const web = createWebBridgeClient({
        sessionId: 'A',
        sourceToken: 'token',
        post: (raw) => {
          host.handleRawMessage(raw).catch(() => undefined)
        },
        onQuiesce: async () => {
          reader.flush?.()
        },
        onDispose: dispose
      })
      const host = createReaderHostSession({
        sessionId: 'A',
        sourceToken: 'token',
        descriptor: { fileId: 'A', format: 'pdf', fileUrl: 'file:///A.pdf' },
        confirmedSnapshot: null,
        persist,
        sendToWeb: (message) => web.handleMessage(message)
      })
      const latest: { data: ReaderData } = {
        data: { bookmarks: [{ pageNumber: 3, verticalPercentage: 20 }] }
      }
      const { result, unmount } = renderHook(() =>
        useReadingProgressSaves('A', latest.data, (data) => {
          latest.data = data
          web.sendChange(
            serializeReaderSnapshot({
              data,
              comments: [],
              extra: {},
              migrated: false
            })
          )
        })
      )
      reader.flush = () => result.current.flush()
      act(() => web.start())
      await waitFor(() => expect(web.getRevision()).toBe(0))
      act(() =>
        result.current.layout({ pageNumber: 2, verticalPercentage: 40 })
      )
      expect(persist).not.toHaveBeenCalled()
      let completed = false
      const background = operation === 'flush-close' ? host.flush() : undefined
      const closing = (
        operation === 'flush' ? host.flush() : host.close()
      ).then((result) => {
        completed = true
        return result
      })
      await waitFor(() => expect(persist).toHaveBeenCalledOnce())
      expect(completed).toBe(false)
      expect(dispose).not.toHaveBeenCalled()
      expect(host.getSnapshot().revision).toBe(0)
      release()
      expect(await closing).toEqual({
        status: operation === 'flush' ? 'flushed' : 'closed'
      })
      if (background) expect(await background).toEqual({ status: 'flushed' })
      expect(host.getSnapshot().data).toMatchObject({
        readerData: {
          layoutReadingProgress: { pageNumber: 2, verticalPercentage: 40 },
          bookmarks: [{ pageNumber: 3, verticalPercentage: 20 }]
        }
      })
      if (operation === 'flush') {
        expect(dispose).not.toHaveBeenCalled()
        web.sendChange({
          readerData: {
            layoutReadingProgress: { pageNumber: 2, verticalPercentage: 60 }
          }
        })
        await waitFor(() => expect(host.getSnapshot().revision).toBe(2))
      } else expect(dispose).toHaveBeenCalledOnce()
      unmount()
      web.dispose()
      host.dispose()
    }
  )
})
