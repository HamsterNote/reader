# HAM-268 iOS native PDF: groups 1–3

This is the explicitly selectable development path. In a Debug iOS dev client,
open a PDF in the library and press **原生 PDF 验证**. **Web 对照** returns to
the existing renderer after the save barrier. Production defaults, PDF Text,
EPUB, Web and Android remain unchanged; groups 4–6 are not enabled.

## Implementation boundaries

- `src/nativePdf` defines an independent JSON channel, session/revision guards,
  canonical range materialization and shared interaction parameters.
- `app/modules/reader-pdf` is an Apple-only local Expo module. It draws read-only
  PDFKit pages inside cropped original-page slots, prewarms visible neighbours,
  and uses a maximum of two preview operations. Preview cache: 24 images/16 MiB;
  text textures: 5 images/16 MiB; temporary preview files: maximum 24, removed
  on close/deallocation. Active selection retains mappings, not page bitmaps.
- `webview/src/nativePdf.tsx` runs the existing PDF.js canonical text machinery
  without page canvas rendering, reuses HTML Popover/CommentPanel, and sends
  existing V5 envelopes to the existing host snapshot store. Native holds no
  business storage. An unconfirmed save blocks closing and can be retried.
- Text-layer geometry is measured in a real browser. The lens captures only the
  independent text layer, once per extraction, never a selection-composited page.
- Default/custom selection/highlight Popover options stay React values in the
  Web environment; platform-native objects never enter persisted records.
- Tool/painting/history/mode/progress integration and default routing remain
  groups 4–6. This harness is not a claim that the complete product migration
  or all S01–S14 acceptance cases have passed.

