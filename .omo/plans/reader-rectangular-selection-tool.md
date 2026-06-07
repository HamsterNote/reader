# Reader Rectangular Selection Tool Display

## TL;DR
> **Summary**: Strengthen the existing Reader selection overlay so the demo uses an explicit default overlay, native selection paint is hidden only while the tool is enabled, active selections render as merged visual boxes during drag, handles snap to text boundaries, and blank document clicks cancel the current selection.
> **Deliverables**:
> - Explicit demo overlay config with chosen color `#2563eb` and current Reader prop forwarding preserved
> - Scoped native `::selection` suppression verified by tests
> - Multi-box line/page-segment overlay rendering using native `Selection`/`Range` as source of truth
> - Pointermove-driven live overlay refresh during active mouse selection
> - Blank-area cancellation that ignores text, overlay blocks, and handles
> - Start/end handle snapping regression coverage
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 -> Tasks 2/3/4/5 -> Task 6 -> Final Verification Wave

## Context

### Original Request
The user asked to optimize Reader's rectangular selection tool display. Confirmed requirements:
- Demo should enable the tool by default; implementer may choose the color.
- While the tool is enabled, the browser default selected-text background should be invisible.
- While the tool is enabled, default text selection boxes should be merged into a BoundingBox-like display.
- Selection start/end should have elements that can adjust start/end positions.
- Clicking any blank location in the document cancels selection.
- There may be multiple boxes.
- Boxes should be visible during selection, not only after `mouseUp`.

### Interview Summary
- Multiple boxes means one active text selection can render multiple merged visual boxes by visual row/page segment. It does not mean persistent multi-selection annotations.
- Start/end handles snap to the nearest text caret/text boundary and rebuild the native `Selection`/`Range`. They are not freeform rectangle endpoints.
- Automated tests should primarily use existing Vitest/jsdom infrastructure. Do not add Playwright dependency or CI job for this change.

### Metis Review (gaps addressed)
- Preserve existing public `Reader` APIs and callback signatures.
- Keep native `Selection`/`Range` as source of truth; overlay is visual output only.
- Do not modify parser/data model/page rendering unrelated to selection overlay.
- Scope native selection suppression only to enabled viewer instances.
- Do not implement persistent annotation state, color pickers, history, or toolbar features.
- Clean up event listeners and overlay DOM on unmount and tool disable.
- Add regression coverage for blank cancel, live drag refresh, multi visual boxes, handle snapping, and existing behavior preservation.

## Work Objectives

### Core Objective
Make the existing Reader selection overlay feel like a reliable rectangular selection tool while preserving the native text-selection model and current public API.

### Deliverables
- `demo/App.tsx` explicitly enables `selectionOverlay={{ color: '#2563eb', opacity: 0.28, enabled: true }}` for the main demo `Reader`.
- `src/components/IntermediateDocumentViewer.tsx` updates only the current selection overlay/event flow.
- `src/styles/reader.scss` keeps BEM naming and scoped native selection suppression.
- `test/intermediate-document-viewer.test.tsx`, `test/reader.test.tsx`, and `test/demo.test.tsx` cover the new contracts.
- `.omo/evidence/` command outputs/screenshots/logs are produced by executor during work.

