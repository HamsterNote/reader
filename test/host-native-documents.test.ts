import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ReaderDataStore,
  type HostDocumentRecord
} from '../src/host/readerDataStore'

const native = vi.hoisted(() => ({
  pick: vi.fn(),
  getInfo: vi.fn(),
  copy: vi.fn(),
  remove: vi.fn(),
  mkdir: vi.fn(),
  removeStaged: vi.fn()
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: vi.fn(async () => 'a'.repeat(64))
}))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: native.pick }))
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///new-container/Documents/',
  getInfoAsync: native.getInfo,
  copyAsync: native.copy,
  deleteAsync: native.remove,
  makeDirectoryAsync: native.mkdir
}))
vi.mock('../app/src/native/webAssets', () => ({
  removeStagedDocument: native.removeStaged
}))
import {
  importDocumentFromPath,
  pickAndCacheDocument,
  removeDocument
} from '../app/src/native/documents'

const fileId = `f_${'a'.repeat(32)}`

async function storedDocument(format: 'epub' | 'pdf') {
  const values = new Map<string, string>()
  const storage = {
    values,
    read: async (key: string) => values.get(key) ?? null,
    write: async (key: string, value: string) => {
      values.set(key, value)
    },
    remove: async (key: string) => {
      values.delete(key)
    }
  }
  const record: HostDocumentRecord = {
    fileId,
    fileName: `book.${format}`,
    format,
    size: 1024,
    modifiedAt: 1,
    importedAt: 2,
    cachedUri: `file:///old-container/Documents/reader-files/${fileId}.${format}`,
    snapshot: {
      data: { highlights: { ranges: [{ id: 'retained' }] } },
      progress: { page: 2 },
      revision: 8
    },
    legacyImport: { version: 4, sourceFileName: 'notes.json', importedAt: 3 }
  }
  const store = new ReaderDataStore(storage)
  await store.upsert(record)
  return { store, record, storage }
}

describe('native cache records across container relocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.getInfo.mockResolvedValue({ exists: true, md5: 'b'.repeat(32) })
  })

  it.each(['epub', 'pdf'] as const)(
    'reselecting a %s saves a relative path and retains all annotations',
    async (format) => {
      const { store, record, storage } = await storedDocument(format)
      native.pick.mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: record.fileName,
            uri: 'file:///picker/book',
            size: 1024,
            lastModified: 1
          }
        ]
      })
      const selected = await pickAndCacheDocument(store)
      expect(selected?.record).toEqual({
        ...record,
        cachedUri: `reader-files/${fileId}.${format}`,
        // 返回的是重新读取的权威记录，因此带上读取时标注。
        snapshotSource: 'legacy'
      })
      expect(native.getInfo).toHaveBeenCalledWith(
        `file:///new-container/Documents/reader-files/${fileId}.${format}`
      )
      expect(native.copy).not.toHaveBeenCalled()
      expect(
        (await new ReaderDataStore(storage).get(fileId))?.snapshot
      ).toEqual(record.snapshot)
    }
  )

  it('deletes a legacy cache from the current container, never the stored absolute URI', async () => {
    const { store, record } = await storedDocument('epub')
    await removeDocument(store, record)
    expect(native.remove).toHaveBeenCalledExactlyOnceWith(
      `file:///new-container/Documents/reader-files/${fileId}.epub`,
      { idempotent: true }
    )
    expect(native.removeStaged).toHaveBeenCalledWith(fileId)
    expect(await store.get(fileId)).toBeNull()
  })
})

describe('reopening a document with a corrupt v2 snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.getInfo.mockResolvedValue({ exists: true, md5: 'b'.repeat(32) })
  })

  it('refuses the selection instead of silently rewriting the legacy record', async () => {
    const { store, record, storage } = await storedDocument('pdf')
    const legacyKey = `reader.host.v1.doc.${fileId}`
    const legacyBytes = storage.values.get(legacyKey)
    const indexBytes = storage.values.get('reader.host.v1.index')
    storage.values.set(`reader.host.v2.snapshot.${fileId}`, '{"revision":')

    native.pick.mockResolvedValue({
      canceled: false,
      assets: [
        {
          name: record.fileName,
          uri: 'file:///picker/book',
          size: 1024,
          lastModified: 1
        }
      ]
    })

    await expect(pickAndCacheDocument(store)).rejects.toThrow('损坏')
    // 损坏状态不会被 upsert 洗成旧快照，两个键都保持原样。
    expect(storage.values.get(legacyKey)).toBe(legacyBytes)
    expect(storage.values.get('reader.host.v1.index')).toBe(indexBytes)
    expect((await store.get(fileId))?.snapshotError).toContain('损坏')
  })
})

describe('debug path import (HAM-278 deterministic device entrance)', () => {
  function emptyStore() {
    const values = new Map<string, string>()
    const storage = {
      values,
      read: async (key: string) => values.get(key) ?? null,
      write: async (key: string, value: string) => {
        values.set(key, value)
      },
      remove: async (key: string) => {
        values.delete(key)
      }
    }
    return { store: new ReaderDataStore(storage), storage }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('imports an absolute device path with picker-compatible identity', async () => {
    const { store } = emptyStore()
    native.getInfo.mockImplementation(async (uri: string) => {
      if (uri.includes('/reader-files/')) return { exists: false }
      if (
        decodeURIComponent(uri) === 'file:///var/mobile/reader/book sample.pdf'
      )
        return {
          exists: true,
          size: 2048,
          // expo-file-system 以秒返回，身份计算需要毫秒。
          modificationTime: 1_700_000_000,
          md5: 'c'.repeat(32)
        }
      return { exists: true }
    })

    const record = await importDocumentFromPath(
      store,
      '/var/mobile/reader/book sample.pdf'
    )
    expect(record).toMatchObject({
      fileName: 'book sample.pdf',
      format: 'pdf',
      size: 2048,
      modifiedAt: 1_700_000_000_000
    })
    expect(native.getInfo).toHaveBeenCalledWith(
      'file:///var/mobile/reader/book sample.pdf',
      {
        md5: true
      }
    )
    expect(native.copy).toHaveBeenCalledWith({
      from: 'file:///var/mobile/reader/book sample.pdf',
      to: `file:///new-container/Documents/reader-files/${record.fileId}.pdf`
    })

    // 同一条调试链接重跑得到同一个 fileId，不会新建第二份记录。
    const again = await importDocumentFromPath(
      store,
      'file:///var/mobile/reader/book%20sample.pdf'
    )
    expect(again.fileId).toBe(record.fileId)
    expect((await store.get(record.fileId))?.fileName).toBe('book sample.pdf')
  })

  it('rejects a missing file or a directory instead of opening the library', async () => {
    const { store } = emptyStore()
    native.getInfo.mockResolvedValueOnce({ exists: false })
    await expect(
      importDocumentFromPath(store, '/var/mobile/reader/missing.pdf')
    ).rejects.toThrow(
      '调试入口指定的文件不存在：/var/mobile/reader/missing.pdf'
    )

    native.getInfo.mockResolvedValueOnce({ exists: true, isDirectory: true })
    await expect(
      importDocumentFromPath(store, '/var/mobile/reader/folder')
    ).rejects.toThrow('调试入口需要文件而不是目录：/var/mobile/reader/folder')
  })

  it('requires an absolute path', async () => {
    const { store } = emptyStore()
    await expect(importDocumentFromPath(store, 'book.pdf')).rejects.toThrow(
      '调试入口需要绝对路径：book.pdf'
    )
    expect(native.getInfo).not.toHaveBeenCalled()
  })
})
