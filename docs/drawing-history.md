# Drawing annotation history

`annotationHistory` now keeps one file session at Reader, shared by the engine and intermediate viewers. Page controllers still own input and rendering; their local undo histories are not used by Reader commands. The drawing integration and V5 persistence from HAM-131 remain in place without a format migration.

The history value includes all pages' complete schema-3 documents. Legacy values without `pagePaintings` preserve drawings; explicit `{}` clears them. Snapshots copy newly committed page documents and share unchanged pages. Synchronous history refs serialize multiple commits in one React batch.

Each completed freehand/shape creates one checkpoint. The published painting 0.8.3 selection transforms/object edits and eraser sweeps commit through one `editObjects` transaction at the end of input. One eraser sweep can remove multiple objects. PageDrawingLayer filters revision-only document notifications, including empty eraser transactions. Tool changes, previews and geometry do not commit content. Reader also rejects equivalent page changes before history and save callbacks.

Reader exposes selection, eraser, text, shape and freehand tools already supplied by painting. Reader has no separate drawing-object delete or page-clear UI/ref command, and no standalone whole-stroke redraw tool. Public library `editObjects({ upsert, removeIds, expectedDocumentRevision })` can replace one object, delete objects, or clear a page atomically; its committed-document subscription remains one transaction. No new reader tools are added. Existing selectionRef.clear is unchanged in scope.

Undo/redo first invalidate mounted page input sessions, including text/shape/freehand drafts, then apply one committed target. Late events from a retired controller cannot publish. Page unload does not discard file history. File switches, explicit resetKey changes and different external content establish a fresh baseline; equal controlled echoes preserve redo.

Drawing history notifications have source `drawing` and precede ordinary drawing callbacks. Hosts save drawing content through the existing callback and use that history event for status. On replay, hosts apply the complete target atomically and save once. WebView ReaderSurface and the demo follow this routing. Missing a required controlled history handler disables commands without moving either stack. History is session-only and is not persisted in V5.

## Verification

- `yarn test:run`: 100 files / 1375 tests pass, including Reader, both viewer histories, published painting contracts, the WebView save router and the mixed-history bridge/ack/reopen chain.
- `yarn typecheck`, `yarn build:lib`, `yarn host:check` and ESLint on the changed code pass.
- `yarn check:painting`: 18 PDF positioning cases at DPR 1/2/3 and 50/100/200% zoom, three disabled remount cases, and three complete Reader history cases (PDF Layout, EPUB, generic pages) pass. The history cases use real Chromium mouse and CDP touch input, toolbar and ref commands, unmounted-page replay, active-input cancellation/late pointerup, and redo invalidation after new ink. Maximum positioning error is below 0.00002 CSS px. This is browser verification; no physical iOS/Android device run was performed.
- No migration or reverse projection was introduced; schema 3 documents still use the established V5 annotation container and host acknowledgment chain.
