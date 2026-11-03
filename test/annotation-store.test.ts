import fixture from './compat/fixtures/highlights/pdf-two-column.v4.json'
import { migrateLegacyDocument } from '@hamster-note/painting/core'
import { describe, expect, it, vi } from 'vitest'
import {
  createAnnotationStore,
  isPaintingDocument,
  type ReaderAnnotations
} from '../src/storage/annotationStore'
import { annotationStorageV5Key } from '../src/storage/highlightStorage'

const oldKey = (name: string) => `hamster-reader-demo:highlights:${name}`
const empty: ReaderAnnotations = {
  version: 5,
  ranges: [],
  rects: [],
  paintings: {}
}

function setup() {
  const values = new Map<string, string>()
  const backend = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    })
  }
  return {
    values,
    backend,
    store: createAnnotationStore(backend, isPaintingDocument)
  }
}

function documentFixture() {
  const result = migrateLegacyDocument(fixture.paintings['page-1'])
  if (!result.ok) throw new Error('invalid migration fixture')
  return result.value
}

describe('published painting validator bound at construction', () => {
  it('requires a validator at compile time and at runtime', () => {
    const { backend } = setup()
    // @ts-expect-error Omission must remain a type error, as well as a runtime error.
    expect(() => createAnnotationStore(backend)).toThrow(TypeError)
  })

  it('rejects invalid documents on both read and write', () => {
    const { values, backend, store } = setup()
    const bad = { ...empty, paintings: { 'page-1': { schemaVersion: 99 } } }
    values.set(annotationStorageV5Key('read.pdf'), JSON.stringify(bad))
    expect(store.open('read.pdf').status).toBe('error')
    expect(
      store.save('write.pdf', bad as unknown as ReaderAnnotations).status
    ).toBe('invalid-input')
    expect(backend.setItem).not.toHaveBeenCalled()
  })
})

