export type PageTextCacheRecord = {
  readonly cacheKey: string
  readonly documentId: string
  readonly pageNumber: number
  readonly text: string
}

const PAGE_TEXT_DATABASE_NAME = 'hamster-note-document-viewer'
const PAGE_TEXT_STORE_NAME = 'pageText'

let pageTextDatabasePromise: Promise<IDBDatabase | null> | null = null

export function readCachedPageText(
  cacheRecord: PageTextCacheRecord | null
): Promise<string | null> {
  if (!cacheRecord) {
    return Promise.resolve(null)
  }

  return openPageTextDatabase().then((database) => {
    if (!database) {
      return null
    }

    return new Promise<string | null>((resolve) => {
      const transaction = database.transaction(PAGE_TEXT_STORE_NAME, 'readonly')
      const request = transaction
        .objectStore(PAGE_TEXT_STORE_NAME)
        .get(cacheRecord.cacheKey)

      request.onsuccess = () => {
        const result = request.result
        resolve(isPageTextCacheRecord(result) ? result.text : null)
      }
      request.onerror = () => resolve(null)
      transaction.onerror = () => resolve(null)
    })
  })
}

export function writeCachedPageText(
  cacheRecord: PageTextCacheRecord | null
): Promise<void> {
  if (!cacheRecord) {
    return Promise.resolve()
  }

  return openPageTextDatabase().then((database) => {
    if (!database) {
      return undefined
    }

    return new Promise<void>((resolve) => {
      const transaction = database.transaction(
        PAGE_TEXT_STORE_NAME,
        'readwrite'
      )
      transaction.objectStore(PAGE_TEXT_STORE_NAME).put(cacheRecord)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    })
  })
}

function openPageTextDatabase(): Promise<IDBDatabase | null> {
  if (pageTextDatabasePromise) {
    return pageTextDatabasePromise
  }

  const indexedDb = getIndexedDb()
  if (!indexedDb) {
    pageTextDatabasePromise = Promise.resolve(null)
    return pageTextDatabasePromise
  }

  pageTextDatabasePromise = new Promise((resolve) => {
    const request = indexedDb.open(PAGE_TEXT_DATABASE_NAME, 1)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PAGE_TEXT_STORE_NAME)) {
        database.createObjectStore(PAGE_TEXT_STORE_NAME, {
          keyPath: 'cacheKey'
        })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return pageTextDatabasePromise
}

function getIndexedDb(): IDBFactory | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.indexedDB ?? null
}

function isPageTextCacheRecord(value: unknown): value is PageTextCacheRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cacheKey' in value &&
    'documentId' in value &&
    'pageNumber' in value &&
    'text' in value &&
    typeof value.cacheKey === 'string' &&
    typeof value.documentId === 'string' &&
    typeof value.pageNumber === 'number' &&
    typeof value.text === 'string'
  )
}
