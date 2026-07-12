# Tasks

## Plan: fix-blank-space-text-selection

### Task 1: Add deterministic selection geometry helpers

- [x] 1. Add `getClosestTextElement(node: Node | null): HTMLElement | null` using `node instanceof Element ? node : node?.parentElement`, then `.closest('[data-text-id]')`
- [x] 2. Add `getPointToRectDistanceSquared(point, rect)` returning `0` when point is inside the rect, otherwise squared Euclidean distance to the nearest rect edge/corner
- [x] 3. Add `getPageElementForPoint(clientX, clientY)` that first uses `document.elementFromPoint(clientX, clientY)?.closest('[data-page-number]')` when inside `viewerRootRef.current`; if not found, iterate `pageRefs.current` and choose the page with smallest point-to-page-rect distance
- [x] 4. Add `getNearestTextElementForPoint(clientX, clientY)` that filters `textElementsRef.current` by the chosen page number, resolves each `[data-text-id]` span in `viewerRootRef.current`, computes distance to `getBoundingClientRect()`, and tie-breaks with `compareDocumentPosition` DOM order
- [x] 5. Treat empty pages/no text as `null` and preserve existing no-callback behavior

**Acceptance Criteria**:
- [x] Helper code compiles with `yarn typecheck`
- [x] Helpers return `null` when `viewerRootRef.current` is missing, when no page is resolvable, or when chosen page has no text spans
- [x] Equal-distance text candidates are resolved by DOM order

---

### Task 2: Normalize blank-space mouse drag selections in existing callback flow

- [x] 1. Add `activeMouseSelectionRef` storing `{ active: boolean; clientX: number; clientY: number }`
- [x] 2. Register `mousedown`, `mousemove`, and `mouseup` on `viewerRootRef.current` in addition to existing `mouseup/touchend/keyup` behavior
- [x] 3. On primary-button `mousedown` inside the viewer, set active true and record `clientX/clientY`
- [x] 4. On `mousemove`, update coordinates only when active and `event.buttons & 1` is true; if button no longer pressed, clear active
- [x] 5. On `mouseup`, update final coordinates, call existing `emitSelectionEnd` through the current listener path, then clear active after `emitSelectionEnd` has read the final coordinate
- [x] 6. Modify `getSelectionDetail(selection)` so it first preserves existing valid selections: if anchor and focus both have closest text elements and `selectedElements.length > 0`, return current behavior
- [x] 7. Only when `activeMouseSelectionRef.current.active` is true and focus/anchor is blank or selected elements indicate page-start fallback, compute nearest text with Task 1 helpers
- [x] 8. Determine start text from the closest text element around `selection.anchorNode`; determine end text from nearest text element to the last pointer coordinate
- [x] 9. Build normalized `texts` as all registered text spans between start and end in DOM order, inclusive, limited to the selected endpoint pages
- [x] 10. Return `ReaderTextSelectionDetail` with `text` equal to the first normalized text in DOM order, `texts` equal to normalized texts, `pageNumber` equal to that first text's page number, `selection` equal to the native selection object, and `selectedText` equal to `texts.map((item) => item.content ?? '').join('')` for normalized blank-space cases

**Acceptance Criteria**:
- [x] Existing valid span-to-span selection test still passes without using normalized `selectedText` construction
- [x] During active mouse selection, blank-space focus produces detail ending at nearest text to final mouse coordinate
- [x] Without active mouse selection, existing outside/collapsed/no-selection behavior is unchanged

---

### Task 3: Prepare reusable jsdom layout and selection test utilities

- [x] 1. Keep `makeMockSelection()` at `test/intermediate-document-viewer.test.tsx:577` compatible with existing tests
- [x] 2. Add a local helper to mock `HTMLElement.prototype.getBoundingClientRect` per element using a `WeakMap<HTMLElement, DOMRectLike>` or per-element `vi.spyOn(element, 'getBoundingClientRect')` cleanup
- [x] 3. Add helper data for four text spans on page 1: text-A at top/left, text-B as selection start, text-C middle, text-D near intended blank pointer
- [x] 4. Use rendered component text spans where possible instead of detached manual spans; if manual spans are needed, ensure they match production attributes (`data-text-id`, `data-page-number`, class)
- [x] 5. Restore all spies/mocks after each test using existing Vitest cleanup patterns

**Acceptance Criteria**:
- [x] Existing tests still pass after helper additions
- [x] Geometry mocks are local and restored; running `yarn test:run test/intermediate-document-viewer.test.tsx` twice produces the same result

---

### Task 4: Add regression tests and run verification commands

- [x] 1. Regression: render four text spans on page 1. Simulate primary-button `mousedown` on text-B with client coordinates inside text-B. Mock selection where native `containsNode` incorrectly includes page-first text-A through text-B (page-start fallback) while focus is the page/container blank area. Dispatch `mousemove` with coordinates in blank space nearest text-D, then `selectionchange`. Assert callback receives `detail.texts` from text-B through text-D and not text-A as a false page-start inclusion
- [x] 2. End callback: repeat the blank-space setup and dispatch `mouseup` at the blank coordinate. Assert `onTextSelectionEnd` receives the same normalized endpoint/range
- [x] 3. Preservation: existing direct text-B-to-text-C selection should still return native selected elements and selected text from `selection.toString()`
- [x] 4. Edge above/below: pointer blank space above first text chooses text-A; pointer blank space below last text chooses the last page text
- [x] 5. Tie-break: if two text boxes have equal distance to pointer, earlier DOM order wins
- [x] 6. Run required commands and save outputs to `.sisyphus/evidence/` files

**Acceptance Criteria**:
- [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0` *(5 tests failed due to `document.elementFromPoint` not available in jsdom)*
- [ ] `yarn test:run` exits `0`
- [ ] `yarn typecheck` exits `0`
- [ ] `yarn lint` exits `0`
- [ ] Regression fails on old behavior and passes after normalization: blank coordinate near text-D does not select page-start text-A

---

### Final Verification Wave

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high
- [x] F4. Scope Fidelity Check — deep
