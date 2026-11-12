import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { resolveEpubTextAnchor } from '../../src/epub/epubTextAnchor'
import { legacyPageTextFromChapter } from '../../src/epub/legacyText'
import { createEpubEngine } from '../../src/epub/foliateEpubEngine'
import { makeFakeView } from './fakeView'

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../compat/fixtures/epub', name))
const source = fixture('native-inline.epub')
const sidecar = JSON.parse(fixture('native-inline-sidecar.json').toString())
const anchor = sidecar.reading_position.data.textReadingProgress.anchor
const zip = await JSZip.loadAsync(source)
const xml = await zip.file('OEBPS/ch2.xhtml')!.async('string')
const pageText = legacyPageTextFromChapter(xml)

describe('native beta.3 EPUB progress', () => {
  it('projects the real sidecar 15279 to 16459 without mutating it', () => {
    const original = JSON.stringify(sidecar)
    expect(anchor.offset).toBe(15279)
    expect(pageText.indexOf('Chapter 2 paragraph 20.')).toBe(16459)
    const resolved = resolveEpubTextAnchor(anchor, pageText)
    expect(resolved).toEqual({
      pageNumber: 2,
      textId: 'page-2-text',
      text: 'C',
      offset: 16459
    })
    expect(resolveEpubTextAnchor(resolved, pageText)).toEqual(resolved)
    expect(JSON.stringify(sidecar)).toBe(original)
  })

  it.each([0, 15279, 16459])('does not remap a 3.0.0 offset %i', (offset) => {
    const current = {
      pageNumber: 2,
      textId: 'page-2-text',
      text: pageText[offset],
      offset
    }
    expect(resolveEpubTextAnchor(current, pageText)).toEqual(current)
  })

  it('rejects changed, truncated or missing source text instead of silently using the old offset', () => {
    for (const text of [
      '',
      anchor.text.slice(0, -1),
      anchor.text.replace('paragraph 35', 'paragraph 99')
    ]) {
      expect(() =>
        resolveEpubTextAnchor({ ...anchor, text }, pageText)
      ).toThrow('无法精确恢复')
    }
    expect(() =>
      resolveEpubTextAnchor({ ...anchor, offset: -1 }, pageText)
    ).toThrow()
    expect(() =>
      resolveEpubTextAnchor({ ...anchor, offset: 1.5 }, pageText)
    ).toThrow()
  })

  it('excludes native display newlines and image placeholders from canonical offsets', () => {
    expect(
      resolveEpubTextAnchor(
        { pageNumber: 1, textId: 'page-1', text: 'AB\n\uFFFC\nCD', offset: 2 },
        'A BC D'
      ).offset
    ).toBe(3)
  })

  it('restores the actual paragraph and keeps the projected character through reflow', async () => {
    const doc = new DOMParser().parseFromString(xml, 'text/html')
    const fake = makeFakeView({
      sectionHrefs: ['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/ch3.xhtml']
    })
    const engine = createEpubEngine(
      { container: document.createElement('div'), source },
      fake.factory
    )
    await engine.ready
    fake.handle.emit('load', { index: 1, doc })
    vi.spyOn(fake.handle.renderer, 'getContents').mockReturnValue([
      { index: 1, doc }
    ])
    const relocate = () =>
      fake.handle.emit('relocate', { index: 1, fraction: 0, size: 0.1 })
    vi.spyOn(fake.handle.renderer, 'goTo').mockImplementation(async () =>
      relocate()
    )
    const scroll = vi
      .spyOn(fake.handle.renderer, 'scrollToAnchor')
      .mockImplementation(async () => relocate())
    try {
      await engine.goToPosition(anchor)
      expect(engine.captureReadingPosition()).toMatchObject({
        status: 'ready',
        position: { offset: 16459, textId: 'page-2-text' }
      })
      const range = (scroll.mock.calls.at(-1) as unknown as [Range])[0]
      expect(range.startContainer.parentElement?.id).toBe('p20')
      expect(range.toString()).toBe('C')
      fake.handle.emit('before-reflow', {})
      await vi.waitFor(() => expect(engine.navigationState().busy).toBe(false))
      expect(engine.captureTextAnchor()?.offset).toBe(16459)
      expect(scroll).toHaveBeenCalledTimes(2)
      await expect(
        engine.goToAnchor({ ...anchor, text: 'mismatched' })
      ).rejects.toThrow('无法精确恢复')
    } finally {
      await engine.destroy()
    }
  })
})
