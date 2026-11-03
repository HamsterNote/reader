# Painting integration

The reader integration uses the published `@hamster-note/painting@0.8.3` package, pinned exactly in `package.json` and `yarn.lock`.

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

Host persistence uses the authoritative `reader.host.v2.snapshot.<fileId>` key and is delivered by PR #34 (new key, atomic `.pending`/`.bak` replacement, per-file serialization) and PR #36 (snapshot envelope and closing handshake). The Web snapshot producer writes only `data.annotations`; the legacy `serializeHighlights` write path and its callers are removed, so there is no dual write or legacy-key fallback. A legacy `highlights` envelope is migrated once on restore and the complete migrated container is committed to the new key and acknowledged before the session starts; a failed commit keeps the original bytes and reports an error. The host advances its confirmed snapshot only after a durable write is acknowledged, and the closing handshake (`flush` → `quiesce` → `ready` → `dispose`) makes sure pending writes — including a gesture that was still in progress when closing began — are acknowledged before the session is disposed. A failed or timed-out close keeps the session usable and reports `unconfirmed` instead of claiming success. The v1 document record keeps its original bytes.

## Verification and remaining gate

- `yarn typecheck`, `yarn lint`, `yarn build:lib`, and `yarn host:check` pass. The 0.8.3 full regression run passes all 99 test files / 1366 tests.
- `test/annotation-store.test.ts` checks v2/v3/v4 migration, all-page atomicity, mandatory validator wiring, quota retry, corrupt/new-key precedence, file isolation, and byte preservation. The demo tests additionally cover UI errors/retry, clear/reopen, drawing/history saves, and retired-file callbacks.
- `yarn test:run` exercises the actual installed package, including mixed invalid pen styles, controlled echoes, complete objects, stroke colors, cancellation, and shared consumers.
- `yarn check:painting` runs real pdf.js with Chromium at DPR 1/2/3, scale 50/100/200%, before/after scrolling, and navigation/remount. It writes a JSON report and exits unsuccessfully if any contract fails.
- The published 0.8.3 package fixes the disabled-first-mount presentation defect. `test/painting-page-contract.test.tsx` verifies complete saved ink, shapes, text, and images on disabled first mount and remount. Chromium checks all saved object IDs after disabled remount, at every DPR, without changing the document. No reader implementation workaround is needed.
- On 0.8.3, all 18 Chromium positioning cases pass with maximum error approximately 0.000012 CSS px; all three disabled-remount checks display all six saved objects. The browser report records the actual installed package version and any runtime errors.
- The browser matrix covers mouse input, DPR 1/2/3, 50/100/200% zoom and before/after scrolling. Rotation/crop are covered by the page-geometry contract and integration tests, but there is no dedicated browser report for them. Touch/pen on real devices, iOS/Android WebView, and durable disk-failure injection are waived by the user (2026-11-03) and were not run. The Web store and demo quota paths are covered by automated tests.

- The earlier text-editor limitation (an active draft could submit after input was disabled) is fixed in the published 0.8.3 package. `test/painting-page-contract.test.tsx` verifies that disabling the surface discards a reader text draft — via both Ctrl+Enter and the 完成 button — and that the draft never persists across remounts.
