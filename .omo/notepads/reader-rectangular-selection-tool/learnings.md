# Learnings

## Wave 1: Explicit Demo Overlay + Scoped Suppression Lock

- **demo/App.tsx**: Changed bare `selectionOverlay` prop to explicit object `{ color: '#2563eb', opacity: 0.28, enabled: true }` on the main document Reader. The fallback/empty-state Reader at line 194 does NOT have selectionOverlay (correct - no document means no overlay).
- **IntermediateDocumentViewer.tsx:767-776**: Overlay option normalization is already correct - handles `true`, object, and falsy inputs. Default values: color `#3b82f6`, opacity `0.3`, enabled `true`.
- **IntermediateDocumentViewer.tsx:1293**: Custom-selection class `hamster-reader__intermediate-document-viewer--custom-selection` is conditionally applied only when `overlayOptions?.enabled` is truthy. Correct.
- **reader.scss:285-290**: Scoped `::selection` suppression under `.hamster-reader__intermediate-document-viewer--custom-selection` class only. No global selection CSS. Correct.
- **Demo mock pitfall**: Demo has TWO `<Reader>` components (document-bearing at ~line 122, fallback at ~line 194). Mock must filter by `props.document` to capture selectionOverlay from the correct Reader instance.
- **Test pattern**: For overlay class tests, use 5 cases: `true`, explicit object `{ enabled: true }`, omitted, `false`, and `{ enabled: false }`.

## Wave 2: Handle Snapping Range Rebuild

- **IntermediateDocumentViewer.tsx**: Handle drag now keeps the fixed endpoint as the original Range node/offset, then rebuilds a fresh native Range from the moving caret plus that fixed point.
- **IntermediateDocumentViewer.tsx**: `getCaretFromPoint()` accepts native caret APIs only when the caret is actually inside viewer text; blank/page-margin hits now fall back to the nearest text boundary instead of cancelling.
- **IntermediateDocumentViewer.tsx**: Handle pointermove now refreshes the selection overlay immediately after `selection.addRange(newRange)`, so the overlay tracks drag motion before pointerup.
- **test/intermediate-document-viewer.test.tsx**: Mocked caret API coverage should include one native caret path and one blank-space fallback path, plus a collapsed-selection case that confirms no custom handle UI is rendered.

## Wave 2: Live Mouse Drag Overlay Refresh

- **IntermediateDocumentViewer.tsx**: Overlay DOM rendering is centralized in `refreshSelectionOverlay(selection?: Selection | null)`. `selectionchange`, document `mouseup`, and active primary-button `mousemove` all reuse this helper, preserving direct DOM injection instead of React state.
- **Drag refresh behavior**: `handleMouseMove` now refreshes overlay blocks only while `activeMouseSelectionRef.current.active` is true and `event.buttons & 1` remains set. A `mousemove` with no primary button marks active tracking false and later mousemoves do not refresh until a new mousedown.
- **Test pattern**: Live overlay tests can mock `window.getSelection()` with `getRangeAt(0).getClientRects()`, then mutate the returned rect array between `mousemove` events. Mock page `getBoundingClientRect()` so viewport rects convert to page-relative overlay block styles deterministically.

## Wave 3: Blank Click Cancellation

- **IntermediateDocumentViewer.tsx**: Added `clearOverlay` useCallback (clears `overlayRectsRef` + iterates `overlayContainerRefs` to empty innerHTML) and `handleBlankClick` React.MouseEvent handler wired via `onClick` on the viewer root div.
- **Blank click exclusion zones**: `[data-text-id]` (text spans), `.hamster-reader__selection-overlay-block` (overlay blocks), `.hamster-reader__selection-handle` (handle elements), `[data-handle-type]` (handle elements with type attribute). Also guards against `dragStateRef.current.active` for edge-case handle-drag releases.
- **Blank click actions**: Calls `window.getSelection()?.removeAllRanges()`, then `clearOverlay()`, then resets `activeMouseSelectionRef` and `dragStateRef` to inactive defaults. Does NOT call `emitSelectionEnd()` — avoids false selection-end data.
- **Event flow**: Click fires after mousedown → mouseup sequence. The browser collapses selection on mousedown for blank areas, so `emitSelectionEnd` (on mouseup) sees collapsed/null selection and skips emission. The click handler then performs the actual cleanup.
- **Test pattern**: For blank click tests, mock `window.getSelection()` with a `removeAllRanges` spy. Seed overlay blocks into the overlay container (`.hamster-reader__selection-overlay`), then dispatch `.click()` on the page div (blank) or specific child elements. Use `globalThis.document.createElement` to avoid shadowing the mock document from `makeDocument()`.
- **Handle drag test pitfall**: Dispatching `pointerdown` on a handle element triggers `handleHandlePointerDown` which calls `globalThis.document.createRange()` then `getBoundingClientRect()` — jsdom may not fully support this. For testing handle exclusion, a direct `.click()` on the `[data-handle-type]` element suffices without the full pointer cycle.

## Wave 4: Overlay Cleanup + Reflow Regression Coverage

- **IntermediateDocumentViewer.tsx**: Overlay ref teardown now clears the old overlay container before deleting it from `overlayContainerRefs`, so disabling `selectionOverlay` or unmounting does not leave stale block DOM in detached containers.
- **IntermediateDocumentViewer.tsx**: Added a minimal overlay-only resize/scroll effect that reuses `refreshSelectionOverlay()` for page reflow paths. It registers only when `overlayOptions?.enabled` is true and removes both listeners on cleanup.
- **Collapsed/invalid cleanup**: `refreshSelectionOverlay()` already clears blocks for collapsed selections and zero-sized/invalid rect output. Regression tests now seed valid blocks first, then switch to collapsed and zero-width rect selections to verify the DOM is emptied.
- **Unmount cleanup test pattern**: Keep a reference to the old `.hamster-reader__selection-overlay`, call `unmount()`, assert it is emptied, then append a sentinel and dispatch `selectionchange`, `mouseup`, `resize`, `scroll`, and detached-root `mousemove`. `window.getSelection()` should not be called and the sentinel should remain untouched.