describe('one complete-file migration to the authoritative V5 key', () => {
  it.each([2, 3, 4])(
    'opens legacy v%i without rewriting its source',
    (version) => {
      const { values, backend, store } = setup()
      const raw = JSON.stringify({
        ...fixture,
        version,
        paintings: version === 4 ? fixture.paintings : undefined
      })
      values.set(oldKey('book.pdf'), raw)
      const result = store.open('book.pdf')
      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return
      expect(result.storage.version).toBe(5)
      expect(result.storage.ranges).toEqual(fixture.ranges)
      expect(result.storage.rects).toEqual(version === 2 ? [] : fixture.rects)
      expect(result.storage.paintings).toEqual(
        version === 4 ? { 'page-1': documentFixture() } : {}
      )
      expect(backend.setItem).toHaveBeenCalledTimes(1)
      expect(values.get(oldKey('book.pdf'))).toBe(raw)
      expect(store.open('book.pdf')).toEqual(result)
      expect(backend.setItem).toHaveBeenCalledTimes(1)
    }
  )

  it('migrates unmounted pages in one commit and matches the published API exactly', () => {
    const { values, backend, store } = setup()
    const input = {
      ...fixture,
      paintings: {
        'page-1': fixture.paintings['page-1'],
        'page-99': fixture.paintings['page-1']
      }
    }
    const raw = JSON.stringify(input, null, 3)
    values.set(oldKey('many.pdf'), raw)
    const result = store.open('many.pdf')
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.storage.paintings).toEqual({
      'page-1': documentFixture(),
      'page-99': documentFixture()
    })
    expect(backend.setItem).toHaveBeenCalledOnce()
    expect(values.get(oldKey('many.pdf'))).toBe(raw)
    expect(store.open('other.pdf')).toEqual({ status: 'ready', storage: empty })
    expect(store.open('many.pdf')).toEqual(result)
  })

  it.each([
    { dashOffset: 'broken' },
    { fillOpacity: 2 },
    { rotationRad: 'broken' }
  ])('a corrupt later page fails the whole migration (%j)', (style) => {
    const { values, backend, store } = setup()
    const raw = JSON.stringify({
      ...fixture,
      paintings: {
        'page-1': fixture.paintings['page-1'],
        'page-99': {
          strokes: [
            {
              id: 'broken',
              tool: 'pen',
              width: 3,
              points: [{ x: 10, y: 20 }],
              ...style
            }
          ]
        }
      }
    })
    values.set(oldKey('bad.pdf'), raw)
    expect(store.open('bad.pdf').status).toBe('error')
    expect(store.open('bad.pdf').status).toBe('error')
    expect(backend.setItem).not.toHaveBeenCalled()
    expect(values.get(oldKey('bad.pdf'))).toBe(raw)
    expect(values.has(annotationStorageV5Key('bad.pdf'))).toBe(false)
  })

  it.each([
    '{bad',
    '[]',
    '{"version":99}',
    '{"version":4,"paintings":null}',
    '{"version":4,"paintings":{"page-0":{}}}'
  ])('preserves invalid legacy input: %s', (raw) => {
    const { values, backend, store } = setup()
    values.set(oldKey('bad.pdf'), raw)
    expect(store.open('bad.pdf').status).toBe('error')
    expect(backend.setItem).not.toHaveBeenCalled()
    expect(values.get(oldKey('bad.pdf'))).toBe(raw)
  })

  it('reports quota failure, retries a full migration, then saves only V5', () => {
    const { values, backend, store } = setup()
    const raw = JSON.stringify(fixture)
    values.set(oldKey('book.pdf'), raw)
    backend.setItem.mockImplementationOnce(() => {
      throw new Error('quota')
    })
    expect(store.open('book.pdf').status).toBe('error')
    expect(values.has(annotationStorageV5Key('book.pdf'))).toBe(false)
    expect(store.open('book.pdf').status).toBe('ready')
    expect(store.save('book.pdf', empty)).toEqual({ status: 'saved' })
    expect(store.open('book.pdf')).toEqual({ status: 'ready', storage: empty })
    expect(values.get(oldKey('book.pdf'))).toBe(raw)
    expect(
      backend.setItem.mock.calls.every(
        ([key]) => key === annotationStorageV5Key('book.pdf')
      )
    ).toBe(true)
  })

  it.each([
    '',
    ' ',
    '{bad',
    '{"version":6}',
    '{"version":5,"ranges":[],"rects":[],"paintings":{"page-1":{"schemaVersion":99}}}'
  ])('never falls back from an existing invalid new key: %s', (raw) => {
    const { values, backend, store } = setup()
    values.set(annotationStorageV5Key('book.pdf'), raw)
    values.set(oldKey('book.pdf'), JSON.stringify(fixture))
    expect(store.open('book.pdf').status).toBe('error')
    expect(backend.getItem).toHaveBeenCalledTimes(1)
    expect(store.save('book.pdf', empty).status).toBe('refused')
    expect(values.get(annotationStorageV5Key('book.pdf'))).toBe(raw)
    expect(backend.setItem).not.toHaveBeenCalled()
  })

  it('keeps the last complete new record when saving fails', () => {
    const { values, backend, store } = setup()
    const original = { ...empty, paintings: { 'page-1': documentFixture() } }
    expect(store.save('book.pdf', original).status).toBe('saved')
    const bytes = values.get(annotationStorageV5Key('book.pdf'))
    backend.setItem.mockImplementationOnce(() => {
      throw new Error('quota')
    })
    expect(store.save('book.pdf', empty).status).toBe('failed')
    expect(values.get(annotationStorageV5Key('book.pdf'))).toBe(bytes)
    expect(store.open('book.pdf')).toEqual({
      status: 'ready',
      storage: original
    })
    expect(store.save('book.pdf', empty).status).toBe('saved')
    expect(store.open('book.pdf')).toEqual({ status: 'ready', storage: empty })
  })
})