## Linux commands

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn typecheck:host
yarn vitest run test/native-pdf test/pdf-viewer test/compat test/host test/bridge
node scripts/check-native-pdf-geometry.mjs
yarn build
yarn host:check
(cd app && npx expo-modules-autolinking resolve --platform apple --json)
(cd app && npx expo-modules-autolinking resolve --platform android --json)
openspec validate add-ios-native-pdf-reading --strict
```

Fixture regeneration (deterministic, existing PDFs/blobs stay unchanged):

```sh
python3 scripts/generate-native-pdf-fixtures.py
yarn vite-node scripts/generate-native-pdf-baselines.ts
```

`test/fixtures/native-pdf/hashes.json` pins source PDFs/old annotation files.
`v5-host-baselines.json` contains matching migrated host snapshots. Scan and
200-page PDFs are synthetic, include no private documents, and require no
external fixture generator.

## Required Mac/device handoff (not executed on Linux)

Use a Mac with Xcode/iOS SDK, CocoaPods, Node 24 and Yarn 1.22.22. Record macOS,
Xcode, SDK, device model/iOS, commit and fixture hashes with every result.

```sh
yarn install --frozen-lockfile
yarn build:webview
yarn prepare:ios
cd app
npx expo prebuild --platform ios
npx expo run:ios --device
# Simulator build instead:
# npx expo run:ios
```

Use the Debug dev client and the **原生 PDF 验证** toggle. `yarn host:ios`
performs the bundled build + native patch + run sequence from the repo root.
A simulator build is required before any Swift task can be marked complete.
For an offline check, load the dev bundle first and then disable networking.
The existing Release command is `yarn host:ios:offline`; this development toggle
is deliberately unavailable in Release until the later routing gate.

| Case | Device | Steps/evidence still needed |
| --- | --- | --- |
| S01 (native subpath only) | Simulator + iPhone | Build, import positioned-runs.pdf, choose native toggle, wait for actual page pixels; capture renderer diagnostics distinguishing loaded/displayed/restored/ready; then disable network. Default routing/Text switching is deferred to groups 5–6. |
| S02 | Simulator + iPhone | First/last/hidden page navigation, 50/100/200% zoom (50% via pinch), real unvisited-page preview, failed-preview retry and outline/link fixtures. Verify allowed-page original numbers, preview aspect ratio, external-open callback. |
| S03 | Physical iPhone | Select [38,51) in positioned-runs, confirm exactly once, activate, drag across the other endpoint, recolor, comment and delete. Export V5 snapshot and compare IDs/createdAt/style/associations. No system menu/handles. |
| S04 (Layout only) | Physical iPhone | Drag from page 1 to page 12 in two-hundred-pages.pdf, hold at both viewport edges, release. Verify middle-page canonical text/rectangles, release stops scrolling and bitmaps are reclaimed. Mode round trip is deferred. |
| S05 | iPhone + iPad with mouse/Pencil | Execute every applicable shared `reader-text-selection-interaction` scenario for draft/existing endpoints. Record 20/40 handles, 38 radius, 76 distance, 2x text scale at all zooms, safe-area edges, no lens for mouse/pen, no overlay in lens, no new capture on selection-only changes. Include cancel, second finger, background, route/file replacement and frame-by-frame overlay alignment. |
| S06 (text highlights) | iPhone + Web reference | Import the matching v2/v3/v4 two-column blobs, test ligature/rotation/positioned source mappings, recolor and adjust, reopen in Web. Compare snapshots and old blob hashes. Full painting/history interoperability belongs to group 4. |
| S08 (renderer filter/crop only) | Simulator + iPhone | Inject the existing ReaderData hiddenPages/edgeCrop fixture before opening; hide 2..199, verify only original pages 1/200 remain with zero hidden slots; crop/rotate/zoom then check overlay coordinates. Editing modal/undo is deferred to group 4. |
| S11 (module subpath only) | Simulator + iPhone | Corrupt/permission/locked PDF, cancel pending text/preview by switching documents, missing module in Expo Go. No previous page/menu or cross-session write. Full app replacement barrier belongs to group 5. |

On a booted simulator, capture a frame with:

```sh
xcrun simctl io booted screenshot native-pdf-s05.png
xcrun simctl io booted recordVideo native-pdf-s05.mov
# Stop recording with Ctrl-C after the gesture matrix.
```

S07/S09/S10/S12/S13 and full S14 performance acceptance are later groups; they
must not be reported as passed by this batch. Native Swift compile, gesture,
rotation/crop alignment and texture fidelity currently have **no device pass**.

## Linux result (2026-11-14)

Environment: Linux x86_64/glibc 2.43, Node v24.15.0, Yarn 1.22.22.
No Swift compiler, Xcode or iOS SDK is installed.

- `yarn test:run --maxWorkers=2`: exit 0, **148 files / 1938 tests passed**.
- Focused suite including native/PDF/compat/host/bridge/Popover: exit 0,
  **37 files / 343 tests passed**.
- `yarn typecheck`, `yarn typecheck:host`, `yarn build`, `yarn host:check`:
  exit 0. Existing deprecation, missing optional CSS image and bundle-size
  warnings remain visible in the raw logs.
- New/changed implementation ESLint check: exit 0.
- Browser geometry: five fixture pages passed, each has all canonical UTF-16
  boundaries, real nonblank text texture where text exists, and **0 PDF.js page
  render calls**. The scan has no text/ink. This is Chromium, not PDFKit evidence.
- Autolinking: Apple `reader-pdf` count 1 (`ReaderPdfModule`), Android count 0.
- Strict OpenSpec validation and `git diff --check`: exit 0.

The first unrestricted full-suite run had a 5 s timeout in the existing
`ios-scene-config.test.ts` while other jobs were running (1935 passed, 1 timeout).
Its isolated rerun passed all 3 tests; the final two-worker full run passed every
test. Raw first-failure and final logs are both retained in the issue attachment.

OpenSpec completion: 1.1/1.2/1.3/3.1 checked (4/33 overall). Tasks that combine
implementation with actual Mac/device evidence remain unchecked; source code
presence and Linux checks are not substituted for those requirements.
