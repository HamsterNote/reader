import { expect, it } from 'vitest'
import {
  createNativeAnnotationController,
  type NativeAnnotationSnapshot
} from '../src/nativePdf/annotationController'
import {
  diffNativeAnnotationSnapshots,
  applyNativeAnnotationPatch
} from '../src/nativePdf/annotationPatch'
import { appendStrokeDocument } from '../src/nativePdf/strokes'
import { ReaderDataStore } from '../src/host/readerDataStore'
import { withNativeAnnotationData } from '../src/nativePdf/drawing'
import { restoreReaderSnapshot } from '../src/host/readerSnapshot'
import { withNativeAnnotationPatch } from '../src/nativePdf/annotationPatch'
import type { ReaderSelectionRange } from '../src/types/selection'
import type { ReaderData } from '../src/types/readerData'

const range: ReaderSelectionRange = {
  id: 'R',
  text: 'R',
  createdAt: 1,
  start: { selectionId: 'page-1', offset: 0 },
  end: { selectionId: 'page-1', offset: 1 },
  rectsBySelectionId: { 'page-1': [{ x: 0, y: 0, width: 10, height: 10 }] }
}
const painting = (color: string) =>
  appendStrokeDocument(
    undefined,
    'stroke',
    [
      { x: 0, y: 0 },
      { x: 20, y: 20 }
    ],
    { color, time: 1 }
  )!
const snapshot = (color: string): NativeAnnotationSnapshot => ({
  ranges: [range],
  rects: [],
  pagePaintings: { 'page-1': painting(color) }
})

function readerData(value: NativeAnnotationSnapshot): ReaderData {
  return {
    ranges: [...value.ranges],
    rects: [...value.rects],
    pagePaintings: value.pagePaintings
  }
}

it('an unrelated range deletion must preserve the other pane confirmed painting update', () => {
  const before = snapshot('black')
  const patch = diffNativeAnnotationSnapshots(before, { ...before, ranges: [] })
  const merged = applyNativeAnnotationPatch(snapshot('red'), patch)
  expect(merged.ranges).toHaveLength(0)
  expect(merged.pagePaintings['page-1'].objects).toEqual(
    painting('red').objects
  )
})

it('undo of a rectangle addition must preserve a later acknowledged painting edit', () => {
  const controller = createNativeAnnotationController(
    readerData(snapshot('black'))
  )
  controller.apply({
    commitId: 'add-rectangle',
    intent: {
      type: 'rectangle',
      pageNumber: 1,
      rect: { x: 1, y: 2, width: 20, height: 20 },
      phase: 'commit',
      geometryRevision: 1
    }
  })
  controller.replaceSnapshot(
    readerData({
      ...controller.getSnapshot(),
      pagePaintings: snapshot('red').pagePaintings
    }),
    { preserveHistory: true }
  )
  expect(controller.undo()).toBe(true)
  expect(controller.getSnapshot().ranges).toHaveLength(1)
  expect(controller.getSnapshot().pagePaintings['page-1'].objects).toEqual(
    painting('red').objects
  )
})

it('persists the unrelated deletion without reverting the acknowledged stroke', async () => {
  const values = new Map<string, string>()
  const store = new ReaderDataStore({
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    }
  })
  const fileId = 'f_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const before = snapshot('black')
  await store.upsert({
    fileId,
    fileName: 'a.pdf',
    format: 'pdf',
    size: 1,
    modifiedAt: 1,
    importedAt: 1,
    cachedUri: 'reader-files/a.pdf',
    snapshot: {
      data: withNativeAnnotationData(null, before),
      progress: null,
      revision: 0
    }
  })
  const deletion = diffNativeAnnotationSnapshots(before, {
    ...before,
    ranges: []
  })
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationData(base.data, snapshot('red')),
    revision: base.revision + 1
  }))
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationPatch(base.data, deletion),
    revision: base.revision + 1
  }))
  const record = (await store.get(fileId))!
  const data = restoreReaderSnapshot(record.snapshot.data).data
  expect(record.snapshot.revision).toBe(2)
  expect(data.ranges).toHaveLength(0)
  expect(data.pagePaintings?.['page-1'].objects).toEqual(
    painting('red').objects
  )
})

async function seededStore(before: NativeAnnotationSnapshot) {
  const values = new Map<string, string>()
  const store = new ReaderDataStore({
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    }
  })
  const fileId = 'f_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  await store.upsert({
    fileId,
    fileName: 'b.pdf',
    format: 'pdf',
    size: 1,
    modifiedAt: 1,
    importedAt: 1,
    cachedUri: 'reader-files/b.pdf',
    snapshot: {
      data: withNativeAnnotationData(null, before),
      progress: null,
      revision: 0
    }
  })
  return { store, fileId }
}

