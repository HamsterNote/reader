# Design: PDF Reader Optimization

## Context

### Project: @hamster-note/reader
A React reader component package for Hamster Note. The package exposes a `Reader` component that renders intermediate PDF documents.

### Current State
- Package version: v0.1.0
- Supports `IntermediateDocumentViewer` with lazy page loading via IntersectionObserver
- Demo can parse PDFs using `@hamster-note/pdf-parser`
- Text rendering uses polygon-based positioning

### Technical Stack
- TypeScript + Vite + SCSS + React
- Vitest + React Testing Library + jsdom
- Yarn 1.22.22

## Goals / Non-Goals

### Goals
- Add PDF page base-image rendering behind selectable text
- Implement opt-in lazy OCR for visible base images only
- Expose `onTextSelectionChange` and `onTextSelectionEnd` events
- Cache OCR results per active document/page/image key
- Handle OCR failures gracefully without UI errors

### Non-Goals
- No backend OCR service or worker architecture
- No settings UI for OCR configuration
- No replacement of parsed text with OCR text
- No mutation of source `IntermediateDocument` instances

## Decisions

### 1. OCR Visibility: Visible Pages Only
**Decision**: OCR triggers only for pages where `entry.isIntersecting === true`, not for overscanned pages.

**Rationale**: Original request specified "只识别出现在屏幕中的" (only recognize pages that appear on screen).

**Alternatives Considered**:
- Overscan-based triggering: Rejected because request was explicit about visible pages only
- Pre-loading next N pages: Not in scope for this iteration

### 2. OCR Result Handling: Append/Dedupe
**Decision**: OCR text is appended after parsed texts, with ID prefix `ocr-${pageNumber}-${originalId}` to avoid collisions.

**Rationale**: Preserve existing parsed text while adding OCR content. Deduplication prevents duplicate text rendering.

**Alternatives Considered**:
- Replace parsed text: Rejected - must preserve original parsing
- Merge into single text array: More complex, collision handling unclear

### 3. Selection Event Semantics
**Decision**: `onTextSelectionChange` fires on `selectionchange` with first selected `IntermediateText` as first arg; `onTextSelectionEnd` fires on mouseup/touchend/keyup.

**Rationale**: Supports both continuous selection tracking and finalized selection handling.

**Alternatives Considered**:
- Single callback only: Insufficient for different use cases
- Focus/blur events: Not reliable for selection state

### 4. OCR Failure Handling
**Decision**: Call optional `onOcrError` if provided; otherwise `console.warn` in non-test environments; keep parsed text/base image rendered.

**Rationale**: Fail silently to user while providing debug info. OCR is opt-in so failure shouldn't block reading.

**Alternatives Considered**:
- Show error UI: Too disruptive for optional feature
- Retry logic: Too complex, deferred failures create UX issues

### 5. Dynamic Import for image-parser
**Decision**: Use `import('@hamster-note/image-parser')` only when OCR is enabled and page is visible.

**Rationale**: Keep OCR as opt-in, avoid bundling parser for disabled feature.

**Alternatives Considered**:
- Static import: Increases bundle size for all users
- Lazy-loaded module: Already achieved via dynamic import

## Risks / Trade-offs

### Risks
1. **Stale OCR Results**: Async OCR may complete after document change. Guard using `activeDocumentRef.current !== runtimeDocument` before state updates.
2. **Duplicate OCR Calls**: Multiple visibility triggers for same page. Guard using `loadingPagesRef` Set and OCR result cache.
3. **Memory Usage**: OCR cache grows with document size. Cache is per-document-session, cleared on document change.

### Trade-offs
1. **Bundle Size vs Features**: Dynamic import adds runtime overhead but keeps initial bundle small.
2. **OCR Quality vs Performance**: Lazy loading means OCR runs on-demand but may cause slight delay on page visibility.
3. **Selection Complexity vs Usability**: Full `IntermediateText` instances returned enable rich features but increase callback payload size.

## Architecture

### Component Hierarchy
```
Reader
  └── IntermediateDocumentViewer
        ├── Page shells (positioned containers)
        │     ├── Base image layer (img)
        │     └── Text layer (absolute positioned spans)
        └── OCR integration (lazy, per-page)
```

### Key State
- `visiblePages: Set<number>` - Pages currently intersecting viewport
- `loadablePages: Set<number>` - Pages to load (visible + overscan)
- `ocrLoadingPages: Set<number>` - Pages currently OCR processing
- `ocrCache: Map<string, IntermediateText[]>` - OCR results by doc+page+imageKey

### Selection Flow
1. User starts selection in viewer
2. `selectionchange` listener detects change
3. `getSelectionDetail()` computes selected texts in DOM order
4. First selected `IntermediateText` passed as first callback arg
5. `onTextSelectionChange` fires with full detail payload

## Migration Plan

N/A - New feature, no migration required from previous state.

## Testing Strategy

- Vitest + React Testing Library + jsdom
- Mock `@hamster-note/image-parser` to avoid real OCR
- Mock IntersectionObserver for visibility control
- Coverage: base image rendering, selectable text, selection events, OCR laziness, OCR caching, OCR failure handling, stale OCR protection
