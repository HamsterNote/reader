# Implementation evidence

## Task 1.1

The public `@hamster-note/reader/pdf-contracts` export is separate from the
existing DOM library entry. It defines host-owned local input, session identity,
metadata, physical page numbers, reader-local logical rectangles, temporary
selection, thumbnails, categorized states, and engine session operations.
Every asynchronous document result carries session identity. There are no
annotation/storage operations or EPUB engine locations in this contract.

Verified on Linux, Node 24.15.0, Yarn 1.22.22:

- `yarn build:lib`: passed; emits independent `dist/pdf-contracts.js` and types.
- `yarn tsc --project test/pdf-contracts-consumer/tsconfig.json`: passed with
  ES2022 only, no DOM library and no ambient third-party types. The consumer
  imports the built package subpath, not a relative source file.
- `yarn test:run test/pdf-contracts.test.ts test/reader-ssr.test.tsx`: 3 passed.
- `yarn typecheck`: passed.
- `yarn pack:check`: passed, 168 allowed files.
- `yarn test:run`: 53 files, 872 tests passed. Existing React `act` warnings
  were emitted; no tests failed.
- `yarn build:demo`: passed, with browser externalization warnings for OpenCV
  Node builtins and large-chunk warnings.

The neutral consumer bundle can be reproduced after the library build:

```sh
node --input-type=module -e 'import { build } from "esbuild"; import assert from "node:assert/strict"; const result = await build({ entryPoints: ["test/pdf-contracts-consumer/consumer.ts"], bundle: true, platform: "neutral", format: "esm", write: false, metafile: true }); assert.deepEqual(Object.keys(result.metafile.inputs).sort(), ["dist/pdf-contracts.js", "test/pdf-contracts-consumer/consumer.ts"].sort()); console.log("PDF contracts dependency boundary passed");'
```

This passed with exactly the consumer and the built PDF contracts as inputs;
ReactDOM, painting, the old Reader, and browser globals are absent. This proves
the contract's dependency boundary, not a Metro/device runtime or PDF rendering.

## Native routing finding, before implementation

`native-reader/src` below means `packages/native-reader/src` in that repository.
`NativeReader.native.tsx` currently checks the Foliate native capability before
loading its implementation. `nativeSource.ts` additionally requires an authorized
runtime before source property inspection, filesystem metadata, or reads.
`openspec/specs/foliate-reader-security/spec.md` requires zero source I/O before
the Foliate gate, including when the platform cannot prove its CSP boundary.

The new misleading-filename scenario requires recognizing PDF bytes even with
an EPUB name and no MIME. Hints alone cannot meet it when the Foliate gate is
unavailable. Reading an EPUB container header is itself source I/O, so it does
not preserve the existing zero-read rule either.

The existing detector recognizes `%PDF-` at byte zero. Matching that candidate
requires five bytes, not the proposed 4 KiB. Full validation still belongs to
PDFKit/PDF.js. Before native changes, the issue must record the trade-off:
validate local scheme and native metadata/32 MiB bound, read at most five prefix
bytes without copying/transferring/opening a renderer, then require the selected
PDF capability or the full existing Foliate gate. A non-PDF candidate must never
weaken the Foliate CSP, private bridge, authorization, or full-source transfer
requirements. Remote sources must cause no filesystem/network reads.

No native source/gate/spec code has been changed at this checkpoint. The design
and tasks still describe the original proposal until that issue notice precedes
the narrower implementation. Tasks other than 1.1 remain unchecked, and no
iOS/Android/Web rendering or menu behavior is claimed.

## Continuation checkpoint: routing and DOM runtime

The preceding section is historical. The five-byte trade-off was posted before
native implementation and explicitly accepted in the issue thread. Design and
spec deltas now specify scheme -> positive known integer size -> 32 MiB -> at
most five bytes, with a boolean-only result. Native source routing sends PDF
candidates to an independent, currently unsupported PDF host; non-PDF inputs
still enter the unchanged Foliate gate. No native PDF renderer is implemented.
The existing body of `foliate-reader-security` is byte-for-byte unchanged;
only an explicit dispatch scope was prepended. No CSP/private bridge/full-read
authorization implementation was weakened. Tasks 1.2-1.5 are complete at the
dispatch boundary, not platform rendering acceptance.