async function confirmPainting(
  store: ReaderDataStore,
  fileId: string,
  color: string
) {
  await store.updateSnapshot(fileId, (base) => {
    const restored = restoreReaderSnapshot(base.data, base.progress)
    return {
      ...base,
      data: withNativeAnnotationData(base.data, {
        ranges: restored.data.ranges ?? [],
        rects: restored.data.rects ?? [],
        pagePaintings: { 'page-1': painting(color) }
      }),
      revision: base.revision + 1
    }
  })
}

async function readNative(store: ReaderDataStore, fileId: string) {
  const record = (await store.get(fileId))!
  const data = restoreReaderSnapshot(record.snapshot.data).data
  return {
    revision: record.snapshot.revision,
    data,
    snapshot: {
      ranges: data.ranges ?? [],
      rects: data.rects ?? [],
      pagePaintings: data.pagePaintings ?? {}
    } as NativeAnnotationSnapshot
  }
}

it('persists an unrelated rectangle addition without reverting the acknowledged stroke', async () => {
  const before = snapshot('black')
  const controller = createNativeAnnotationController(readerData(before))
  controller.apply({
    commitId: 'persist-rectangle',
    intent: {
      type: 'rectangle',
      pageNumber: 1,
      rect: { x: 1, y: 2, width: 20, height: 20 },
      phase: 'commit',
      geometryRevision: 1
    }
  })
  const addition = diffNativeAnnotationSnapshots(
    before,
    controller.getSnapshot()
  )
  const { store, fileId } = await seededStore(before)
  await confirmPainting(store, fileId, 'red')
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationPatch(base.data, addition),
    revision: base.revision + 1
  }))

  const current = await readNative(store, fileId)
  expect(current.revision).toBe(2)
  expect(current.data.ranges).toEqual([range])
  expect(current.data.rects).toHaveLength(1)
  expect(current.data.pagePaintings?.['page-1']?.objects).toEqual(
    painting('red').objects
  )
})

it('persists rectangle undo and redo without reverting later acknowledged strokes', async () => {
  const before = snapshot('black')
  const controller = createNativeAnnotationController(readerData(before))
  controller.apply({
    commitId: 'undo-redo-rectangle',
    intent: {
      type: 'rectangle',
      pageNumber: 1,
      rect: { x: 1, y: 2, width: 20, height: 20 },
      phase: 'commit',
      geometryRevision: 1
    }
  })
  const { store, fileId } = await seededStore(before)
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationPatch(
      base.data,
      diffNativeAnnotationSnapshots(before, controller.getSnapshot())
    ),
    revision: base.revision + 1
  }))
  await confirmPainting(store, fileId, 'red')

  controller.replaceSnapshot(
    readerData((await readNative(store, fileId)).snapshot),
    {
      preserveHistory: true
    }
  )
  const beforeUndo = controller.getSnapshot()
  expect(controller.undo()).toBe(true)
  const undo = diffNativeAnnotationSnapshots(
    beforeUndo,
    controller.getSnapshot(),
    { history: 'undo' }
  )
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationPatch(base.data, undo),
    revision: base.revision + 1
  }))
  let current = await readNative(store, fileId)
  expect(current.revision).toBe(3)
  expect(current.data.ranges).toEqual([range])
  expect(current.data.rects).toEqual([])
  expect(current.data.pagePaintings?.['page-1']?.objects).toEqual(
    painting('red').objects
  )

  await confirmPainting(store, fileId, 'blue')
  controller.replaceSnapshot(
    readerData((await readNative(store, fileId)).snapshot),
    {
      preserveHistory: true
    }
  )
  const beforeRedo = controller.getSnapshot()
  expect(controller.redo()).toBe(true)
  const redo = diffNativeAnnotationSnapshots(
    beforeRedo,
    controller.getSnapshot(),
    { history: 'redo' }
  )
  await store.updateSnapshot(fileId, (base) => ({
    ...base,
    data: withNativeAnnotationPatch(base.data, redo),
    revision: base.revision + 1
  }))
  current = await readNative(store, fileId)
  expect(current.revision).toBe(5)
  expect(current.data.ranges).toEqual([range])
  expect(current.data.rects).toHaveLength(1)
  expect(current.data.pagePaintings?.['page-1']?.objects).toEqual(
    painting('blue').objects
  )
})
