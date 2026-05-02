# Proposal: Fix Blank Space Text Selection

## Why

### Original Request
用户要求：选择文字场景，在鼠标已经点下在拖动时，如果鼠标在空白处拖动，应该表现为从开始选择位置选到当前鼠标所在位置的就近文字，而不是选到当前页开头。

### Problem Statement
When a mouse drag selection starts in viewer text and the pointer moves over blank space, the native selection API falls back to page-start text instead of resolving to the nearest text on the relevant page. This creates a poor user experience where blank-space drags unexpectedly select from the beginning of the page rather than maintaining the expected nearest-text behavior.

### Scope
This is a bug fix, not a selection-system rewrite. The fix must preserve existing native Selection API flow and add Vitest regression coverage.

## What Changes

### Core Change
Extend `IntermediateDocumentViewer` with pointer-coordinate tracking for active mouse selection and blank-space selection detail normalization to nearest page text.

### Deliverables
- Minimal additions to `src/components/IntermediateDocumentViewer.tsx`
- New/updated tests in `test/intermediate-document-viewer.test.tsx`
- Passing focused test, full test run, typecheck, and lint

### Definition of Done
- `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`
- `yarn test:run` exits `0`
- `yarn typecheck` exits `0`
- `yarn lint` exits `0`
- New regression test proves blank-space drag near a later text does **not** return page-first text as the normalized endpoint/range

## Capabilities

- Use existing `ReaderTextSelectionDetail` shape from `src/components/IntermediateDocumentViewer.tsx:8`
- Keep `getSelectionDetail()` as the central detail builder, extending it with helper-based normalization rather than replacing the callback pipeline
- Track mouse coordinates only during active primary-button selection inside the viewer
- Select nearest text by distance from pointer `(clientX, clientY)` to rendered text element `getBoundingClientRect()` on the relevant page
- Tie-break equal distances by DOM order

## Impact

### Files Modified
- `src/components/IntermediateDocumentViewer.tsx` — component logic and helper functions
- `test/intermediate-document-viewer.test.tsx` — regression tests and test utilities

### Behavior Impact
- Blank-space mouse drag selection now reports nearest text endpoint instead of page-start fallback
- Valid selections, collapsed selections, outside-viewer selections, touchend, and shift-key end behavior remain compatible with current tests
- No changes to public callback signatures (`onTextSelectionChange`, `onTextSelectionEnd`)

### Test Impact
- Vitest/jsdom only (no Playwright/Cypress infrastructure added)
- Need mocks for `getBoundingClientRect`, `Selection`, and `Range` behavior
- Test fixture: four text spans on page 1 (A, B, C, D)
