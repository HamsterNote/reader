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

## Web continuation: thumbnails and main demo

Task 2.3 is now verified: 32 cached thumbnails, two concurrent renders and 64
pending requests remain bounded. New lifecycle tests cover local thumbnail
failure, invalid page requests, disposal with active AND queued thumbnails,
late completion and repeated disposal. Fixed unresolved queued promises on
dispose; every retired thumbnail request now settles with null.

Task 5.1 is implemented in the actual main demo. Default upload dispatch reads
the five-byte signature independent of filename/MIME, sends original owned
bytes to Reader source, and does not enter the old PDF parser or annotation
history. Non-PDF retains the existing document parser path. Explicit
LegacyPdfDemo regression harness retains old parser/document lifecycle tests.
The demo clears its private input bytes on replacement/unmount.

Validation: 55 suites / 878 unit tests; typecheck; build:all; pack:check
(382 files); packed offline consumer; 12 Chromium desktop/mobile and Firefox
browser tests passed. Main-demo browser evidence covers misleading .epub name,
real canvas/text, ready, corrupt replacement/error and zero external requests.
Shared Popover geometry is now a pure contract helper; the exact npm artifact
also includes its generated neutral TypeScript source for RN artifact consumers.
WebKit and native device gaps described above remain open. Overall 9/33.

## RN chrome and Expo Web continuation

Tasks 2.4, 2.5, 5.2, 5.4 and 5.5 are implemented and verified for the two Web
surfaces. Overall progress is 14/33. RN Pages uses a virtualized FlatList with
stable thumbnail dimensions, explicit current/expanded accessibility states,
compact collapse on navigation and page-number fallback. React Popover geometry
uses the exact neutral helper from the reader artifact, including iframe/root
offsets. Repeated placeholder presses do not mutate annotations, storage or undo.
RN Web zoom commits on blur/submit: its TextInput does not implement
onEndEditing. PDF navigation/relayout uses viewport-local scrolling so the
embedded reader cannot scroll the outer app or hide its toolbar.

Native-reader Web dispatch probes only same-origin Blob URLs. Chromium and
Firefox reject HEAD on Blob URLs, while Range bytes=0-4 returns bounded 206
metadata. Dispatch verifies Content-Range, Content-Length and the 128 MiB Web
bound before consuming at most five bytes; it never falls back to full fetch.
The PDF shell must load with its exact URL/title/initial CSP and boot handshake
before full source access. Non-PDF still requires all Foliate gates. Native
scheme/known-size/32 MiB/five-byte rules are unchanged. Specifications explicitly
record both probe exceptions. Complete EPUB source/private-bridge/CSP gates are
not weakened; regression observers count the single candidate Range separately
while still requiring zero full reads/copies/Foliate opens on rejected gates.

The Web shell is independently packaged with strict protocol/version/schema,
window/origin/session/generation/command validation and bounded payloads. It
receives only private transferred bytes. Source replacement cancels fetch,
settles pending requests, removes listeners/frame and closes the worker; host
URLs/files stay owned by the caller. Tests include loading-time replacement,
late worker/message delivery, corrupt replacement, repeat open, missing-shell
zero full-read behavior, script canaries and out-of-range requests.

Native-reader vendors an actual reader npm archive with immutable source SHA,
package/PDF.js versions and archive SHA-256 in vendor/reader-pdf.json. Staging
checks the archive, every asset and neutral contract source; the final runtime
has 203 manifest entries (198 reader assets, four shell/protocol files and the
reader MIT license). No cross-repo source imports are required. The installed
consumer sync command requires only Node builtins and rejects hash mutation,
traversal, symlinked source/target ancestors and stale target files. Isolated
release stages PDF assets inside its owned copy; library validation does not
stage into source. The existing release-safety contract now explicitly rejects
PDF staging in validation chains as well as Foliate staging.

Validation recorded during this continuation:

- Reader: 878 unit tests, typecheck, build:all, pack:check (382 files), changed
  lint, DOM-free consumer types/bundle and exact packed offline adapter consumer.
