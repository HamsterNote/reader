import type { ReaderPagePaintingMap } from '../components/Page'
/** Revision changes and empty page containers are not edits. All object fields remain significant. */
export const paintingContentKey = (value: ReaderPagePaintingMap | undefined) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, doc]) => doc.objects.length > 0)
        .map(([id, doc]) => {
          return [id, { ...doc, documentRevision: undefined }]
        })
    )
  )
