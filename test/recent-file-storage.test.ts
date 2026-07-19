import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRecentFile, saveRecentFile } from '../demo/recentFileStorage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recent file storage', () => {
  it('returns false when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new DOMException('IndexedDB unavailable', 'InvalidStateError')
      })
    })

    const file = new File(['cached'], 'cached.txt', { type: 'text/plain' })

    await expect(saveRecentFile(file)).resolves.toBe(false)
  })

  it('returns null when IndexedDB cannot be opened during restore', async () => {
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new DOMException('IndexedDB unavailable', 'InvalidStateError')
      })
    })

    await expect(loadRecentFile()).resolves.toBeNull()
  })
})