- Native-reader: 384 library JS tests, 18 demo tests, library/demo typechecks,
  Bob module/commonjs/declaration build and public consumer typecheck. The formal
  package test entry also passes its seven static safety contracts, 90 Node
  safety cases (two Windows-only skips), secure staging and lifecycle checks.
- Three focused PDF consumer sync safety tests pass. Actual isolated native
  tarball consumer verifies 203 exact offline assets, private bytes, canvas
  pixels/text/thumbnail, page bounds, unchanged host bytes and worker teardown.
  Artifact filename/hash are emitted by isolated-release and passed verbatim
  to scripts/verify-pdf-consumer.mjs.
- Reader browser matrix: four cases per Chromium desktop/mobile, Firefox and
  Linux WebKit. Expo Web: five cases per same matrix. These use actual packaged
  workers/canvas/text. Desktop drag and contextmenu cancellation pass; mobile
  selection is DOM Range, not physical long-press/handles evidence.
- Existing Foliate exported-browser suite: 35 passed, 37 intentional skips;
  the two probe-accounting failures were corrected and rerun, both passed.
- The reader change and three changed native specifications pass strict
  OpenSpec validation. Existing act/watchman/build warnings are not device proof.

### Reproducible rootless WebKit

Adapted Linus's issue attachment environment scripts to existing scripts/:
run-pdf-webkit.sh and playwright.pdf-webkit.config.cjs. The native static export
uses a Node-only test server because this Noble image has no Python. Tests run
in rootless Podman with --network=none, cleared inherited localhost proxies and
only loopback test servers. No host system packages are installed.

Prerequisites: Node 24, installed checkout dependencies and existing Noble image
localhost/ham40-webkit:noble (Ubuntu 24.04.5), image ID
460dd4b4d955fca9667063af3d134a9ae9fdd7841c96fc36f3bb3588af5ca6c2.
This is a same-machine reproducible environment, not a fresh-machine installer.
PDF_WEBKIT_IMAGE may select an equivalently prepared Noble image. The browser
must be downloaded inside Noble; host Ubuntu 26.04 builds have incompatible ABI.
Reader uses Playwright 1.61.0/WebKit 2311; native-reader uses 1.63.0/WebKit 2359.
Installation disables browser GC to preserve other versions in a shared cache.
The default cache is checkout-local node_modules/.cache/playwright-noble;
PDF_WEBKIT_BROWSERS_PATH can reuse an existing Noble cache.

```sh
# From reader; first install needs network, test execution is network-isolated.
yarn test:pdf:webkit --install
yarn test:pdf:webkit
# From reader, targeting an independently installed native-reader checkout.
PDF_WEBKIT_REPO=../native-reader yarn test:pdf:webkit --install
PDF_WEBKIT_REPO=../native-reader yarn test:pdf:webkit
```

Final Web changes must rerun this entry as well as Chromium/Firefox. Screenshots
are under each checkout's test-results/pdf-webkit. Linux WebKit is NOT Safari
or iOS PDFKit evidence. Native platform code is still pending; no device waiver
has been accepted. Linus found a usable JDK/Android SDK, but no KVM or connected
device; software emulation booted then lost services/watchdog stability and
cannot support menu/handles acceptance. iOS still needs Xcode/runtime access.
Tasks 1.6, 3.*, 4.*, 5.3 and 6.* remain open. No npm publication, persistent
development server or CI-completion claim is made.

## iOS implementation draft (HAM-46 continuation)

Native-reader PR8 (`agent/ham-46-pdf-ios`, commit `732eff6`) is stacked on
PR7's `agent/ham-46-pdf-web` branch. PR6/7 bases are unchanged. The optional
independent `@hamster-note/pdfkit@0.1.0` Expo package has a podspec, Swift
module/view, TS wrapper, Expo autolinking metadata and a development-client demo
dependency. Its iOS 16.4 deployment target matches the installed Expo 57 SDK.
Missing/incompatible native registration stays unsupported without further I/O.

