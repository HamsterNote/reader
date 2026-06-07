# Final Verification Wave F3 — Manual QA Report

Final verdict: **REJECT**

## Environment

- Date: 2026-06-06
- App: `@hamster-note/reader` demo
- Demo entry: `demo/App.tsx`
- Dev command: `npm run dev -- --host 127.0.0.1`
- Actual dev URL from `.omo/evidence/final-f3-manual-qa/server.log`: `http://127.0.0.1:5578/`
- Browser: Playwright Chromium, cached executable `/home/zhangxiao/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`
- Evidence directory: `.omo/evidence/final-f3-manual-qa/`

## Automated Baseline

- Command run: `npx vitest run test/*.test.tsx 2>&1 | tee .omo/evidence/final-f3-manual-qa/vitest.log | tail -5`
- Result: **PASS** — `113 passed (113)`, `5 passed (5)` test files.
- Evidence: `vitest.log`

## Manual Browser QA Steps

1. Loaded the Vite demo page.
   - Result: **PASS**
   - Evidence: `01-demo-loaded.png`

2. Uploaded `manual-selection-sample.pdf` and waited for `Parsed Document`.
   - Result: **PASS**
   - The sample document rendered visible selectable text such as `Alpha selection line one spans across the page for manual QA.`
   - Evidence: `02-loaded-document.png`

3. Attempted real browser multi-line mouse text selection over the rendered document text.
   - Result: **FAIL**
   - Playwright found 6 selectable text rects, but the real mouse drag left `window.getSelection().toString()` empty.
   - No `.hamster-reader__selection-overlay-path` was rendered.
   - No `.hamster-reader__selection-overlay-svg` was rendered.
   - No legacy `.hamster-reader__selection-overlay-block` div blocks were rendered either.
   - Evidence: `03-selection-polygon-overlay.png`, `playwright-results.json`

4. Checked whether the overlay merged intersecting rectangles into a single polygon.
   - Result: **FAIL**
   - No SVG path existed, so there was no polygon to visually or structurally validate.
   - Evidence: `03-selection-polygon-overlay.png`, `playwright-results.json`

5. Checked default Android teardrop handles after selection end.
   - Result: **FAIL**
   - Handle count was `0`; expected start and end handles.
   - Evidence: `04-end-handle-missing.png`, `playwright-results.json`

6. Dragged the end handle to extend selection.
   - Result: **FAIL**
   - Could not execute the happy path because the end handle was not present.
   - Evidence: `04-end-handle-missing.png`, `playwright-results.json`

7. Repeated handle-drag path with `pointerType='touch'` simulation.
   - Result: **FAIL**
   - Touch pointer simulation could not dispatch against a missing end handle.
   - Evidence: `05-touch-pointer-handle-drag.png`, `playwright-results.json`

8. Clicked outside the selection area.
   - Result: **PASS**
   - Selection text length stayed `0`, overlay path count `0`, handle count `0`.
   - Evidence: `06-outside-click-clears-selection.png`, `playwright-results.json`

9. Dragged in blank page-margin area.
   - Result: **PASS**
   - No residual selected text, overlay, or handles remained.
   - No console errors or page errors were recorded.
   - Evidence: `07-blank-margin-drag.png`, `playwright-results.json`

10. Tried to toggle `selectionOverlay` off in the demo.
    - Result: **FAIL**
    - The rendered demo exposed no selection/overlay toggle candidates.
    - `demo/App.tsx` currently passes `selectionOverlay={{ color: '#2563eb', opacity: 0.28, enabled: true }}` directly, so the requested off-toggle path is not available for manual QA.
    - Evidence: `08-selection-overlay-toggle-check.png`, `playwright-results.json`

## Console / Runtime Errors

- Result: **PASS**
- Console errors: `[]`
- Page errors: `[]`
- Evidence: `playwright-results.json`

## Blocking Issues

1. **Happy path is not functioning in the real browser QA run.** Real mouse drag over visible rendered text did not leave a selected range, so the SVG polygon overlay and Android-style handles never appeared.
2. **Handle-drag behavior cannot be validated because handles are missing.** Both mouse and touch pointer handle-drag paths are blocked by the failed selection/overlay step.
3. **The demo does not expose a `selectionOverlay` off toggle.** The required native-selection fallback check cannot be completed from the demo UI.

## Artifacts

- `01-demo-loaded.png`
- `02-loaded-document.png`
- `03-selection-polygon-overlay.png`
- `04-end-handle-missing.png`
- `05-touch-pointer-handle-drag.png`
- `06-outside-click-clears-selection.png`
- `07-blank-margin-drag.png`
- `08-selection-overlay-toggle-check.png`
- `playwright-results.json`
- `server.log`
- `vitest.log`

Because multiple required happy-path checks failed in a real browser, this F3 verification wave is **REJECT**.
