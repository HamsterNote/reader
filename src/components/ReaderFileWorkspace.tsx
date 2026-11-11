import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { flushSync } from 'react-dom'
import { Reader, type ReaderProps, type ReaderProgressHandle } from './Reader'
import { ReaderFileSession } from '../workspace/readerFileSession'

export type ReaderFileWorkspaceProps = Pick<
  ReaderProps,
  'layout' | 'onRequestRemove'
> & {
  readonly session: ReaderFileSession
  /** Host can rerender when its authoritative ordered list changes. */
  readonly files?: ReaderProps['files']
}

/** Remains mounted across document changes, including PDF ↔ EPUB. */
export function ReaderFileWorkspace({
  session,
  layout,
  files,
  onRequestRemove
}: ReaderFileWorkspaceProps) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )
  return (
    <div
      data-reader-workspace={session.paneId}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {state.document && state.sessionId && (
        <FileSurface
          key={state.sessionId}
          session={session}
          id={state.sessionId}
          props={{
            ...state.document.props,
            data: state.data,
            layout,
            files: files ?? session.getFiles(),
            paneId: session.paneId,
            currentFileKey: state.currentFileKey,
            busy: state.phase !== 'idle',
            onSelectFile: session.select,
            onRequestRemove
          }}
        />
      )}
      {['loading', 'restoring', 'saving', 'handover'].includes(state.phase) && (
        <div
          role='status'
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            background: 'transparent',
            cursor: 'progress'
          }}
        >
          <span style={{ background: 'Canvas', color: 'CanvasText' }}>
            正在切换文件…
          </span>
        </div>
      )}
      {state.phase === 'error' && (
        <div role='alert'>
          <p>打开文件失败：{state.error}</p>
          <button
            type='button'
            onClick={() => {
              session.retry().catch(() => undefined)
            }}
          >
            重试
          </button>
          <button
            type='button'
            onClick={() => {
              session.reopenPrevious().catch(() => undefined)
            }}
          >
            从存储重开原文件
          </button>
        </div>
      )}
    </div>
  )
}

function useInputBarrier() {
  const boundary = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Set<number>())
  const waiters = useRef(new Set<() => void>())
  useEffect(() => {
    const start = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        boundary.current?.contains(event.target)
      )
        pointers.current.add(event.pointerId)
    }
    const end = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (!pointers.current.size)
        waiters.current.forEach((resolve) => resolve())
    }
    document.addEventListener('pointerdown', start, true)
    document.addEventListener('pointerup', end, true)
    document.addEventListener('pointercancel', end, true)
    return () => {
      document.removeEventListener('pointerdown', start, true)
      document.removeEventListener('pointerup', end, true)
      document.removeEventListener('pointercancel', end, true)
    }
  }, [])
  const wait = async () => {
    if (pointers.current.size)
      await new Promise<void>((resolve, reject) => {
        const settled = () => {
          clearTimeout(timer)
          waiters.current.delete(settled)
          resolve()
        }
        const timer = setTimeout(() => {
          waiters.current.delete(settled)
          reject(new Error('请结束当前手势后重试切换'))
        }, 2000)
        waiters.current.add(settled)
      })
    // Commit handlers run after capture-phase pointerup; await the task boundary.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return { boundary, wait }
}

function FileSurface({
  session,
  id,
  props
}: {
  session: ReaderFileSession
  id: string
  props: ReaderProps
}) {
  const input = useInputBarrier()
  const waitForInput = useRef(input.wait)
  waitForInput.current = input.wait
  const progress = useRef<ReaderProgressHandle>(null)
  const disposals = useRef<Promise<void>[]>([])
  const [mounted, setMounted] = useState(true)
  const liveProps = useRef(props)
  liveProps.current = props
  useLayoutEffect(() => {
    session.attach(id, {
      flush: async () => {
        await waitForInput.current()
        await progress.current?.flush()
        return progress.current?.getData()
      },
      release: async () => {
        flushSync(() => setMounted(false))
        await Promise.all(disposals.current)
      }
    })
  }, [id, session])
  // Registered non-native-byte adapters signal readiness once their initial view is mounted.
  // Native PDF/EPUB signal only after their asynchronous layout + restore finishes.
  useEffect(() => {
    if (mounted && !props.engineSource) session.restored(id)
  }, [id, session, mounted, props.engineSource])
  if (!mounted) return null
  return (
    <div
      ref={input.boundary}
      className='hamster-reader__file-surface'
      style={{ width: '100%', height: '100%' }}
      onKeyDownCapture={(event) => {
        if (props.busy) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      <Reader
        {...props}
        progressRef={progress}
        onDataChange={(data) => {
          if (session.update(id, data)) liveProps.current.onDataChange?.(data)
        }}
        onEngineReady={() => {
          session.restored(id)
          liveProps.current.onEngineReady?.()
        }}
        onEngineError={(error) => {
          session.loadFailed(id, error)
          liveProps.current.onEngineError?.(error)
        }}
        onEngineDisposal={(completion) => {
          disposals.current.push(completion)
          liveProps.current.onEngineDisposal?.(completion)
        }}
      />
    </div>
  )
}
