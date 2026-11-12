import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../src/pdf')

/** Structural guard: every direct PDF.js scroll/activation call under src/pdf
 * must be preceded by the page-view guard, so new entry points cannot skip it. */
describe('PDF scroll entry points stay guarded', () => {
  it('guards every direct currentPageNumber/scrollPageIntoView call', () => {
    const files = [
      'PdfDocumentViewer.tsx',
      'PdfHiddenPageRestoreModal.tsx',
      'PdfTextReadingControls.tsx',
      'PdfPageOverlayLayer.tsx',
      'PdfRectangleAnnotation.tsx',
      'PdfTextHandle.tsx',
      'PdfTextSelectionControls.tsx'
    ]
    const unguarded: string[] = []
    for (const file of files) {
      let lines: string[]
      try {
        lines = readFileSync(resolve(root, file), 'utf8').split('\n')
      } catch {
        continue
      }
      lines.forEach((line, index) => {
        if (!/\.scrollPageIntoView\s*\(|\.currentPageNumber\s*=/.test(line))
          return
        const context = lines.slice(Math.max(0, index - 30), index).join('\n')
        if (
          !/isPageViewActivatable|activatePageIfReady|canTargetPdfPage|activatePage\(/.test(
            context
          )
        )
          unguarded.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(unguarded).toEqual([])
  })
})
