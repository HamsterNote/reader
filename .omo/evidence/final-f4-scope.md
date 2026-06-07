# Final Verification Wave F4 — Scope Fidelity Check

Plan: `.omo/plans/selection-overlay-polygon.md`

## Verdict

REJECT

## Required Command Evidence

### Source/Test diff stat

Command:

```bash
git diff --stat HEAD -- ':!.omo' ':!openspec' ':!test-results' ':!node_modules'
```

Output:

```text
demo/App.tsx                                  |   15 +-
src/components/IntermediateDocumentViewer.tsx |  886 +++++++++++++++++-
src/components/Reader.tsx                     |   12 +-
src/index.ts                                  |    4 +
src/styles/reader.scss                        |   98 ++
test/demo.test.tsx                            |   15 +-
test/intermediate-document-viewer.test.tsx    | 1197 ++++++++++++++++++++++++-
test/setup.ts                                 |   13 +
8 files changed, 2199 insertions(+), 41 deletions(-)
```

Additional name-status check:

```text
M	demo/App.tsx
M	src/components/IntermediateDocumentViewer.tsx
M	src/components/Reader.tsx
M	src/index.ts
M	src/styles/reader.scss
M	test/demo.test.tsx
M	test/intermediate-document-viewer.test.tsx
M	test/setup.ts
```

`git status --short` also shows expected new files `src/components/selectionGeometry.ts` and `test/selection-geometry.test.tsx` as untracked, plus `.omo/`, `openspec/...`, and `test-results/` outside the source/test diff scope.

## Scope Checks

### (a) R1 NOT implemented

Result: FAIL.

Required grep for `snap`, `nearest`, `proximity`, `closest-word`, `closest-text` in `src/` found R1 indicators in `src/components/IntermediateDocumentViewer.tsx`:

```text
607: * Get caret position from a point, with fallback to nearest text element.
610: const buildSnapRange = (
683: const nearestElement = getNearestTextElementForPoint(
693: range: buildSnapRange(nearestElement, clientX),
```

The implementation does not only use native `caretPositionFromPoint` / `caretRangeFromPoint`. It falls back to `getNearestTextElementForPoint()` and builds a synthetic range from the nearest text element via `buildSnapRange()`. That exceeds the plan guardrail at `.omo/plans/selection-overlay-polygon.md:78` and `.omo/plans/selection-overlay-polygon.md:79`.

### (b) R5 NOT rebuilt

Result: FAIL.

Required grep for `--custom-selection` and `::selection` in SCSS found the selector in `src/styles/reader.scss`, but `git diff HEAD -- src/styles/reader.scss` shows it is part of a newly added block:

```diff
+// Suppress native selection highlight when custom overlay is active
+.hamster-reader__intermediate-document-viewer--custom-selection {
+  .hamster-reader__intermediate-text::selection,
+  .hamster-reader__intermediate-text *::selection,
+  .hamster-reader__html-parser-output::selection,
+  .hamster-reader__html-parser-output *::selection {
+    background-color: transparent;
+  }
+}
```

`src/components/IntermediateDocumentViewer.tsx:1321` still applies `hamster-reader__intermediate-document-viewer--custom-selection` when overlay is enabled, but the SCSS evidence indicates R5 was rebuilt rather than only regression-verified. This violates `.omo/plans/selection-overlay-polygon.md:81`.

### (c) API not broken

Result: FAIL.

Preserved/additive evidence:

- `src/components/IntermediateDocumentViewer.tsx:29` still exports `ReaderSelectionOverlayRect`.
- `src/components/IntermediateDocumentViewer.tsx:206` still exports `mergeSelectionRects`.
- `src/components/IntermediateDocumentViewer.tsx:248` still exports `getSelectionOverlayRects`.
- `src/components/IntermediateDocumentViewer.tsx:80` and `src/components/IntermediateDocumentViewer.tsx:84` keep `onTextSelectionChange` and `onTextSelectionEnd` signatures unchanged.

Breaking/compatibility evidence:

```ts
// src/components/IntermediateDocumentViewer.tsx:89
selectionHandleElement?: React.ReactElement<ReaderSelectionHandleRenderProps>

// src/components/Reader.tsx:36
selectionHandleElement?: ReactElement<ReaderSelectionHandleRenderProps>
```

Runtime logic handles `selectionHandleElement === null` at `src/components/IntermediateDocumentViewer.tsx:1824`, but both public TypeScript prop signatures exclude `null`. The requirement says the prop must allow `undefined` for default, a custom React element, and `null` for disable, so this is not API-compatible.

`src/index.ts` exports are additive only in the diff, adding `ReaderSelectionOverlayOptions`, `ReaderSelectionHandleRenderProps`, and `ReaderSelectionOverlayPolygon`. It does not remove existing exports.

### (d) Files in scope

Result: FAIL.

Expected/acceptable modified files per F4:

- `src/components/IntermediateDocumentViewer.tsx`
- `src/components/selectionGeometry.ts`
- `src/styles/reader.scss`
- `src/index.ts`
- `test/intermediate-document-viewer.test.tsx`
- `test/selection-geometry.test.tsx`
- `test/setup.ts`
- acceptable if needed: `demo/App.tsx`, `src/components/Reader.tsx`

Unexpected source/test modification:

- `test/demo.test.tsx`

Because an unexpected file is modified, scope fidelity fails.

## Final Verdict

REJECT — implementation exceeded scope due to R1 nearest/snap fallback behavior, R5 SCSS rebuild, `selectionHandleElement` type incompatibility for `null`, and out-of-plan modification of `test/demo.test.tsx`.
