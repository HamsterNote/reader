import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EpubCompatIndex } from '../../src/epub/epubCompatIndex'
import { openEpubPackage } from '../../src/epub/epubPackage'
import { buildLegacyEpubModel } from '../../src/epub/legacyEpubModel'
import {
  nativeTextSource,
  projectNativeRange
} from '../../src/epub/nativeTextRanges'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../compat/fixtures/epub', name))
const native = JSON.parse(fixture('native-inline-highlight.json').toString())
const sidecar = JSON.parse(fixture('native-inline-sidecar.json').toString())

describe('native EPUB highlight coordinates', () => {
  it('projects both endpoints of repeated After to p9 and preserves the input', async () => {
    const pkg = await openEpubPackage(fixture('native-inline.epub'))
    try {
      const model = await buildLegacyEpubModel(pkg)
      const index = await EpubCompatIndex.create(pkg, model)
      const source = nativeTextSource(
        (await pkg.readText(pkg.chapters[1].href))!,
        index.pageText(2)!
      )!
      expect(source.display).toBe(
        sidecar.reading_position.data.textReadingProgress.anchor.text
      )
      const before = JSON.stringify(native)
      const located = index.locateRange(native)
      if (located.status !== 'located') throw new Error(located.reason)
      const { range, chapterIndex } = located.parts[0]
      expect(range.toString()).toBe('After')
      expect(range.startContainer.parentElement?.closest('p')?.id).toBe('p9')
      expect(index.serializeRange(chapterIndex, range)).toMatchObject({
        start: { selectionId: 'page-2', offset: 7904 },
        end: { selectionId: 'page-2', offset: 7909 }
      })

      // Edit each endpoint, merge it just like the host, then restore from JSON.
      const local = range.cloneRange()
      local.setStart(local.startContainer, local.startOffset + 1)
      const startEdit = index.updateEndpoint(
        native,
        local,
        chapterIndex,
        false
      )!
      expect(startEdit).toMatchObject({
        start: { offset: 7905 },
        end: { offset: 7909 },
        text: 'fter',
        epubRangeCoordinates: 'reader-compat-v1'
      })
      local.setEnd(local.endContainer, local.endOffset - 1)
      const saved = JSON.parse(
        JSON.stringify({
          ...native,
          ...index.updateEndpoint(
            { ...native, ...startEdit },
            local,
            chapterIndex,
            true
          )
        })
      )
      expect(saved).toMatchObject({
        start: { offset: 7905 },
        end: { offset: 7908 },
        text: 'fte',
        color: 'green',
        nativeTextSegments: native.nativeTextSegments
      })
      const reloaded = index.locateRange(saved)
      if (reloaded.status !== 'located') throw new Error(reloaded.reason)
      expect(
        reloaded.parts[0].range.startContainer.parentElement?.closest('p')?.id
      ).toBe('p9')
      expect(reloaded.parts[0].range.toString()).toBe('fte')
      expect(JSON.stringify(native)).toBe(before)
    } finally {
      await pkg.destroy()
    }
  })

  it('rejects missing, inconsistent and unsupported native provenance even when the old slice is After', async () => {
    const pkg = await openEpubPackage(fixture('native-inline.epub'))
    try {
      const index = await EpubCompatIndex.create(
        pkg,
        await buildLegacyEpubModel(pkg)
      )
      expect(index.pageText(2)!.slice(7362, 7367)).toBe('After')
      const candidates = [
        { ...native, nativeTextSegments: undefined },
        { ...native, nativeTextSegments: [] },
        {
          ...native,
          nativeTextSegments: [
            { sectionIndex: 1, startOffset: 7371, endOffset: 7377 }
          ]
        },
        { ...native, epubRangeCoordinates: 'unknown-version' }
      ]
      for (const candidate of candidates) {
        const before = JSON.stringify(candidate)
        expect(index.locateRange(candidate)).toEqual({
          status: 'unlocatable',
          reason: 'unverified-native-source'
        })
        expect(JSON.stringify(candidate)).toBe(before)
      }
      // A normal 3.0.0 range with the same integer offsets is already in the
      // compatibility stream: it correctly denotes the other After in p8.
      const modern = { text: native.text, start: native.start, end: native.end }
      const located = index.locateRange(modern)
      if (located.status !== 'located') throw new Error(located.reason)
      expect(
        located.parts[0].range.startContainer.parentElement?.closest('p')?.id
      ).toBe('p8')
    } finally {
      await pkg.destroy()
    }
  })

  it('does not guess ambiguous whitespace or image/display placement', () => {
    expect(nativeTextSource('<p>A<img src="x"/>B</p>', 'AB')).toBeNull()
    const source = nativeTextSource('<p>A B</p>', 'A  B')!
    expect(
      projectNativeRange(
        {
          text: ' ',
          start: { selectionId: 'page-1', offset: 1 },
          end: { selectionId: 'page-1', offset: 2 },
          nativeTextSegments: [
            { sectionIndex: 0, startOffset: 1, endOffset: 2 }
          ]
        },
        () => ({ source, sectionIndex: 0, text: 'A  B' })
      )
    ).toBeNull()
  })
})
