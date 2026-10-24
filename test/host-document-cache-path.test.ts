import { describe, expect, it } from 'vitest'
import {
  documentCachePath,
  resolveDocumentCacheUri
} from '../src/host/documentCachePath'

const fileId = `f_${'a'.repeat(32)}`

describe('document cache paths', () => {
  it.each(['epub', 'pdf'] as const)(
    'stores a relative %s path and resolves it in the current container',
    (format) => {
      expect(documentCachePath(fileId, format)).toBe(
        `reader-files/${fileId}.${format}`
      )
      for (const root of ['file:///old/Documents/', 'file:///new/Documents'])
        expect(resolveDocumentCacheUri(root, fileId, format)).toBe(
          `${root.replace(/\/$/, '')}/reader-files/${fileId}.${format}`
        )
    }
  )

  it('rejects missing document directories and unsafe identities', () => {
    expect(() => resolveDocumentCacheUri(null, fileId, 'epub')).toThrow(
      '文档目录'
    )
    expect(() =>
      resolveDocumentCacheUri('https://example.com/', fileId, 'pdf')
    ).toThrow('文档目录')
    expect(() => documentCachePath('../other', 'epub')).toThrow('非法文件 ID')
  })
})
