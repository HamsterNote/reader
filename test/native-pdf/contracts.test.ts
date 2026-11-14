import { describe, expect, it } from 'vitest'
import { NativePdfSession } from '../../src/nativePdf/session'
import {
  inverseMatrix,
  transformPoint,
  validCrop,
  visibleOriginalPages
} from '../../src/nativePdf/geometry'
import {
  materializeNativeRange,
  mergeNativeSelectionPages,
  nativeSelectionPagesReady
} from '../../src/nativePdf/selection'
import type {
  NativePdfAdapter,
  PdfCanonicalPage,
  PdfEvent,
  PdfIdentity,
  NativePdfAnnotationCommit
} from '../../src/nativePdf/contracts'
const identity: PdfIdentity = {
  fileId: 'book',
  paneId: 'left',
  sessionId: 'session',
  generation: 1
}
const page = (n: number): PdfCanonicalPage => ({
  pageNumber: n,
  width: 400,
  height: 500,
  text: 'hello world',
  boundaries: Array.from({ length: 12 }, (_, offset) => ({
    offset,
    textId: `page-${n}-item-0`,
    rect: { x: offset * 10, y: 10, width: 0, height: 20 }
  })),
  glyphs: Array.from({ length: 11 }, (_, i) => ({
    start: i,
    end: i + 1,
    text: 'hello world'[i]!,
    rect: { x: i * 10, y: 10, width: 10, height: 20 }
  }))
})
describe('native PDF contracts', () => {
  it('keeps native annotation intents host-neutral and JSON serializable', () => {
    const commit: NativePdfAnnotationCommit = {
      commitId: 'commit-1',
      intent: {
        type: 'highlight',
        start: { selectionId: 'page-1', offset: 2 },
        end: { selectionId: 'page-1', offset: 8 },
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 20, width: 40, height: 12 }]
        },
        geometryRevision: 3
      }
    }
    expect(JSON.parse(JSON.stringify(commit))).toEqual(commit)
    expect(JSON.stringify(commit)).not.toMatch(/DOM|WebView|storage|uri/i)
  })
  it('can be implemented with plain JSON values by a future adapter', () => {
    const adapter: NativePdfAdapter = {
      capabilities: {
        nativeLayout: false,
        thumbnails: false,
        textGeometry: false,
        pageImage: false
      },
      send: () => undefined,
      subscribe: () => () => undefined
    }
    expect(JSON.parse(JSON.stringify(adapter.capabilities))).toEqual(
      adapter.capabilities
    )
  })
  it('distinguishes module load, visible pixels and restore, rejects stale geometry and sessions', () => {
    const session = new NativePdfSession(identity)
    session.receive({ ...identity, type: 'loaded', pageCount: 200 })
    expect(session.ready).toBe(false)
    session.receive({ ...identity, type: 'displayed', pageNumber: 1 })
    expect(session.ready).toBe(false)
    session.receive({ ...identity, type: 'restored', pageNumber: 1 })
    expect(session.ready).toBe(true)
    expect(
      session.receive({
        ...identity,
        type: 'geometry',
        pages: [],
        geometryRevision: 4
      })
    ).toBe(true)
    expect(
      session.receive({
        ...identity,
        type: 'geometry',
        pages: [],
        geometryRevision: 3
      })
    ).toBe(false)
    expect(
      session.receive({
        ...identity,
        paneId: 'right',
        type: 'displayed',
        pageNumber: 1
      })
    ).toBe(false)
    expect(session.commit('one')).toBe(true)
    expect(session.commit('one')).toBe(false)
    session.close()
    expect(session.ready).toBe(false)
    expect(session.commit('two')).toBe(false)
  })
  it('only exposes whitelisted diagnostics even for hostile payloads', () => {
    const session = new NativePdfSession(identity)
    session.receive({
      ...identity,
      type: 'loaded',
      pageCount: 1,
      text: 'PRIVATE',
      localUri: 'secret',
      handle: 'opaque'
    } as unknown as PdfEvent)
    const output = JSON.stringify(session.diagnostic('commit-1'))
    expect(output).not.toMatch(/PRIVATE|secret|opaque|localUri|handle|text/)
    expect(output).toContain('commit-1')
  })
  it.each([0.5, 1, 2])(
    'round-trips cropped rotated page transforms at %s scale',
    (scale) => {
      const m = [0, scale, -scale, 0, 127.3, -99.2] as const
      const p = { x: 61.2, y: 104.8 }
      const back = transformPoint(inverseMatrix(m), transformPoint(m, p))
      expect(back.x).toBeCloseTo(p.x, 8)
      expect(back.y).toBeCloseTo(p.y, 8)
    }
  )
  it('keeps original page IDs and validates crops', () => {
    expect(
      visibleOriginalPages(
        200,
        Array.from({ length: 198 }, (_, i) => (i % 2 ? `page-${i + 2}` : i + 2))
      )
    ).toEqual([1, 200])
    expect(visibleOriginalPages(10, [3, 'page-4'], [2, 5])).toEqual([2, 5])
    expect(validCrop({ top: 0.6, bottom: 0.5 })).toBe(false)
    expect(validCrop({ left: Number.NaN })).toBe(false)
    expect(() => inverseMatrix([0, 0, 0, 0, 0, 0])).toThrow()
  })
  it('preserves all intermediate canonical text, role swap and metadata; fails closed on unloaded pages', () => {
    const pages = new Map(
      Array.from({ length: 12 }, (_, i) => [i + 1, page(i + 1)] as const)
    )
    const a = { selectionId: 'page-1', offset: 2 },
      b = { selectionId: 'page-12', offset: 4 }
    const metadata = { id: 'old', createdAt: 123, color: '#abcdef' }
    const allowed = Array.from(pages.keys())
    const result = materializeNativeRange(b, a, pages, allowed, metadata)
    expect(result.text).toBe('llo world' + 'hello world'.repeat(10) + 'hell')
    expect(Object.keys(result.rectsBySelectionId)).toHaveLength(12)
    const withExtra = {
      ...result,
      extension: { future: true }
    } as typeof result
    const edited = materializeNativeRange(
      a,
      b,
      pages,
      allowed,
      { ...metadata, id: 'new', createdAt: 999 },
      withExtra
    )
    expect(edited).toMatchObject({
      id: 'old',
      createdAt: 123,
      extension: { future: true }
    })
    pages.delete(6)
    expect(() =>
      materializeNativeRange(a, b, pages, allowed, metadata)
    ).toThrow('MAPPING_NOT_READY')
    expect(() =>
      materializeNativeRange({ ...a, offset: 999 }, b, pages, allowed, metadata)
    ).toThrow('MAPPING_NOT_READY')
  })
  it('uses canonical pages carried by native selection when the Web cache is empty', () => {
    const supplied = page(1)
    const pages = new Map<number, typeof supplied>()
    expect(nativeSelectionPagesReady(pages, [1])).toBe(false)
    mergeNativeSelectionPages(pages, [supplied])
    expect(nativeSelectionPagesReady(pages, [1])).toBe(true)
    const result = materializeNativeRange(
      { selectionId: 'page-1', offset: 0 },
      { selectionId: 'page-1', offset: 4 },
      pages,
      [1],
      { id: 'native', createdAt: 1, color: '#ff0' }
    )
    expect(result.text).toBe('hell')
    expect(result.end.offset).toBe(4)
  })
  it('reuses OCR canonical cache for activate after a document remount', () => {
    const supplied = page(1)
    const firstSession = new Map<number, typeof supplied>()
    const secondSession = new Map<number, typeof supplied>()
    mergeNativeSelectionPages(firstSession, [supplied])
    // The host sends the same OCR page again when the file is remounted.
    mergeNativeSelectionPages(secondSession, [supplied])
    const result = materializeNativeRange(
      { selectionId: 'page-1', offset: 1 },
      { selectionId: 'page-1', offset: 5 },
      secondSession,
      [1],
      { id: 'existing', createdAt: 1, color: '#ff0' }
    )
    expect(result.text).toBe('ello')
    expect(result.id).toBe('existing')
  })
  it('retains percent rectangle units and existing style fields during endpoint edits', () => {
    const p = page(1),
      pages = new Map([[1, p]])
    const metadata = { id: 'id', createdAt: 3, color: '#123456' }
    const a = { selectionId: 'page-1', offset: 0 },
      b = { selectionId: 'page-1', offset: 3 }
    const range = materializeNativeRange(a, b, pages, [1], metadata)
    const existing = {
      ...range,
      overlayRectType: 'percent' as const,
      markerStyle: { ...range.markerStyle, borderRadius: 5 }
    }
    const edited = materializeNativeRange(
      a,
      { ...b, offset: 5 },
      pages,
      [1],
      { ...metadata, createdAt: 99 },
      existing
    )
    expect(edited.overlayRectType).toBe('percent')
    expect(edited.rectsBySelectionId['page-1']?.[0]).toMatchObject({
      width: 2.5,
      height: 4
    })
    expect(edited.createdAt).toBe(3)
    expect(edited.markerStyle).toMatchObject({ borderRadius: 5 })
  })
})
