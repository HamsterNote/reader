import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createFileSystemStorage } from '../app/src/native/storage'

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  /** 持续失败的目标路径。 */
  failMoveTo: new Set<string>(),
  /** 只失败一次的“下一次移动”目标路径。 */
  failNextMoveTo: new Set<string>()
}))

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///doc/',
  EncodingType: { UTF8: 'utf8' },
  getInfoAsync: async (path: string) => ({ exists: fs.files.has(path) }),
  makeDirectoryAsync: async () => undefined,
  writeAsStringAsync: async (path: string, value: string) => {
    fs.files.set(path, value)
  },
  readAsStringAsync: async (path: string) => {
    const value = fs.files.get(path)
    if (value === undefined) throw new Error(`missing: ${path}`)
    return value
  },
  deleteAsync: async (path: string) => {
    fs.files.delete(path)
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const transient = fs.failNextMoveTo.delete(to)
    if (transient || fs.failMoveTo.has(to))
      throw new Error(`move failed: ${to}`)
    const value = fs.files.get(from)
    if (value === undefined) throw new Error(`missing: ${from}`)
    if (fs.files.has(to)) throw new Error(`destination exists: ${to}`)
    fs.files.set(to, value)
    fs.files.delete(from)
  }
}))

const target = 'file:///doc/reader-host/reader.host.v1.index.json'
const temporary = `${target}.tmp`
const backup = `${target}.bak`

describe('native file system storage', () => {
  beforeEach(() => {
    fs.files.clear()
    fs.failMoveTo.clear()
    fs.failNextMoveTo.clear()
  })

  it('writes and reads a complete value', async () => {
    const storage = createFileSystemStorage()
    await storage.write('reader.host.v1.index', '["a"]')

    expect(fs.files.get(target)).toBe('["a"]')
    expect(await storage.read('reader.host.v1.index')).toBe('["a"]')
    expect(fs.files.has(temporary)).toBe(false)
    expect(fs.files.has(backup)).toBe(false)
  })

  it('replaces an existing value', async () => {
    const storage = createFileSystemStorage()
    await storage.write('reader.host.v1.index', '["a"]')
    await storage.write('reader.host.v1.index', '["a","b"]')

    expect(await storage.read('reader.host.v1.index')).toBe('["a","b"]')
    expect(fs.files.has(backup)).toBe(false)
  })

  it('restores the previous file when moving the replacement fails', async () => {
    const storage = createFileSystemStorage()
    await storage.write('reader.host.v1.index', '["a"]')
    fs.failNextMoveTo.add(target)

    await expect(
      storage.write('reader.host.v1.index', '["a","b"]')
    ).rejects.toThrow('move failed')

    // 不能出现“旧文件已删除、新文件没到位”的空窗。
    expect(fs.files.get(target)).toBe('["a"]')
    expect(fs.files.has(temporary)).toBe(false)
    expect(fs.files.has(backup)).toBe(false)
    expect(await storage.read('reader.host.v1.index')).toBe('["a"]')
  })

  it('keeps a recoverable backup when the rollback move also fails', async () => {
    const storage = createFileSystemStorage()
    await storage.write('reader.host.v1.index', '["a"]')
    // 目标路径持续不可写：换入和回滚都失败。
    fs.failMoveTo.add(target)

    await expect(
      storage.write('reader.host.v1.index', '["a","b"]')
    ).rejects.toThrow('move failed')

    // 旧内容仍完整保存在备份里，重开（目标路径恢复可写）时由 read 恢复。
    expect(fs.files.get(backup)).toBe('["a"]')
    expect(fs.files.has(temporary)).toBe(false)

    fs.failMoveTo.clear()
    expect(await storage.read('reader.host.v1.index')).toBe('["a"]')
    expect(fs.files.has(backup)).toBe(false)
  })

  it('recovers an interrupted swap from the backup file', async () => {
    const storage = createFileSystemStorage()
    // 模拟中断在“旧文件移到 .bak、新文件尚未移入”之间。
    fs.files.set(backup, '["a"]')

    expect(await storage.read('reader.host.v1.index')).toBe('["a"]')
    expect(fs.files.get(target)).toBe('["a"]')
    expect(fs.files.has(backup)).toBe(false)
  })

  it('removes the value together with its backup', async () => {
    const storage = createFileSystemStorage()
    await storage.write('reader.host.v1.index', '["a"]')
    fs.files.set(backup, '["stale"]')

    await storage.remove('reader.host.v1.index')

    expect(fs.files.has(target)).toBe(false)
    expect(fs.files.has(backup)).toBe(false)
    expect(await storage.read('reader.host.v1.index')).toBeNull()
  })
})