Implementation status by task (none is native acceptance):

- 3.1: package/build/autolinking and missing-capability JS checks pass; Swift
  build and real consumer native linking remain unverified.
- 3.2: native file grant, regular-file metadata and 32 MiB checks precede a
  bounded private snapshot; PDFKit validates complete content and encryption.
  `ready` is emitted only from PDFView's page drawing callback, not binding.
  Page navigation and JS protocol tests pass; actual native fixtures are pending.
- 3.3: native thumbnails are at most 112x150, cached at most 24; JS caps four
  thumbnail requests, bounds commands and settles outstanding work on disposal.
  Wrong-page/stale/delayed thumbnail JS tests pass; PDFPage output is unverified.
- 3.4: selection lines are clipped and converted PDFPage -> PDFView -> ExpoView;
  RN adds measured reader offsets. The RN integration test covers offsets and
  keyed source replacement. Zoom/scroll/rotation dismiss selection. Device
  coordinates and cross-page handle interaction remain unverified.
- 3.5: scoped public responder/menu filtering, legacy menu dismissal and
  UIEditMenuInteraction dismissal are implemented without removing gestures or
  handles. No claim that these suppress every OS menu until device evidence.
- 3.6: generation checks, read cancellation, native detachment, private in-memory
  cache cleanup and security-scope/descriptor release are implemented. Link/action
  annotations are removed only from the private PDFDocument; host files are never
  saved or deleted. Native replacement/background/resource behavior is pending.

Linux validation: 396 library tests plus one RN coordinate/replacement test,
workspace typechecks, changed-code ESLint, Bob, `pnpm bundle:ios` (Metro/Hermes
export only), public consumer types, release safety 7 static + 90 Node passes
with 2 Windows-only skips, and `pnpm test:pdfkit-package` (actual independent
tarball installed offline, Expo metadata resolves HamsterPdfKitModule from the
external consumer). The five Swift XCTest cases are checked in but NOT run.
No Xcode/Swift toolchain is available on this Linux runtime.

Actual isolated native-reader artifact: 674 files,
SHA256 `03bf3d63b9429d80857534931733859f9e2f07042a9c806cd597544a1f32d538`.
`verify-pdf-consumer.mjs` passes 203 offline runtime assets, private bytes,
canvas/text/thumbnail bounds, host ownership and worker teardown on that tarball.
Expo Web regression passes 15 Chromium/Firefox tests plus 5 WebKit tests.

The WebKit command exposed a Yarn executable shim issue: `command -v node`
can refer to a temporary shell wrapper, even after realpath. The script now
uses `node -p 'process.execPath'` before deriving the mounted Node installation.
The documented Yarn commands were rerun successfully for reader (4/4) and
native-reader (5/5), with the same network-isolated Noble container and cache.

Progress remains 14/33. Tasks 3.1-3.6 stay unchecked because their required native
build/host/device evidence is incomplete. Android implementation is next on a
separate platform branch. No device waiver, npm publish or CI wait occurred.

## Android static-host draft checkpoint

PR9 (`agent/ham-46-pdf-android`, commit `f2a65f9`) is based on PR7's Web/RN
branch, separately from iOS PR8. Product-owned HNPdfAssets/HNPdfView/manager
sources enter the existing secure-WebView staging/integrity chain (48 fixed
entries). The generated package registers a separate PDF view and Gradle stages
the manifest-exact PDF runtime into its own APK asset namespace. Existing EPUB
security gates are unchanged.

The HTTPS host rejects remote, encoded, traversal and unknown resources without
network fallback; each allowed APK resource is bounded and checked for exact
size, SHA256 and MIME, with CSP/nosniff headers. All three file access switches
and content access are disabled. No source property, document read API, private
port, public PDF capability or RN native binding exists at this checkpoint.
Native PDFs still fail unsupported. This is partial task 4.1; it stays unchecked.

