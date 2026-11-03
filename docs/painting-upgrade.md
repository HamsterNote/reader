# Painting integration

The reader integration uses the published `@hamster-note/painting@0.8.1` package, pinned exactly in `package.json` and `yarn.lock`.

## Public drawing API

- `ReaderData.pagePaintings` and `ReaderPagePaintingMap` contain complete `EditorDocument` values (`schemaVersion: 3`).
- `onPagePaintingChange(pageId, document, paintings)` and `onPagePaintingsChange(paintings)` emit committed documents. Controlled echoes do not emit another change. Other selection and annotation callbacks keep their existing semantics.
- `paintingTool` uses `LayeredEditorTool`, for example `freehand`, `line`, `rect`, `ellipse`, `selection`, and `eraser`. Callers must update the retired `pen` tool value to `freehand`.
- Lower-level viewers accept `paintingSettings: LayeredToolsSnapshot`. `Reader.drawingStrokeColor` controls both freehand and shape settings; the library freezes the color when a stroke starts.
- Drawing types are re-exported from the reader entry point. The stylesheet entry remains `@hamster-note/reader/style.css`.

`PageDrawingLayer` creates a library controller per document/page session and subscribes only to committed document changes. A changed external document replaces that controller; an equal controlled echo retains it. Disabling input or switching tools/pages cancels unfinished input through the library surface.

## Page geometry

PDF integration passes the intrinsic page's scale-1 viewport dimensions and transform as the reference, plus the current pdf.js viewport transform, to `createPageGeometry`. Those viewport tuples include pdf.js rotation and crop behavior. `PageDrawingSurface` owns projection, inverse input mapping, current DOM bounds, ancestor CSS scaling, and DPR handling. Reader does not transform saved points or calculate inverse drawing matrices.

Other page consumers pass their intrinsic dimensions and displayed layout dimensions to the same geometry API. Preview and reading modes use the same surface with input disabled.

## Storage prerequisite

This integration is a draft until the storage work lands. It must **not** be merged with the existing v4 write paths still active.

The required final storage behavior is:

- Web: authoritative `hamster-reader-demo:annotations:v5:<fileName>`.
- Host: authoritative `reader.host.v2.snapshot.<fileId>`, using `data.annotations`.
- Only a missing new key permits one complete-file migration through `migrateLegacyDocument(unknown)`. A corrupt or unsupported new key is an error. Production storage must bind the published `readLayeredDocument` validator when constructed.
- Every save, import, delete and clear writes the new format only. Empty new data remains authoritative. The original v4 blob stays byte-for-byte unchanged.
- The host advances confirmed state only after a successful durable write and bridge acknowledgment.

Older apps continue to display the preserved pre-upgrade state; they cannot display subsequent drawing changes. There is no reverse projection or dual write.

Tasks 2.3/2.4 await storage PR #33; host persistence and acknowledgment work also remains outstanding. The current typecheck errors in `test/highlightStorage.test.ts` reflect its old serializer fixtures and must be resolved together with that storage integration.

## Verification and remaining gate

- `yarn test:run` exercises the actual installed package, including mixed invalid pen styles, controlled echoes, complete objects, stroke colors, cancellation, and shared consumers.
- `yarn check:painting` runs real pdf.js with Chromium at DPR 1/2/3, scale 50/100/200%, before/after scrolling, and navigation/remount. It writes a JSON report and exits unsuccessfully if any contract fails.
- On 0.8.1, a surface first mounted with `enabled=false` fails to display saved objects. `test/painting-page-contract.test.tsx` and the browser's disabled-remount cases deliberately remain failing until painting fixes the presentation lifecycle. No reader workaround is included.
- The browser matrix covers mouse input and the checked viewport combinations. Rotation/crop fixtures, touch/pen on real devices, iOS/Android WebView, and persistence fault injection still require acceptance runs.
