const DATABASE_NAME = 'hamster-reader-demo'
const DATABASE_VERSION = 1
const FILE_STORE_NAME = 'files'
const RECENT_FILE_KEY = 'recent'

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE_NAME)) {
        request.result.createObjectStore(FILE_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

export async function saveRecentFile(file: File): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false

  return new Promise((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(FILE_STORE_NAME, 'readwrite')
      transaction.objectStore(FILE_STORE_NAME).put(file, RECENT_FILE_KEY)
    } catch {
      database.close()
      resolve(false)
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => {
      database.close()
      resolve(false)
    }
    transaction.onabort = () => {
      database.close()
      resolve(false)
    }
  })
}

export async function loadRecentFile(): Promise<File | null> {
  const database = await openDatabase()
  if (!database) return null

  return new Promise((resolve) => {
    let transaction: IDBTransaction
    let storedValue: unknown

    try {
      transaction = database.transaction(FILE_STORE_NAME, 'readonly')
      const request = transaction
        .objectStore(FILE_STORE_NAME)
        .get(RECENT_FILE_KEY)
      request.onsuccess = () => {
        storedValue = request.result
      }
    } catch {
      database.close()
      resolve(null)
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(storedValue instanceof File ? storedValue : null)
    }
    transaction.onerror = () => {
      database.close()
      resolve(null)
    }
    transaction.onabort = () => {
      database.close()
      resolve(null)
    }
  })
}

export async function clearRecentFile(): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false

  return new Promise((resolve) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(FILE_STORE_NAME, 'readwrite')
      transaction.objectStore(FILE_STORE_NAME).delete(RECENT_FILE_KEY)
    } catch {
      database.close()
      resolve(false)
      return
    }

    transaction.oncomplete = () => {
      database.close()
      resolve(true)
    }
    transaction.onerror = () => {
      database.close()
      resolve(false)
    }
    transaction.onabort = () => {
      database.close()
      resolve(false)
    }
  })
}
