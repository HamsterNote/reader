import * as FileSystem from 'expo-file-system/legacy'

import type { HostStorage } from '../../../src/host/readerDataStore'

const ROOT_DIR = `${FileSystem.documentDirectory ?? ''}reader-host/`

function storagePath(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${ROOT_DIR}${safeKey}.json`
}

function backupPath(path: string): string {
  return `${path}.bak`
}

async function exists(path: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(path)
  return info.exists
}

async function ensureRoot(): Promise<void> {
  if (await exists(ROOT_DIR)) return
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true })
}

/**
 * 文件系统存储：临时文件写完再换入，进程中断不会留下半个 JSON。
 *
 * 替换时先把旧文件移到 `.bak` 再移入新文件，失败就把备份移回原位——
 * 不会出现“旧文件已删除、新文件还没到位”的空窗。启动时若主文件缺失而
 * 备份存在（中断在两次移动之间），读取会先把备份恢复回主文件。
 * 键由 ReaderDataStore 生成，这里再做一次字符白名单，防止路径穿越。
 */
export function createFileSystemStorage(): HostStorage {
  return {
    read: async (key) => {
      const path = storagePath(key)
      const backup = backupPath(path)
      if (!(await exists(path)) && (await exists(backup))) {
        await FileSystem.moveAsync({ from: backup, to: path })
      }
      if (!(await exists(path))) return null
      return FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.UTF8
      })
    },
    write: async (key, value) => {
      await ensureRoot()
      const path = storagePath(key)
      const temporaryPath = `${path}.tmp`
      const backup = backupPath(path)
      await FileSystem.writeAsStringAsync(temporaryPath, value, {
        encoding: FileSystem.EncodingType.UTF8
      })

      const hadPrevious = await exists(path)
      if (hadPrevious) {
        await FileSystem.deleteAsync(backup, { idempotent: true })
        await FileSystem.moveAsync({ from: path, to: backup })
      }

      try {
        await FileSystem.moveAsync({ from: temporaryPath, to: path })
      } catch (error) {
        // 换入失败：把旧文件放回原位，再抛出，调用方看到的是未变更状态。
        if (hadPrevious && !(await exists(path)) && (await exists(backup))) {
          try {
            await FileSystem.moveAsync({ from: backup, to: path })
          } catch {
            // 回滚也失败：备份保持完整，read 会在下次访问时恢复。
          }
        }
        await FileSystem.deleteAsync(temporaryPath, { idempotent: true })
        throw error
      }

      if (hadPrevious) {
        await FileSystem.deleteAsync(backup, { idempotent: true })
      }
    },
    remove: async (key) => {
      const path = storagePath(key)
      await FileSystem.deleteAsync(path, { idempotent: true })
      await FileSystem.deleteAsync(backupPath(path), { idempotent: true })
    }
  }
}