Staging/integrity/mutation checks and three runtime-sync safety tests pass.
Release safety reports 7 static and 90 Node passes, with 2 Windows-only skips.
Web regression passes 15 Chromium/Firefox and 5 rootless Podman WebKit cases.
The isolated 656-file native-reader tarball has 205 runtime assets and SHA256
`4f8d4b346f8ecaeed7652cdaf30aa2f57f2b691de708d806e83d79641f3ada03`;
its actual offline consumer passes resource closure, canvas/text/thumbnail,
bounds, host-byte ownership and worker teardown checks.

Four new Robolectric resource-policy tests are NOT compiled or run. The official
isolated `test:android-fault-matrix:raw` command started with JDK 17.0.20.1 but
its clean Gradle 9.3.1 download progressed only about 2.6 MiB over several
minutes. The owned download process was cancelled before compilation; no shared
Gradle state was injected into the isolated gate. A reproducible distribution
bootstrap is needed. Android native build, rendering, menu suppression and
selection handles remain unverified. No KVM/usable emulator/device or iOS
Xcode evidence is available. Progress remains 14/33.

## Reader sync destination security fix

PR26 review reproduced target symlinks overwriting files outside the consumer's
public directory. The sync tool now checks every existing destination ancestor,
runtime directory, asset and manifest before any write, rejecting symlinks and
unexpected file types. It checks resolved parent containment and replaces files
via exclusively created temporary files and rename, rather than truncating
existing linked files. The output directory must remain exclusively controlled
during synchronization; portable Node path checks are not a sandbox against a
concurrent process renaming ancestor directories.

`yarn test:pdf:consumer` packs and extracts the actual artifact, rejects five
symlink cases (ancestor, runtime root, nested directory, asset and manifest),
checks outside sentinels remain unchanged, then verifies successful offline
rendering with all 198 exact runtime resources. Changed-script ESLint passes.
The rootless Podman WebKit suite was rerun successfully (4/4).
The default browser command still attempts host WebKit, which cannot launch
because host libraries are missing (12 Chromium/Firefox cases passed before
that failure). Run Chromium/Firefox with explicit `--project` flags and WebKit
through the documented Podman command; host WebKit is not acceptance evidence.
Hash checks occur at build/sync time. They are not browser per-request SRI:
the deployment must still serve the verified resource closure unchanged.

## Android private source and transport implementation

PR9 now contains the Android implementation at native-reader `47f54c9`, still
based on `agent/ham-46-pdf-web`, independently of iOS PR8. The earlier static-only
checkpoint above is historical. Its READER_LICENSE MIME mismatch is fixed:
the pinned manifest is the only production MIME authority, with a closed
allowlist. The Robolectric regression consumes all 205 actual generated runtime
entries and checks MIME, exact size and SHA256, including READER_LICENSE.

The integrity closure now has 54 entries. Canonical workspace and generated
Android packages both register HNPdfViewManager and stage the PDF assets.
HNPdfSource requires app-scoped canonical files or granted/same-UID content,
known positive size <=32 MiB, regular descriptors and consistent metadata.
HNPdfDocument creates a bounded private snapshot only after the selected host
has bound its private port and emitted a validated boot. The dispatch probe
remains boolean-only and does not authorize this read. Random exact document
URLs have no-store/nosniff headers and return complete 200 responses. Revocation
invalidates old URLs and zeroes bytes, including existing response streams.

The independent native host uses an exact top-level HTTPS page and a native
WebMessageChannel, without addJavascriptInterface or a public bridge. It
validates protocol/schema/session/generation/command IDs and bounded payloads,
matches requests, caps pending thumbnails, and reports ready after adapter draw.
RN Pages/Popover consume the shared model; selection coordinates use WebView
scale/density followed by measured RN offsets. Detach/background/source changes
retire the host, cancel reads and close the port. All three file access switches
remain false; existing EPUB code and CSP/private bridge gates are unchanged.
The ActionMode callback wrapper removes menu items using public APIs while
retaining native selection callbacks. This behavior is NOT device-validated.

