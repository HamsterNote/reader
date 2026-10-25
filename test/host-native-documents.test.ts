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
  pickAndCacheDocument,
  removeDocument
} from '../app/src/native/documents'

const fileId = `f_${'a'.repeat(32)}`

async function storedDocument(format: 'epub' | 'pdf') {
  const values = new Map<string, string>()
  const storage = {
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
        cachedUri: `reader-files/${fileId}.${format}`
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
