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
