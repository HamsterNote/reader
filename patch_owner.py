from pathlib import Path

# 1. waitForPageActivation: abort support
p = Path('src/pdf/pageActivation.ts')
s = p.read_text()
old = """  options: {
    readonly timeoutMs: number
    readonly now?: () => number
    readonly schedule?: (callback: () => void) => void
  }
): Promise<void> {
  const now = options.now ?? (() => Date.now())
  const schedule = options.schedule ?? (callback => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback)
    else setTimeout(callback, 16)
  })
  const deadline = now() + options.timeoutMs
  return new Promise<void>((resolve, reject) => {
    const poll = () => {
      if (isReady()) {
        resolve()
        return
      }
      if (now() >= deadline) {
        reject(new Error('目标页面不可用，原位置已保留'))
        return
      }
      schedule(poll)
    }
    poll()
  })
}"""
new = """  options: {
    readonly timeoutMs: number
    readonly now?: () => number
    readonly schedule?: (callback: () => void) => void
    readonly signal?: AbortSignal
  }
): Promise<void> {
  const now = options.now ?? (() => Date.now())
  const schedule = options.schedule ?? (callback => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(callback)
    else setTimeout(callback, 16)
  })
  const signal = options.signal
  const deadline = now() + options.timeoutMs
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener('abort', abort)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('PDF navigation superseded', 'AbortError')
      )
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    const poll = () => {
      if (signal?.aborted) return
      if (isReady()) {
        signal?.removeEventListener('abort', abort)
        resolve()
        return
      }
      if (now() >= deadline) {
        signal?.removeEventListener('abort', abort)
        reject(new Error('目标页面不可用，原位置已保留'))
        return
      }
      schedule(poll)
    }
    poll()
  })
}"""
assert old in s, 'wait helper body not found'
s = s.replace(old, new, 1)
p.write_text(s)

# 2. PdfDocumentViewer: navigation ownership for the restore wait
p = Path('src/pdf/PdfDocumentViewer.tsx')
s = p.read_text()

anchor = """  const pendingAnchor = useRef<{
    anchor: ReaderBookmark
    done: () => void
    fail: (error: Error) => void
    preserveOnFailure?: boolean
  } | null>(null)
"""
ownership = anchor + """  // Restore may wait for the target page (initial load/crop). That wait owns
  // navigation like any other request: a newer navigation, a source change or
  // unmount aborts it immediately instead of letting it replay later.
  const navigationGeneration = useRef(0)
  const restoreWait = useRef<{
    generation: number
    controller: AbortController
  } | null>(null)
  const cancelRestoreWait = useCallback(() => {
    navigationGeneration.current += 1
    const wait = restoreWait.current
    restoreWait.current = null
    wait?.controller.abort(
      new DOMException('PDF navigation superseded', 'AbortError')
    )
  }, [])
"""
assert anchor in s
s = s.replace(anchor, ownership, 1)

# scrollToCroppedPage is a public page navigation too: supersede any restore wait.
old_scroll = """  const scrollToCroppedPage = useCallback(
    (pageNumber: number) => {
      cancelLayoutRestore()"""
new_scroll = """  const scrollToCroppedPage = useCallback(
    (pageNumber: number) => {
      cancelRestoreWait()
      cancelLayoutRestore()"""
assert old_scroll in s
s = s.replace(old_scroll, new_scroll, 1)
s = s.replace("""    },
    [cancelLayoutRestore]
  )
  // Layout captures at text-item granularity.""", """    },
    [cancelLayoutRestore, cancelRestoreWait]
  )
  // Layout captures at text-item granularity.""", 1)

# navigateToAnchor: register the wait and verify ownership before replaying.
old_nav_head = """  const navigateToAnchor = (
    stored: ReaderBookmark,
    options: { preserveOnFailure?: boolean } | undefined,
    waitForPage: boolean
  ): Promise<void> => {
    cancelLayoutRestore()
    const anchor = normalizeBookmark(stored)"""
new_nav_head = """  const navigateToAnchor = (
    stored: ReaderBookmark,
    options: { preserveOnFailure?: boolean } | undefined,
    waitForPage: boolean
  ): Promise<void> => {
    cancelLayoutRestore()
    cancelRestoreWait()
    const generation = navigationGeneration.current
    const anchor = normalizeBookmark(stored)"""
assert old_nav_head in s
s = s.replace(old_nav_head, new_nav_head, 1)

old_wait = """    // Restore runs before pagesinit/crop settles; wait for the real page
    // view instead of treating "not visible yet" as unavailable.
    return waitForPageActivation(targetReady, { timeoutMs: 10000 }).then(() =>
      beginNavigation(anchor, options, originalDocument)
    )
  }"""
new_wait = """    // Restore runs before pagesinit/crop settles; wait for the real page
    // view instead of treating "not visible yet" as unavailable. The wait is
    // owned by this navigation generation, so a newer request aborts it.
    const controller = new AbortController()
    restoreWait.current = { generation, controller }
    const finishWait = () => {
      if (restoreWait.current?.controller === controller)
        restoreWait.current = null
    }
    return waitForPageActivation(targetReady, {
      timeoutMs: 10000,
      signal: controller.signal
    }).then(
      () => {
        finishWait()
        if (
          generation !== navigationGeneration.current ||
          controller.signal.aborted
        )
          throw new DOMException('PDF navigation superseded', 'AbortError')
        return beginNavigation(anchor, options, originalDocument)
      },
      error => {
        finishWait()
        throw error
      }
    )
  }"""
assert old_wait in s
s = s.replace(old_wait, new_wait, 1)

# Source change / unmount: cancel a pending restore wait immediately.
old_src_cleanup = """      cancelled = true
      removeSourceLinks?.()
    }
  }, [source])"""
new_src_cleanup = """      cancelled = true
      cancelRestoreWait()
      removeSourceLinks?.()
    }
  }, [source, cancelRestoreWait])"""
assert old_src_cleanup in s
s = s.replace(old_src_cleanup, new_src_cleanup, 1)

old_unmount = """    return () => {
      pendingAnchor.current?.fail(
        new DOMException('PDF navigation cancelled', 'AbortError')
      )"""
new_unmount = """    return () => {
      cancelRestoreWait()
      pendingAnchor.current?.fail(
        new DOMException('PDF navigation cancelled', 'AbortError')
      )"""
assert old_unmount in s
s = s.replace(old_unmount, new_unmount, 1)

p.write_text(s)
print('patched ownership')
