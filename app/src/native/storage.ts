import * as FileSystem from 'expo-file-system/legacy'

import type { HostStorage } from '../../../src/host/readerDataStore'

const ROOT_DIR = `${FileSystem.documentDirectory ?? ''}reader-host/`

function storagePath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${ROOT_DIR}${safeKey}.json`
}

async function ensureRoot(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ROOT_DIR)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true })
  }
}

/**
 * 文件系统存储：临时文件写完再 rename，避免进程中断留下半个 JSON。
 * 键由 ReaderDataStore 生成，这里再做一次字符白名单，防止路径穿越。
 */
export function createFileSystemStorage(): HostStorage {
  return {
    read: async (key) => {
      const path = storagePath(key)
      const info = await FileSystem.getInfoAsync(path)
      if (!info.exists) return null
      return FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.UTF8
      })
    },
    write: async (key, value) => {
      await ensureRoot()
      const path = storagePath(key)
      const temporaryPath = `${path}.tmp`
      await FileSystem.writeAsStringAsync(temporaryPath, value, {
        encoding: FileSystem.EncodingType.UTF8
      })
      const previous = await FileSystem.getInfoAsync(path)
      if (previous.exists) {
        await FileSystem.deleteAsync(path, { idempotent: true })
      }
      await FileSystem.moveAsync({ from: temporaryPath, to: path })
    },
    remove: async (key) => {
      await FileSystem.deleteAsync(storagePath(key), { idempotent: true })
    }
  }
}
