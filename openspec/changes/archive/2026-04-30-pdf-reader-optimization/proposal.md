# Proposal: PDF Reader Optimization

## Why

The original request was to enhance the PDF reader with the following capabilities:
- Add base image rendering for PDF pages
- Make parsed/OCR text selectable (remove pointer-events blocking)
- Add opt-in OCR using `@hamster-note/image-parser` with lazy loading (only for visible pages)
- Add text selection events: `onTextSelectionChange` and `onTextSelectionEnd`
- Demo should log selection event payloads

## What Changes

### Main Deliverables
1. **Base Image Layer**: Render PDF page base images behind the text layer when thumbnail/image data exists
2. **Selectable Text**: Remove `pointer-events: none` from text spans so browser selection works
3. **Lazy OCR**: Opt-in OCR config using dynamic `@hamster-note/image-parser` import, per-document/page caching
4. **Selection Events**: Public callbacks `onTextSelectionChange` and `onTextSelectionEnd` returning `IntermediateText` instances
5. **Demo Logging**: Console logging for both selection callbacks

### Additional Context from Related Plans

#### intermediate-document-lazy-display
- Install `@hamster-note/pdf-parser` for PDF parsing
- Add `IntermediateDocumentViewer` component with lazy text-layer rendering
- Pre-reserve page DOM dimensions for scrollbar accuracy
- Use IntersectionObserver for visible-page-only text loading

#### file-upload-demo-pdf
- Demo-only PDF upload flow
- Local file selection with browser File API
- Parser adapter to convert PDF to Reader-compatible format

## Capabilities

### Must Have
- Do NOT OCR all pages on document load
- Do NOT OCR overscanned-but-not-visible pages
- Do NOT replace parsed PDF text with OCR text; append/dedupe only
- Do NOT mutate the source `IntermediateDocument` object
- Do NOT set `pointer-events: none` on text
- Dynamic import `@hamster-note/image-parser` only in opt-in OCR path
- Selection callbacks only fire for selections inside viewer root

### Must NOT Have (Scope Boundaries)
- No backend OCR service, worker architecture, settings UI
- No export format changes, parser package rewrite
- No Playwright setup unless explicitly requested
- No broad global selection events outside the reader
- No silent test weakening or skipped tests
- No hardcoded OCR text fixtures in production code

## Impact

### Files Modified
- `src/components/IntermediateDocumentViewer.tsx` - Base image rendering, selection events, OCR
- `src/components/Reader.tsx` - Prop wiring for OCR and selection callbacks
- `src/styles/reader.scss` - Text selection styles
- `demo/App.tsx` - Demo console logging
- `package.json` - Added `@hamster-note/image-parser` dependency
- Test files for coverage

### Verification
- `yarn typecheck` passes
- `yarn lint` passes
- `yarn test:run` passes
- `yarn build:lib` passes
- `yarn build:demo` passes