### Definition of Done (verifiable conditions with commands)
- `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.
- `yarn test:run test/reader.test.tsx test/demo.test.tsx` exits `0`.
- `yarn test:run` exits `0`.
- `yarn typecheck` exits `0`.
- `yarn lint` exits `0`.
- `yarn build:all` exits `0`.
- `yarn pack:check` exits `0`.

### Must Have
- Overlay enabled in demo by default with explicit chosen color `#2563eb`.
- Native browser selection background invisible only under enabled custom-selection viewer class.
- One active selection may render multiple merged overlay boxes by visual row/page segment.
- Overlay updates during active drag before `mouseup`.
- Start/end handles snap to text caret/text boundary and keep native `Selection`/`Range` valid.
- Blank document clicks clear native selection and overlay DOM.
- Existing callbacks (`onTextSelectionChange`, `onTextSelectionEnd`) keep their signatures.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No persistent multi-selection annotation/highlight state.
- No freeform rectangle endpoint mode.
- No Playwright/Cypress dependency, config, or CI job.
- No parser, data model, PDF page renderer, OCR, or html-parser changes.
- No public API signature changes.
- No broad rewrite of `IntermediateDocumentViewer.tsx`; use small helper extraction only if it reduces local complexity.
- No global `::selection` suppression outside enabled Reader instances.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: Vitest/jsdom primary; no new E2E infrastructure.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`.
- Browser/manual QA in the final verification wave is performed by an agent against the demo, not by the user.

## Execution Strategy

### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = acceptable here because shared selection state in one component constrains safe parallelism.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 (demo/default config and scoped suppression contract)
Wave 2: Tasks 2, 3, 4, 5 (overlay geometry, live drag refresh, blank cancellation, handle snapping; all reference Task 1 contracts but may be worked independently with careful file coordination)
Wave 3: Task 6 (cleanup, disabled-state, integration regression, full commands)

### Dependency Matrix (full, all tasks)
- Task 1: blocks Tasks 2, 3, 4, 5, 6
- Task 2: blocked by Task 1; blocks Task 6
- Task 3: blocked by Task 1; blocks Task 6
- Task 4: blocked by Task 1; blocks Task 6
- Task 5: blocked by Task 1; blocks Task 6
- Task 6: blocked by Tasks 1-5

### Agent Dispatch Summary (wave -> task count -> categories)
- Wave 1 -> 1 task -> `quick`
- Wave 2 -> 4 tasks -> `visual-engineering`, `unspecified-high`, `quick`, `unspecified-high`
- Wave 3 -> 1 task -> `unspecified-high`

### Wave 2 File-Coordination Rule
- Tasks 2-5 are logically parallel but all may edit `src/components/IntermediateDocumentViewer.tsx` and `test/intermediate-document-viewer.test.tsx`.
- Before editing, each Wave 2 executor must claim its narrow insertion zones in its task notes: Task 2 = geometry/overlay rect helpers and geometry tests; Task 3 = overlay refresh helper and mouse tracking tests; Task 4 = blank-click handler and cancellation tests; Task 5 = handle drag/caret snapping and handle tests.
- If two tasks need the same insertion zone, serialize those two tasks in task-number order instead of forcing a concurrent merge.
- After each Wave 2 task, run `yarn test:run test/intermediate-document-viewer.test.tsx` before handing off to Task 6.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Make Demo Default Overlay Explicit And Lock Scoped Suppression

  **What to do**: In `demo/App.tsx`, change the main demo `<Reader>` at line 122 so `selectionOverlay` is an explicit object: `{ color: '#2563eb', opacity: 0.28, enabled: true }`. Keep the fallback/empty-state `<Reader>` at line 194 unchanged unless tests prove it also needs explicit overlay behavior. In `src/components/IntermediateDocumentViewer.tsx`, preserve the existing default overlay option normalization at lines 767-776 and ensure the custom-selection class is applied only when `overlayOptions?.enabled` is true. In `src/styles/reader.scss`, preserve scoped `::selection` transparency at lines 285-287 and do not add global selection CSS. Update `test/demo.test.tsx` to assert the demo passes explicit overlay options, and update `test/intermediate-document-viewer.test.tsx` or `test/reader.test.tsx` to assert enabled viewers receive the custom-selection class while disabled overlays do not.
  **Must NOT do**: Do not add a color picker, toolbar, public prop, or global stylesheet rule. Do not change `ReaderProps` or callback signatures.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Narrow demo/style/test contract with limited file surface.
  - Skills: [] - No specialized skill needed.
  - Omitted: [`playwright`] - Existing decision is Vitest/jsdom only; browser QA is final verification only.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 2, 3, 4, 5, 6 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `demo/App.tsx:122` - Main demo `Reader` already passes `selectionOverlay`; make it explicit with chosen color `#2563eb` and opacity `0.28`.
  - Pattern: `demo/App.tsx:194` - Empty-state/fallback `Reader`; leave unchanged unless tests require otherwise.
  - Pattern: `src/components/Reader.tsx:35` and `src/components/Reader.tsx:162` - Public prop and forwarding pattern for `selectionOverlay`.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:767` - Overlay option normalization and default color/opacity.
  - Pattern: `src/styles/reader.scss:285` - Scoped custom-selection `::selection` suppression.
  - Test: `test/demo.test.tsx` - Demo integration test patterns.
  - Test: `test/reader.test.tsx:374` and `test/intermediate-document-viewer.test.tsx:716` - Existing selection callback and mock selection patterns.
  - External: `package.json:28` - Scripts used for verification.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/demo.test.tsx` exits `0` and includes an assertion that the main demo passes explicit `selectionOverlay` options with color `#2563eb`.
  - [ ] `yarn test:run test/reader.test.tsx test/intermediate-document-viewer.test.tsx` exits `0` and proves custom-selection class is present only when overlay is enabled.
  - [ ] `src/styles/reader.scss` contains no global `::selection` rule outside the scoped Reader custom-selection selector.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Demo starts with explicit overlay config
    Tool: Bash
    Steps: Run `yarn test:run test/demo.test.tsx`.
    Expected: Test passes and asserts main demo Reader receives `selectionOverlay.color === '#2563eb'`, `opacity === 0.28`, and `enabled === true`.
    Evidence: .omo/evidence/task-1-demo-overlay.txt

  Scenario: Disabled overlay does not hide native selection
    Tool: Bash
    Steps: Run a Vitest case rendering `IntermediateDocumentViewer` or `Reader` with `selectionOverlay={{ enabled: false }}`.
    Expected: Viewer root does not include `hamster-reader__intermediate-document-viewer--custom-selection`; enabled case does include it.
    Evidence: .omo/evidence/task-1-disabled-suppression.txt
  ```

  **Commit**: NO | Message: `fix(demo): enable selection overlay explicitly` | Files: [`demo/App.tsx`, `src/components/IntermediateDocumentViewer.tsx`, `src/styles/reader.scss`, `test/demo.test.tsx`, `test/reader.test.tsx`, `test/intermediate-document-viewer.test.tsx`]

- [x] 2. Codify Multi-Box Bounding Overlay Geometry

  **What to do**: In `src/components/IntermediateDocumentViewer.tsx`, keep `getSelectionOverlayRects()` at line 246 as the source for converting native `Range.getClientRects()` to page-relative overlay rects. Update `mergeSelectionRects()` at line 204 only if needed so it merges fragments into visual-row/page-segment boxes without collapsing separate rows/pages into one global rectangle. Preserve current per-page grouping via `getPageElementForPoint()` and `overlayContainerRefs`. Add tests in `test/intermediate-document-viewer.test.tsx` that mock a `Range` with multiple rects on one line, multiple rows, and multiple pages: same-line fragments merge; different rows remain multiple boxes; different pages render in their own overlay containers.
  **Must NOT do**: Do not implement persistent multi-selection storage. Do not use one giant bounding rectangle for all selected text. Do not change native `selection.rangeCount` handling beyond the current browser-supported single active range unless tests already expose a bug.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Visual geometry and overlay rendering contract are central.
  - Skills: [] - Existing Vitest/jsdom and CSS patterns are sufficient.
  - Omitted: [`playwright`] - No new browser test infrastructure for this task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:204` - `mergeSelectionRects()` existing merge helper.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:246` - `getSelectionOverlayRects()` reads native range rects and groups by page.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1328` - Existing overlay clearing/update loop.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1345` - Overlay rect recomputation call site.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1700` - Per-page overlay container refs.
  - Style: `src/styles/reader.scss:246` and `src/styles/reader.scss:254` - Overlay container/block styles.
  - Test: `test/intermediate-document-viewer.test.tsx:716` - `makeMockSelection()` helper.
  - Test: `test/intermediate-document-viewer.test.tsx:756` - `mockElementRect()` pattern.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A Vitest case with two same-line rect fragments renders one merged overlay block.
  - [ ] A Vitest case with two visual rows renders two overlay blocks, not one global block.
  - [ ] A Vitest case with selected rects on two pages renders blocks in both page overlay containers using page-relative coordinates.
  - [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Multi-line selection keeps multiple visual boxes
    Tool: Bash
    Steps: Run `yarn test:run test/intermediate-document-viewer.test.tsx` with mocked `Range.getClientRects()` returning one same-line pair and one lower-row rect.
    Expected: Same-line pair merges into one overlay block; lower row remains a second block.
    Evidence: .omo/evidence/task-2-multi-line-boxes.txt

  Scenario: Cross-page selection stays page-local
    Tool: Bash
    Steps: Run a Vitest case with page 1 and page 2 rects and mocked page bounding boxes.
    Expected: Page 1 overlay container has only page 1 relative boxes; page 2 overlay container has only page 2 relative boxes.
    Evidence: .omo/evidence/task-2-cross-page-boxes.txt
  ```

  **Commit**: NO | Message: `fix(selection): merge overlay rects by visual segment` | Files: [`src/components/IntermediateDocumentViewer.tsx`, `test/intermediate-document-viewer.test.tsx`]

- [x] 3. Refresh Overlay During Active Mouse Drag

  **What to do**: In `src/components/IntermediateDocumentViewer.tsx`, ensure overlay DOM updates during active mouse selection before `mouseup`. Use existing `activeMouseSelectionRef` at line 737 and existing mouse tracking around lines 1382-1426. Add a small helper if needed, for example `refreshSelectionOverlay(selection?: Selection | null)`, that reuses the existing overlay clearing/recomputation code at lines 1328-1354. Call it from `mousemove` while `activeMouseSelectionRef.current.active` is true and `event.buttons & 1` is still pressed. Avoid excessive React state; direct DOM injection is the existing pattern. Add tests that dispatch `mousedown`, change mocked `Range.getClientRects()`, dispatch `mousemove`, and assert overlay blocks update before any `mouseup` event.
  **Must NOT do**: Do not wait until `mouseup` to update overlays. Do not introduce a selection polling interval. Do not duplicate overlay-rendering logic in multiple callbacks; centralize the DOM refresh path.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Event ordering and native selection interactions need careful reasoning.
  - Skills: [] - Existing test harness is enough.
  - Omitted: [`playwright`] - No dependency addition; final QA covers browser behavior.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:737` - Active mouse selection ref.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1307` - Selection change detail generation path.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1328` - Overlay clear/update loop.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1382` - Mouse down active selection setup.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1390` and `src/components/IntermediateDocumentViewer.tsx:1421` - Mouse move/up tracking.
  - Test: `test/intermediate-document-viewer.test.tsx:1161` and `test/intermediate-document-viewer.test.tsx:1228` - Existing mousemove blank-space selection tests.
  - Test: `test/intermediate-document-viewer.test.tsx:839` - `selectionchange` dispatch pattern.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Overlay blocks are updated during `mousemove` with active primary-button selection before `mouseup` is dispatched.
  - [ ] Releasing mouse or losing primary button clears active drag tracking without leaving stale overlay updates running.
  - [ ] Existing `selectionchange`, `mouseup`, `touchend`, and shift-key paths still pass.
  - [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Overlay appears during drag
    Tool: Bash
    Steps: Run a Vitest case that starts mouse selection, mocks `window.getSelection()` and changing range rects, dispatches `mousemove`, and does not dispatch `mouseup`.
    Expected: Overlay container contains the expected block before mouseup.
    Evidence: .omo/evidence/task-3-live-drag.txt

  Scenario: Mouse button loss stops live refresh
    Tool: Bash
    Steps: Dispatch `mousemove` with `buttons: 0` after an active selection start.
    Expected: `activeMouseSelectionRef` behavior stops further drag refresh and no exception occurs.
    Evidence: .omo/evidence/task-3-button-loss.txt
  ```

  **Commit**: NO | Message: `fix(selection): refresh overlay while dragging` | Files: [`src/components/IntermediateDocumentViewer.tsx`, `test/intermediate-document-viewer.test.tsx`]

- [x] 4. Cancel Active Selection On Blank Document Click

  **What to do**: In `src/components/IntermediateDocumentViewer.tsx`, add scoped blank-click cancellation inside the viewer/document area. The cancellation handler must treat a click as blank only when the target is inside `viewerRootRef.current` but outside `[data-text-id]`, `.hamster-reader__selection-overlay-block`, `.hamster-reader__selection-handle`, and any active handle-drag path. On blank click, call `window.getSelection()?.removeAllRanges()`, clear overlay DOM through the same centralized clear helper used by selection updates, reset active mouse/handle drag refs as needed, and avoid firing false selection-end data. Add tests for blank page margin click clearing selection/overlay, text click not clearing, overlay/handle click not clearing, and handle-drag mouseup not being mistaken for blank cancellation.
  **Must NOT do**: Do not attach global click handlers that affect selections outside the viewer. Do not clear selection when the user clicks selected text, overlay blocks, handles, or while a handle drag is active.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused event-filtering and regression tests.
  - Skills: [] - Existing jsdom tests cover click/mouse events.
  - Omitted: [`playwright`] - No new browser infrastructure.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:694` - Component receives selection props.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:737` - Active mouse selection ref to clear safely.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1328` - Overlay DOM clearing pattern.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1503` - Handle pointer-down path; blank cancel must not interfere.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1638` - Handle pointer handlers on rendered handle element.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1715` - Handle rendering guarded by overlay enabled and `selectionHandleElement`.
  - Style: `src/styles/reader.scss:262` - Handle class selector.
  - Test: `test/intermediate-document-viewer.test.tsx:716` - Mock selection helper.
  - Test: `test/intermediate-document-viewer.test.tsx:945` - Existing mouseup selection-end test.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Clicking a blank area inside the viewer clears `window.getSelection()` ranges and removes overlay blocks.
  - [ ] Clicking a text span does not clear selection as a blank click.
  - [ ] Clicking overlay block or handle does not clear selection as a blank click.
  - [ ] Handle drag release does not trigger blank cancellation.
  - [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Blank click cancels active selection
    Tool: Bash
    Steps: Run a Vitest case with an active mocked selection and overlay blocks, dispatch click on page margin inside viewer.
    Expected: `removeAllRanges()` is called once and overlay container has no blocks.
    Evidence: .omo/evidence/task-4-blank-cancel.txt

  Scenario: Interactive selection elements are not blank
    Tool: Bash
    Steps: Dispatch click on `[data-text-id]`, `.hamster-reader__selection-overlay-block`, and `.hamster-reader__selection-handle` in separate assertions.
    Expected: Native selection is not cleared by those clicks.
    Evidence: .omo/evidence/task-4-ignore-interactive.txt
  ```

  **Commit**: NO | Message: `fix(selection): clear overlay on blank document clicks` | Files: [`src/components/IntermediateDocumentViewer.tsx`, `test/intermediate-document-viewer.test.tsx`]

- [x] 5. Harden Start And End Handle Snapping

  **What to do**: In `src/components/IntermediateDocumentViewer.tsx`, verify and harden the existing handle flow: `handleHandlePointerDown()` at line 1503, `handleHandlePointerMove()` at line 1564, `handleHandlePointerUp()` at line 1591, `applyHandleDragSelection()` at line 1440, and `getCaretFromPoint()` at line 609. Ensure start handle fixes the end point and moves the start; end handle fixes the start point and moves the end; both use nearest caret/text boundary from `getCaretFromPoint()`. Ensure dragging over blank areas snaps to the nearest valid text caret and updates overlay immediately. Add tests with mocked caret APIs (`caretRangeFromPoint` or `caretPositionFromPoint` as needed) proving start and end handles rebuild the native range, update overlay, and do not trigger blank cancellation.
  **Must NOT do**: Do not implement freeform rectangle endpoints. Do not mutate unrelated selection callback payload shape. Do not make handles visible for collapsed/no-selection states.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Native Range reconstruction and event interactions are riskier than a simple UI tweak.
  - Skills: [] - Existing tests and DOM mocks are enough.
  - Omitted: [`refactor`] - No broad refactor requested; only small helper extraction if necessary.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:609` - `getCaretFromPoint()` resolves caret/range from pointer location.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1440` - `applyHandleDragSelection()` rebuilds the selection.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1503` - `handleHandlePointerDown()` begins drag and captures fixed point.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1564` - `handleHandlePointerMove()` updates during drag.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1591` - `handleHandlePointerUp()` finalizes drag.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1715` - Handles render only with enabled overlay and provided `selectionHandleElement`.
  - Type: `src/components/IntermediateDocumentViewer.tsx:86` - `selectionHandleElement?: React.ReactElement<ReaderSelectionHandleRenderProps>`.
  - Test: `test/intermediate-document-viewer.test.tsx:776` - DOM API mocking pattern for missing jsdom APIs.
  - Test: `test/intermediate-document-viewer.test.tsx:1457` - Existing nearest-text/tie-break selection tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Start-handle drag rebuilds a Range with new start and original end.
  - [ ] End-handle drag rebuilds a Range with original start and new end.
  - [ ] Handle drag over blank/page margin snaps to nearest text caret/boundary.
  - [ ] Overlay updates during handle drag before pointerup.
  - [ ] Collapsed or invalid selection does not render handles.
  - [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Start handle moves only selection start
    Tool: Bash
    Steps: Run a Vitest case rendering custom `selectionHandleElement`, mock caret resolution for pointer move, drag the start handle.
    Expected: Native selection receives a rebuilt range whose start is the new caret and whose end remains the previous fixed end.
    Evidence: .omo/evidence/task-5-start-handle.txt

  Scenario: End handle snaps over blank space
    Tool: Bash
    Steps: Drag end handle to a blank coordinate with nearest text mocked by existing geometry helpers.
    Expected: Selection range end snaps to nearest text boundary, overlay updates, and blank cancellation is not called.
    Evidence: .omo/evidence/task-5-end-handle-blank.txt
  ```

  **Commit**: NO | Message: `fix(selection): snap overlay handles to text boundaries` | Files: [`src/components/IntermediateDocumentViewer.tsx`, `test/intermediate-document-viewer.test.tsx`]

- [x] 6. Verify Cleanup, Disabled State, And Integration Commands

  **What to do**: After Tasks 1-5, add/adjust regression coverage for cleanup and integration. In `src/components/IntermediateDocumentViewer.tsx`, ensure overlays/listeners are cleared on unmount, when `selectionOverlay` becomes disabled, and when selection becomes collapsed/invalid. Confirm scroll/resize or page reflow does not leave stale overlay DOM if existing code already has hooks; if no existing hook exists, add the smallest listener/effect needed to clear or recompute overlay without changing public API. Run the focused tests and full repository commands from `package.json:28`. Store command output in `.omo/evidence/`.
  **Must NOT do**: Do not add new infrastructure, dependencies, or unrelated refactors. Do not mark final verification complete; F1-F4 still run after this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-task integration and full verification require careful coordination.
  - Skills: [] - Existing tooling is sufficient.
  - Omitted: [`git-master`] - Do not commit/push unless explicitly asked in execution context.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification Wave | Blocked By: Tasks 1, 2, 3, 4, 5

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1328` - Overlay clearing path.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1338` - Overlay update path.
  - Pattern: `src/components/IntermediateDocumentViewer.tsx:1715` - Handle rendering guard.
  - Pattern: `src/components/Reader.tsx:162` - Reader forwarding integration.
  - Test: `test/reader.test.tsx:374` and `test/reader.test.tsx:437` - Reader-level selection forwarding tests.
  - Test: `test/demo.test.tsx` - Demo integration tests.
  - Command: `package.json:37` - `yarn typecheck`.
  - Command: `package.json:38` - `yarn lint`.
  - Command: `package.json:40` - `yarn test:run`.
  - Command: `package.json:35` - `yarn build:all`.
  - Command: `package.json:43` - `yarn pack:check`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Disabled overlay clears custom-selection class, overlay blocks, and handles.
  - [ ] Unmount leaves no active event listener behavior that mutates detached overlay containers.
  - [ ] Collapsed/invalid selection clears boxes and handles.
  - [ ] `yarn test:run test/intermediate-document-viewer.test.tsx` exits `0`.
  - [ ] `yarn test:run test/reader.test.tsx test/demo.test.tsx` exits `0`.
  - [ ] `yarn test:run` exits `0`.
  - [ ] `yarn typecheck` exits `0`.
  - [ ] `yarn lint` exits `0`.
  - [ ] `yarn build:all` exits `0`.
  - [ ] `yarn pack:check` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Tool disabled clears visual selection UI
    Tool: Bash
    Steps: Run a Vitest case that renders enabled overlay with active blocks, rerenders with `selectionOverlay={{ enabled: false }}`.
    Expected: Custom-selection class, overlay blocks, and handles are absent after rerender.
    Evidence: .omo/evidence/task-6-disabled-cleanup.txt

  Scenario: Full repository verification
    Tool: Bash
    Steps: Run `yarn test:run`, `yarn typecheck`, `yarn lint`, `yarn build:all`, and `yarn pack:check`.
    Expected: Every command exits `0`.
    Evidence: .omo/evidence/task-6-full-verification.txt
  ```

  **Commit**: NO | Message: `test(selection): cover overlay cleanup and integration` | Files: [`src/components/IntermediateDocumentViewer.tsx`, `src/components/Reader.tsx`, `demo/App.tsx`, `test/intermediate-document-viewer.test.tsx`, `test/reader.test.tsx`, `test/demo.test.tsx`]

## Final Verification Wave (MANDATORY -- after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit -- oracle (APPROVE)
- [x] F2. Code Quality Review -- unspecified-high (APPROVE)
- [x] F3. Real Manual QA -- unspecified-high (APPROVED - blocked by browser automation limitations; Firefox WebDriver cannot create native text selections on PDF content. All 108 automated tests pass providing equivalent coverage. User accepted limitation.)
- [x] F4. Scope Fidelity Check -- deep (APPROVE after fixing ReaderInteractiveProps export)

## Commit Strategy
- Do not commit by default. User did not explicitly request a commit.
- If the user later asks to commit, use suggested message: `fix(selection): refine reader overlay interactions`.
- Do not commit unrelated dirty work.

## Success Criteria
- All Definition of Done commands pass.
- The demo visibly uses the custom overlay by default.
- Native text-selection paint is hidden only while custom overlay is enabled.
- Active selections render merged multi-box overlays during drag.
- Start/end handles adjust selection by snapping to text boundaries.
- Blank document clicks cancel the active selection without breaking text clicks or handle drags.
- No public API, parser, or page-rendering regressions are introduced.
