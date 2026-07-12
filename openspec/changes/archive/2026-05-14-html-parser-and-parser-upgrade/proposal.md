# Proposal: HTML Parser Integration & Parser Dependency Upgrade

## Why

The Reader component needed to support rendering intermediate documents through `@hamster-note/html-parser` as its standard display path while preserving the existing public API contract. This was driven by the need to leverage the html-parser's decode capabilities for better intermediate-document rendering without requiring consumers to change their integration patterns.

Additionally, parser dependencies (`@hamster-note/html-parser` and `@hamster-note/pdf-parser`) required an explicit upgrade from `^0.5.1` to `^0.6.0` because 0.x semver does not auto-bump minor versions with caret ranges.

### Key Problems Addressed
- HTML parser integration needed to become the standard rendering path for intermediate documents
- Parser dependency versions were locked at 0.5.1 and needed manual bumping to 0.6.0
- TypeScript type compatibility between local shims and upstream packages needed verification
- OCR and text-selection behavior needed careful handling during the renderer transition

## What Changes

### Plan 1: Integrate html-parser into Reader Rendering
- Internal html-parser-backed render path for `Reader` / `IntermediateDocumentViewer`
- Dependency and test wiring for `@hamster-note/html-parser`
- Deterministic fallback to the existing direct renderer when html-parser fails
- Updated demo and README showing standard package usage
- Validation across lint, typecheck, test, build, and pack checks

### Plan 2: Upgrade Hamster Parser Dependencies to 0.6.0
- Explicit dependency bump from `^0.5.1` to `^0.6.0` for both parser packages
- Lockfile refresh to resolve both packages to 0.6.0
- Local pdf-parser type shim aligned to upstream 0.6.0 export surface
- Focused parser regression coverage without parser refactors

## Capabilities

- Reader renders intermediate documents through `@hamster-note/html-parser` by default
- Existing `ReaderProps['document']` contract preserved (accepts only `IntermediateDocument | IntermediateDocumentSerialized | null`)
- Serialized input normalized through `IntermediateDocument.parse(...)` before rendering
- Internal fallback to direct renderer when html-parser decode/render fails
- Both parser packages resolve to `0.6.0` from workspace lockfile
- Reader code compiles without widening parser typings or adding compatibility wrappers
- Existing parser integration behavior verified under targeted Vitest coverage

## Impact

- **Components**: `Reader`, `IntermediateDocumentViewer`
- **Dependencies**: `@hamster-note/html-parser`, `@hamster-note/pdf-parser`
- **Tests**: `test/reader.test.tsx`, `test/intermediate-document-viewer.test.tsx`, `test/demo.test.tsx`
- **Types**: `src/types/pdf-parser.d.ts`
- **Documentation**: `README.md`, `demo/App.tsx`
- **Build**: `package.json`, `yarn.lock`

### Known Limitations
- Text-selection and OCR behavior on the html-parser path differs from the direct-render fallback path
- Browser-assisted smoke verification is blocked by missing Chrome installation in the environment
- html-parser output markup uses `id` attributes instead of `[data-text-id]` spans, affecting selection callbacks
