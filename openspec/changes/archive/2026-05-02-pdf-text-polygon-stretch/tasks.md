# Tasks

## Plan: PDF Text Polygon Stretch

- [x] 1. Implement polygon-aware text geometry in renderer

  In `src/components/IntermediateDocumentViewer.tsx`, replace the current `polygon -> bbox` text layout branch with a polygon-aware geometry helper that uses `p0` as the anchor, `p0→p1` for width/angle, and `p1→p2` for height; preserve the existing fallback when `polygon` is missing, malformed, or degenerate.

  **Parallelization**: Wave 1 | Blocks: task 2 | Blocked By: none

  **Acceptance Criteria**:
  - [x] A `Text` with a valid 4-point polygon renders with `left/top` anchored at `p0`, `width` equal to `|p0→p1|`, `height` equal to `|p1→p2|`, and a rotation matching the `p0→p1` angle.
  - [x] A malformed or missing polygon still renders via the legacy fallback path.
  - [x] Existing non-polygon text rendering still passes unchanged style assertions.

  **Commit**: `fix(renderer): honor text polygon geometry` | Files: [`src/components/IntermediateDocumentViewer.tsx`]

- [x] 2. Expand polygon layout regression tests

  Extend `test/intermediate-document-viewer.test.tsx` with focused assertions for the polygon happy path, malformed polygon fallback, and a rotated sample so the renderer math is locked down.

  **Parallelization**: Wave 1 | Blocks: none | Blocked By: task 1

  **Acceptance Criteria**:
  - [x] A dedicated test covers a 4-point polygon whose `p0/p1/p2` produce deterministic width, height, and rotation expectations.
  - [x] A dedicated test covers malformed polygon input and confirms fallback behavior.
  - [x] Existing tests still pass in the same file without changing the harness.

  **Commit**: `test(renderer): cover polygon text geometry` | Files: [`test/intermediate-document-viewer.test.tsx`]

## Final Verification Wave

- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep
