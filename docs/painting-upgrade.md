# Painting integration

The reader integration uses the published `@hamster-note/painting@0.8.2` package, pinned exactly in `package.json` and `yarn.lock`.

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

## V5 storage and recovery

Web demo uses the authoritative `hamster-reader-demo:annotations:v5:<fileName>` key. Its complete container is `{ version: 5, ranges, rects, paintings }`; `paintings` stores complete library documents. `createAnnotationStore(backend, validateDocument)` binds its mandatory validator at construction. The demo passes `readLayeredDocument(value).ok` from the official package. Omitting that argument is a compile error and throws at runtime.

Only a missing new key permits migration. The store reads v2/v3/v4 ranges and rectangles with the existing field rules and passes each original drawing payload directly to `migrateLegacyDocument(unknown)`, including unmounted pages. It commits the complete file with one new-key write after every page succeeds. It never writes, deletes, or rebuilds the original `hamster-reader-demo:highlights:<fileName>` blob. Repeated opening uses the authoritative new record without repeating migration.

A corrupt/unknown new key or failed migration blocks document activation and shows a recovery error. Retry restores the same selected document. Failed saves retain the complete pending snapshot in memory, display an unsaved error, and offer retry; they never report a durable success. Reloading before a successful retry loses those pending changes. The previous saved record and legacy blob remain intact. There is no automatic destructive recovery from corrupt authoritative data.

Drawing changes, highlights, rectangles, history, file restoration and clear now share the new store. A saved empty container remains authoritative on reopening, so old annotations cannot reappear. The clear action also clears drawings and is available for drawing-only documents. Retired-file drawing callbacks cannot change the active file's state.

Older apps continue to display the preserved pre-upgrade state; they cannot display subsequent drawing changes. There is no reverse projection or dual write.

Host persistence (2.5/2.6) is delivered independently in PR #34. Host `data.annotations` production and bridge migration/ack integration (2.7) are explicit follow-up work and are not included in this Web/consumer integration PR. The intended authoritative host key is `reader.host.v2.snapshot.<fileId>`. The host must advance confirmed state only after a successful durable write and acknowledgment. Its snapshot producer still uses the legacy serializer until that follow-up replaces the write path; this PR does not claim complete host migration or end-to-end persistence acceptance.

## Verification and remaining gate

- `yarn typecheck`, `yarn lint`, `yarn build:lib`, and `yarn host:check` pass. The 0.8.2 full regression run passes all 90 test files / 1258 tests.
- `test/annotation-store.test.ts` checks v2/v3/v4 migration, all-page atomicity, mandatory validator wiring, quota retry, corrupt/new-key precedence, file isolation, and byte preservation. The demo tests additionally cover UI errors/retry, clear/reopen, drawing/history saves, and retired-file callbacks.
- `yarn test:run` exercises the actual installed package, including mixed invalid pen styles, controlled echoes, complete objects, stroke colors, cancellation, and shared consumers.
- `yarn check:painting` runs real pdf.js with Chromium at DPR 1/2/3, scale 50/100/200%, before/after scrolling, and navigation/remount. It writes a JSON report and exits unsuccessfully if any contract fails.
- The published 0.8.2 package fixes the disabled-first-mount presentation defect. `test/painting-page-contract.test.tsx` verifies complete saved ink, shapes, text, and images on disabled first mount and remount. Chromium checks all saved object IDs after disabled remount, at every DPR, without changing the document. No reader implementation workaround is needed.
- On 0.8.2, all 18 Chromium positioning cases pass with maximum error approximately 0.000013 CSS px; all three disabled-remount checks display all six saved objects. The browser report records the actual installed package version and any runtime errors.
- The browser matrix covers mouse input and the checked viewport combinations. Rotation/crop fixtures, touch/pen on real devices, iOS/Android WebView, and durable host/bridge fault injection still require acceptance runs. The Web store and demo quota paths are covered by automated tests.