The reader source API now detects PDF independently of filename/MIME, preserves
the legacy document API and rejects conflicting/remote inputs before I/O.
Its lazy PDF renderer uses PDF.js 5.4.530, an independent worker, matching text
layers and canvas viewports, at most five page surfaces/two main renders, bounded
thumbnails and scoped contextmenu prevention. Worker errors/timeouts fail closed;
replacement/disposal cancels work and does not revoke host URLs or alter bytes.
The DOM Pages rail and temporary no-op selection Popover are present. Shared
RN/iframe interactions and remaining lifecycle cases are not marked complete.

The standalone adapter and 198 exact assets are shipped with SHA-256/MIME
manifest and an integrity-checking consumer sync command. Runtime resources
never require a CDN. The demo dev command builds these assets first, including
on a clean checkout. The main demo upload remains on its legacy parser path;
the new path is exercised by `test/browser/pdf.html`. Task 5.1 remains pending.

Validation performed during this continuation:

- Reader `yarn test:run`: 54 suites, 876 tests passed. Existing React act warnings
  remain. Routing tests cover input conflict, remote rejection, PDF/EPUB swaps,
  stale asynchronous results and intact host bytes; PDF rendering is mocked
  ONLY in these route unit tests, not in the browser tests below.
- Reader `yarn typecheck`, changed-code ESLint, `yarn build:all` and
  `yarn pack:check`: passed (381 allowed package files). Demo build retains
  OpenCV Node-builtin externalization and large-chunk warnings.
- DOM-free built contract consumer typecheck and neutral dependency bundle:
  passed; only the consumer and `dist/pdf-contracts.js` appear in its graph.
- `node scripts/verify-pdf-runtime.mjs`: passed after final library build.
  Packs/extracts the actual npm tarball, synchronizes its integrity-checked
  resources into an isolated consumer, serves only those assets and runs the
  standalone adapter in Chromium while blocking non-local requests. Verified
  displayed canvas pixels/text, page-2 thumbnail, out-of-range rejection,
  unchanged input bytes and repeated disposal. No external requests occurred.
- Playwright Chromium desktop 1280x850, touch viewport 390x844 and Firefox:
  9/9 passed, with actual worker/canvas/text layers. Synthetic fixtures include
  eight selectable physical pages, a rotated page, an image-only raster page,
  a JavaScript OpenAction network canary and corrupt input. Tests verify bounded
  surfaces, first/last page, responsive Pages, zoom/rotation text/canvas pixel
  overlap, desktop mouse dragging, scoped contextmenu cancellation, repeated
  no-op Popover clicks, corruption and source/host-URL cleanup. Mobile selection
  is programmatic DOM Range evidence, NOT long-press/handles evidence.
  Screenshots were visually inspected on desktop/mobile; page content is visible.
- WebKit could not launch: host libraries libevent/flite/avif/manette/woff and
  GStreamer support are missing. `sudo -n true` confirms no passwordless install
  access. This is a recorded browser gap, not Safari acceptance.
- Native JS source Jest: 25 suites, 356 tests passed. Includes native probe,
  route failure and existing Foliate authorization/security tests. Native
  library/demo typechecks and changed-code ESLint passed. Three changed native
  specifications and the reader change pass strict OpenSpec validation.

Environment investigation: Linux has no xcodebuild, Swift, Java, Android SDK,
ADB or emulator on PATH; no iOS/Android runtime is available. PDFKit public menu
suppression, real selection handles and Android WebView behavior cannot be
accepted here. No device evidence waiver is assumed. Ask 小助手 to arrange Linus
and an appropriate build/device environment as requested. No npm package was
published, native source dependency added, persistent server started or CI
completion awaited. Later cross-repo consumption must use an explicit exact
package/artifact, not `../reader/src`.

Tracked progress is 7/33: 1.1-1.5, 2.1 and 2.2. Remaining tasks, including
thumbnail replacement/failure acceptance, RN Pages/Popover, native platforms,
Expo Web iframe, demo migration and end-to-end device acceptance, stay open.
