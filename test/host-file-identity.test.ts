import { describe, expect, it } from 'vitest'

import {
  assertSafeFileId,
  createDocumentFileId,
  detectDocumentFormat
} from '../src/host/fileIdentity'

const digest = async (value: string): Promise<string> => {
  // 测试用确定性摘要（FNV-1a），不依赖 Node crypto。
  let hash = 0x811c9dc5
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0').repeat(8)
}

describe('detectDocumentFormat', () => {
  it('uses the extension before the mime type', () => {
    expect(detectDocumentFormat('Book.EPUB')).toBe('epub')
    expect(detectDocumentFormat('paper.pdf', 'application/epub+zip')).toBe(
      'pdf'
    )
    expect(detectDocumentFormat('x.bin', 'application/pdf')).toBe('pdf')
    expect(detectDocumentFormat('x.txt', 'text/plain')).toBeNull()
  })
})

describe('createDocumentFileId', () => {
  it('is stable for identical metadata and differs when metadata changes', async () => {
    const input = {
      fileName: '书.epub',
      size: 10,
      modifiedAt: 1000,
      contentDigest: 'a'.repeat(32)
    }
    const first = await createDocumentFileId(input, digest)
    const second = await createDocumentFileId(input, digest)
    const other = await createDocumentFileId(
      { ...input, modifiedAt: 1001 },
      digest
    )
    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^f_[a-f0-9]{32}$/)
  })

  it('gives different ids to same-metadata files with different content', async () => {
    // 回归：两个目录里同名同尺寸同时间但内容不同的 book.pdf 曾得到相同
    // ID，共用缓存与标注数据，实际打开的是先选的那份文件。
    const base = { fileName: 'book.pdf', size: 2048, modifiedAt: 1700000000 }
    const first = await createDocumentFileId(
      { ...base, contentDigest: 'b'.repeat(32) },
      digest
    )
    const second = await createDocumentFileId(
      { ...base, contentDigest: 'c'.repeat(32) },
      digest
    )
    const again = await createDocumentFileId(
      { ...base, contentDigest: 'b'.repeat(32) },
      digest
    )
    expect(first).not.toBe(second)
    expect(first).toBe(again)
  })

  it('rejects invalid digests and non-finite sizes', async () => {
    await expect(
      createDocumentFileId(
        {
          fileName: 'a.epub',
          size: 1,
          modifiedAt: 1,
          contentDigest: 'a'.repeat(32)
        },
        async () => 'not-a-digest'
      )
    ).rejects.toThrow('SHA-256')
    await expect(
      createDocumentFileId(
        {
          fileName: 'a.epub',
          size: Number.NaN,
          modifiedAt: 1,
          contentDigest: 'a'.repeat(32)
        },
        digest
      )
    ).rejects.toThrow('文件大小无效')
    await expect(
      createDocumentFileId(
        { fileName: 'a.epub', size: 1, modifiedAt: 1, contentDigest: '' },
        digest
      )
    ).rejects.toThrow('文件内容摘要无效')
  })

  it('rejects path-like ids', () => {
    expect(() => assertSafeFileId('../secret')).toThrow('非法文件 ID')
    expect(() =>
      assertSafeFileId('f_0123456789abcdef0123456789abcdef')
    ).not.toThrow()
  })
})