Validation on the final native-reader commit:

- 396 library Jest tests, workspace typecheck, Bob build, public consumer types
  and changed-code ESLint pass. Metro Android export passes; this is JS bundle
  evidence only.
- Secure-WebView staging/integrity/mutation and release lifecycle checks pass;
  release safety reports 7 static + 90 Node passes and 2 Windows-only skips.
- Chromium desktop/mobile and Firefox pass 21/21; offline rootless Podman
  WebKit passes 7/7. The additional two tests execute the actual Android shared
  shell through MessageChannel with real PDF canvas/text/thumbnail/disposal and
  wrong-MIME rejection. They do NOT run native WebView or prove menu/handles.
- The actual 686-file isolated tarball passes the offline consumer against all
  205 assets, canvas/text/thumbnail, bounds, host ownership and worker teardown.
  SHA256: `70ef31ad25ac4045ffba6b1848792ca4af113b789632808d73990a0e632228c6`.
- The official isolated Android fault matrix passes on a fresh checkout of
  `47f54c9021441a2680337fbd1faa01999e9669fd`: production Kotlin/Java and all test
  classes compile, and `:harness:testDebugUnitTest` ends BUILD SUCCESSFUL.
  This includes the real manifest regression. The owned isolation root is
  cleaned and authority invariants pass. This harness compiles the oldarch seam;
  it is not a full New Architecture application or device rendering test.

The initial Linux bootstrap came from Linus's issue attachment
`01a14dfa-4f2e-70c1-a3c0-28dc4e78cb94`. Its maintained version is now checked into
native-reader at `packages/native-reader/scripts/android-fault-matrix/`, with
`bootstrap.py`, the production isolation adapter and a README. After configuring
an existing JDK17/Android SDK, run from the native-reader repository root:

```sh
python3 packages/native-reader/scripts/android-fault-matrix/bootstrap.py \
  --repo . --revision "$(git rev-parse HEAD)" --workdir ../android-verification
```

The workdir must be new and disjoint from the repository. Only committed files
at the explicit full Git SHA are tested. The bootstrap downloads the official
distribution by default; `--distribution /path/to/gradle-9.3.1-bin.zip` can reuse
an independently acquired ZIP, verified before and after private copying. The
README includes download/checksum/transfer instructions for another machine.
No issue attachment or machine-specific cache path is required. Network access
to dependency repositories is still required. The official Gradle9.3.1 ZIP is
137037885 bytes with SHA256
`b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06`.
The bootstrap verifies/copies only this distribution, uses fresh dependency
state and invokes the production isolation API without function injection.
Inherited proxy settings are written only into the disposable harness.
The test task forwards explicitly configured HTTP(S) proxy properties because
Robolectric downloads its Android runtime from the test JVM. The first attempt
without this forwarding compiled but stalled on that download; its exact owned
test worker was terminated and the wrapper collected the failure/cleanup.

Task 4.1 is complete, bringing progress to 15/33. Tasks 4.2-4.7 remain unchecked:
source/port/RN/menu/lifecycle code and unit/browser coverage are implemented,
but native-host rendering and fault/instrumentation evidence are incomplete.
No usable Android device/KVM or iOS Xcode/device evidence exists; no waiver has
been assumed. Native long-press/handles, iOS tasks, Web touch selection and
cross-platform acceptance remain open. No persistent server or CI wait ran.

The MIME negative control also ran through the production isolation API in a
separate disposable checkout. Only HNPdfAssets was restored byte-for-byte from
`f2a65f9` (Git blob `68080631a8281a850e7b363b042232d401049a7d`), its integrity
manifest regenerated, and the test task filtered to
`HNPdfAssetsTest.everyRealStagedManifestEntryIsServedWithItsAuthoritativeMimeAndBytes`.
Production and test compilation succeeded, then the real-manifest constructor
failed with IOException at test line84: `1 test completed, 1 failed`. The fixed
final commit passes the same test within the full fault matrix. No runtime
assets or assertions were modified for this comparison, and both runs used
fresh owned Gradle state with official distribution checksum enforcement.

