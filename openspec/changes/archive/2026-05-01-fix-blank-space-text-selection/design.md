# Design: Fix Blank Space Text Selection

## Context

### Project Structure
- Component: `src/components/IntermediateDocumentViewer.tsx` (791 lines)
- Tests: `test/intermediate-document-viewer.test.tsx` (977 lines)
- Uses Vitest with jsdom (configured in `vite.config.ts:230`)

### Key Patterns
- `pageRefs` is a `useRef(new Map<number, HTMLDivElement>())` for page element lookup
- `viewerRootRef` is a `useRef<HTMLDivElement>(null)` for viewer boundary
- `textElementsRef` is a `useRef<Map<string, { text: IntermediateText; pageNumber: number }>>` storing text/page metadata
- `setTextRef` registers text elements lifecycle at line 305
- Text spans rendered with `data-text-id` and `data-page-number` attributes at line 745
- `getSelectionDetail()` at line 317 centralizes selection validation/detail output
- `emitSelectionEnd()` at line 397 calls `getSelectionDetail()`
- Selection change listener at line 628, end listener at line 653

### Existing Test Patterns
- `makeMockSelection()` helper at line 577
- `makeTextElement()` helper at line 594
- Tests use `vi.spyOn(window, 'getSelection').mockReturnValue(selection)`
- Events dispatched via `globalThis.document.dispatchEvent(new Event('selectionchange'))`
- Mouse events via `viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))`

## Goals

### Must Have
- Use existing `ReaderTextSelectionDetail` shape from `src/components/IntermediateDocumentViewer.tsx:8`
- Keep `getSelectionDetail()` as the central detail builder, extending it with helper-based normalization rather than replacing the callback pipeline
- Track mouse coordinates only during active primary-button selection inside the viewer
- Select nearest text by distance from pointer `(clientX, clientY)` to rendered text element `getBoundingClientRect()` on the relevant page
- Tie-break equal distances by DOM order

### Must NOT Have
- Must not rewrite the component into a full custom selection engine
- Must not add Playwright, Cypress, or browser automation infrastructure
- Must not change public callback signatures
- Must not normalize selections whose anchor and focus already resolve to text spans and whose selected elements are valid
- Must not let blank-space normalization cross into unrelated DOM outside the viewer

## Decisions

### Nearest-text Rule
- **全页最近** (nearest text within the page under the pointer)
- If pointer is between/outside pages but still in viewer, use nearest page by page-rectangle distance, then nearest text on that page
- Tie-break equal distances by DOM order (`compareDocumentPosition`)

### Mouse Tracking Strategy
- Use `activeMouseSelectionRef` storing `{ active: boolean; clientX: number; clientY: number }`
- Track only during active primary-button selection inside viewer
- Register `mousedown`, `mousemove`, `mouseup` on `viewerRootRef.current`

### Normalization Guardrails
- Preserve valid text-span selections without normalization
- Normalize only blank-space/page-start fallback cases
- Do not normalize keyboard/touch selections in this fix
- Do not change public callback signatures

### Test Strategy
- Vitest/jsdom only (no Playwright/Cypress)
- Need mocks for `getBoundingClientRect`, `Selection`, and `Range` behavior
- Test fixture: four text spans on page 1 (A, B, C, D)

## Risks / Trade-offs

### jsdom Limitations
- `getBoundingClientRect` needs explicit mocking per element
- `document.elementFromPoint` may need mocking
- `Selection` and `Range` behavior is limited

### Implementation Risks
- Must use viewport `clientX/clientY` consistently with `getBoundingClientRect()`
- Do not mutate native `Selection`/`Range`
- Empty pages/no text should return `null` and preserve existing no-callback behavior
- Must not let blank-space normalization cross into unrelated DOM outside the viewer

### Verification Risks
- jsdom needs explicit mocks for `getBoundingClientRect`, `Selection`, and `Range` behavior
- Test limitation: jsdom environment differs from real browser behavior
