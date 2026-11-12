import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  findUnguardedScrollCalls,
  type ScannedFile
} from './helpers/pdfScrollGuard'

const pdfRoot = resolve(import.meta.dirname, '../src/pdf')

function readTree(directory: string, prefix = ''): ScannedFile[] {
  const files: ScannedFile[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...readTree(resolve(directory, entry.name), path))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts'))
      continue
    files.push({
      path,
      text: readFileSync(resolve(directory, entry.name), 'utf8')
    })
  }
  return files
}

const repoFiles = () => readTree(pdfRoot)

describe('PDF scroll guard scan', () => {
  it('every direct call is allowlisted or annotated on the same line', () => {
    expect(findUnguardedScrollCalls(repoFiles())).toEqual([])
  })

  it('fails an unannotated new file', () => {
    const files: ScannedFile[] = [
      {
        path: 'NewViewer.tsx',
        text: 'viewer.currentPageNumber = 3\nviewer.scrollPageIntoView({ pageNumber: 3 })'
      }
    ]
    expect(findUnguardedScrollCalls(files)).toHaveLength(2)
  })

  it('does not accept a marker on another line or inside a string', () => {
    const files: ScannedFile[] = [
      {
        path: 'Sneaky.tsx',
        text: [
          '// pdf-scroll-guard: pretend',
          'viewer.currentPageNumber = 3',
          'viewer.scrollPageIntoView({ pageNumber: 3 }) // pdf-scroll-guard: real',
          'viewer.currentPageNumber = 4; const note = "// pdf-scroll-guard: fake"',
          '/* pdf-scroll-guard: block */ viewer.scrollPageIntoView({ pageNumber: 4 })'
        ].join('\n')
      }
    ]
    const unguarded = findUnguardedScrollCalls(files)
    expect(unguarded).toHaveLength(3)
    expect(unguarded[0]).toContain(':2:')
    expect(unguarded[1]).toContain(':4:')
    expect(unguarded[2]).toContain(':5:')
  })

  it('accepts a same-line annotation with a reason', () => {
    const files: ScannedFile[] = [
      {
        path: 'Guarded.tsx',
        text: 'if (ok) viewer.currentPageNumber = 3 // pdf-scroll-guard: checked above'
      }
    ]
    expect(findUnguardedScrollCalls(files)).toEqual([])
  })

  it('keeps an explicit reason for every allowlisted file', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST))
      expect(reason.trim(), file).not.toBe('')
  })

  it('documents the coverage boundary: indirect alias calls are not detected', () => {
    const files: ScannedFile[] = [
      {
        path: 'Alias.tsx',
        text: 'const scroll = viewer.scrollPageIntoView\nscroll({ pageNumber: 3 })'
      }
    ]
    expect(findUnguardedScrollCalls(files)).toEqual([])
  })
})