The final tarball also passes the existing `verifyAndroidConsumer` API using
the configured JDK17/SDK36/NDK27.1.12297006. It installs the SHA256-verified
artifact in the independent versioned RN consumer and runs
`./gradlew :app:assembleDebug -PnewArchEnabled=true -PreactNativeArchitectures=x86_64`.
All 125 tasks execute successfully (BUILD SUCCESSFUL in1m11s), with generated
autolinking/C++ sources and the built APK identity checked by the existing
consumer verifier. This consumer uses the normal local Gradle cache; it is
separate from the clean-cache Robolectric evidence above. The APK is not run on
a device, and this does not establish runtime private-port/menu/handle behavior.

### Android lifecycle matrix and checked-in bootstrap

The checked-in bootstrap was executed against native-reader
`3a7b1640fbb4f9f2ca8052edf03c92253a50287c` using the official SHA256-verified
Gradle ZIP. It created a fresh source checkout, pnpm store and Gradle state,
compiled production Kotlin/Java and the complete test suite, and completed
`:harness:testDebugUnitTest` successfully in 3m12s. The matrix contains 89 test
methods, including 28 PDF methods. The production isolation API verified source
authority digests and removed its owned root; the isolation parent was empty.
Native-reader `5be2d826301a7364c978c166ea33e39c822b1acd` adds only README
descriptions after that verified code/test commit.

HNPdfViewTest constructs and mounts the real production WebView with all actual
APK runtime assets. It covers file-access settings, denied network/unknown and
document-main-frame requests, exact postMessage origin, boot-before-full-I/O,
wrong port/session/generation, duplicate boot, navigation revocation, stale
events, cleared configuration, background and repeated teardown. Fault injection
controls the public AndroidX transport API and source-open boundary; the I/O
executor runs deterministically. It does not execute a WebView engine.

These tests exposed an untransferred MessagePort leak: retirement previously
closed only the native endpoint while the endpoint awaiting JavaScript transfer
remained in an evaluation callback. The host now owns and closes both endpoints
until successful transfer, then closes only its native endpoint on retirement.
Failed evaluation, disposal before transfer and late callbacks are covered.
This is a WebMessageChannel, with no TCP listener, loopback bind or numeric port.

Document tests now cover exact 32 MiB input with <=64 KiB reads, cancellation
racing an active read, partial-buffer zeroing, and interrupted callers without
source reads or lost interrupt status. Source tests reject absent/noninteger/
oversized content metadata before descriptor open and exercise actual app-file
reads, host-byte preservation, cancellation and metadata mismatch. Robolectric's
ShadowLinux fstat(FileDescriptor) returns stat(null), so that metadata boundary
is explicitly controlled in the file test; kernel O_NOFOLLOW/fstat and real
content-provider behavior still require platform validation. Initial fixture
API/shadow failures were corrected before the successful full run.

The source/staged integrity closure now contains 55 entries. Staging/mutation
checks, changed-code ESLint and release safety pass (97 tests, 2 Windows-only
skips). Chromium desktop/mobile and Firefox pass 21/21; offline rootless Noble
WebKit passes 7/7. Native runtime/vendor pins are unchanged. Tasks 4.2-4.7 and
all device-dependent acceptance remain unchecked; total progress stays 15/33.

The final 687-file isolated tarball at `5be2d82` passes the actual offline
consumer against all 205 resources, private bytes, canvas/text/thumbnail, bounds,
host ownership and worker teardown. SHA256:
`22c5fad5e9d3fa433961cfcdd18272f45d388ade9a9864ef56fc46c9886b749d`.
The same artifact passes `verifyAndroidConsumer`: newArchEnabled=true, x86_64,
autolinking/Codegen/C++, APK identity checks and all 125 assembleDebug tasks
complete successfully in 1m24s. This uses the normal local Gradle cache, distinct
from the fresh-cache fault matrix, and does not execute the APK on a device.
