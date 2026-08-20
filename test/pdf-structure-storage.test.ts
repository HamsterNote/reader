import { describe, expect, it } from 'vitest'

import {
  mergePdfStructure,
  parsePdfStructureJson,
  serializePdfStructure
} from '../demo/pdfStructureStorage'

const pdfFile = new File(['pdf'], 'sample.pdf', {
  type: 'application/pdf',
  lastModified: 123
})

describe('PDF structure storage', () => {
  it('round-trips validated page dimensions for the matching PDF', () => {
    // Given: 首次解析得到两页可靠的 PDF 尺寸。
    const structure = mergePdfStructure(null, pdfFile, 2, [
      { pageNumber: 1, width: 612, height: 792 },
      { pageNumber: 2, width: 792, height: 612 }
    ])

    // When: JSON sidecar 被序列化并在下一次加载时解析。
    const restored = parsePdfStructureJson(
      serializePdfStructure(structure),
      pdfFile
    )

    // Then: 页码与宽高完整恢复。
    expect(restored).toEqual(structure)
  })

  it('rejects a sidecar that belongs to a different PDF revision', () => {
    // Given: 同名 PDF 已被替换为不同大小或修改时间的新版本。
    const oldFile = new File(['old'], 'sample.pdf', { lastModified: 100 })
    const newFile = new File(['new-content'], 'sample.pdf', {
      lastModified: 200
    })
    const structure = mergePdfStructure(null, oldFile, 1, [
      { pageNumber: 1, width: 100, height: 200 }
    ])

    // When: 新文件尝试读取旧文件的 JSON sidecar。
    const restored = parsePdfStructureJson(
      serializePdfStructure(structure),
      newFile
    )

    // Then: 身份不匹配的缓存不会被使用。
    expect(restored).toBeNull()
  })

  it('merges newly scanned page ranges without losing cached pages', () => {
    // Given: 缓存中已有第一页，当前只新扫描第二页。
    const existing = mergePdfStructure(null, pdfFile, 2, [
      { pageNumber: 1, width: 612, height: 792 }
    ])

    // When: 新范围完成后合并结构。
    const merged = mergePdfStructure(existing, pdfFile, 2, [
      { pageNumber: 2, width: 792, height: 612 }
    ])

    // Then: sidecar 同时保存两个页结构并按页码排序。
    expect(merged.pages).toEqual([
      { pageNumber: 1, width: 612, height: 792 },
      { pageNumber: 2, width: 792, height: 612 }
    ])
  })

  it('rejects malformed or incomplete JSON page dimensions', () => {
    // Given: sidecar 含零尺寸页面，不能安全替代 PDF.js 扫描。
    const malformed = JSON.stringify({
      version: 1,
      file: {
        name: pdfFile.name,
        size: pdfFile.size,
        lastModified: pdfFile.lastModified
      },
      pageCount: 1,
      pages: [{ pageNumber: 1, width: 0, height: 792 }]
    })

    // When / Then: 边界解析失败并退回真实 PDF 扫描。
    expect(parsePdfStructureJson(malformed, pdfFile)).toBeNull()
    expect(parsePdfStructureJson('{bad json', pdfFile)).toBeNull()
  })
})
