# Task 8 — Text render mode final exports/docs/gates

Date: 2026-07-05

## Public API / docs

- `src/index.ts` already exports `ReaderRenderMode` from `./components/Reader`.
- README now has `### Text render mode` under API notes.
- README documents:
  - default `renderMode='layout'`;
  - opt-in `renderMode='text'`;
  - visible-only virtual pages;
  - text-only content;
  - no page images, intermediate images, or OCR output;
  - no cross-mode highlight geometry conversion.
- `IntermediateDocumentTextViewer` remains internal to the package implementation. It is only exported from the intermediate-viewer component barrel used by internal tests/implementation, not from top-level `src/index.ts`.

## Gate outputs

### First full gate attempt

Command:

```bash
yarn test:run && yarn typecheck && yarn lint && yarn build:lib
```

Result:

- `yarn test:run`: PASS — 13 test files, 322 tests passed.
- `yarn typecheck`: PASS — `tsc --project tsconfig.json --noEmit` completed.
- `yarn lint`: FAIL — code/style lint findings in text-mode files.
- `yarn build:lib`: not reached because lint failed.

Exact lint categories observed:

- Prettier formatting in `IntermediateDocumentTextViewer.tsx`, `IntermediateDocumentViewer.tsx`, `src/index.ts`, text-mode tests, reader tests, and `test/setup.ts`.
- `sonarjs/void-use` for hook dependency no-op statements in `IntermediateDocumentTextViewer.tsx`.
- `sonarjs/no-nested-functions` in text-mode unload scheduling.
- `sonarjs/cognitive-complexity` in layout viewer protected-page calculation.

Resolution:

- Ran `yarn lint --fix` to apply formatter-safe changes.
- Removed no-op `void` statements by folding reset work into the existing document/page reset effect.
- Extracted `removeLoadedTextPage()` to reduce timer callback nesting.
- Extracted `addResolvedProtectedPageRange()` to reduce protected-page callback complexity.
- Re-ran `yarn lint --fix && yarn lint`: PASS.

### Final full gate

Command:

```bash
yarn test:run && yarn typecheck && yarn lint && yarn build:lib
```

Result: PASS.

Observed output summary:

- `yarn test:run`: PASS — 13 test files, 322 tests passed.
- `yarn typecheck`: PASS — `tsc --project tsconfig.json --noEmit` completed.
- `yarn lint`: PASS — `eslint .` completed.
- `yarn build:lib`: PASS — `vite build --config vite.lib.config.ts`, `tsc --project tsconfig.build.json`, and `node scripts/build-styles.mjs` completed.
- Build artifact summary included `dist/index.js 131.48 kB │ gzip: 35.16 kB`.

Non-failing stderr/warnings:

- Vitest still emits known React `act(...)` warnings for text-mode/TanStack Virtual async updates. These match earlier T3–T7 evidence and do not fail assertions.
- Yarn/Node emits `[DEP0169] DeprecationWarning` for `url.parse()` in the toolchain. This is environment/tooling noise and does not fail commands.

## Forbidden-pattern scan

Grep pattern used against changed source/test/docs paths: forbidden markers, debug logging, TypeScript ignore comments, and unsafe `any` assertions.

Commands used via Grep tool:

- `src` with `*.{ts,tsx,scss}` include.
- `test` with `*.{ts,tsx}` include.
- `README.md`.

Result: no matches found.

## Scope / git evidence

Command:

```bash
GIT_MASTER=1 git status --short && GIT_MASTER=1 git diff --stat
```

Output before creating this evidence file:

```text
 M README.md
 M package.json
 M src/components/IntermediateDocumentViewer/IntermediateDocumentViewer.tsx
 M src/components/IntermediateDocumentViewer/index.ts
 M src/components/IntermediateDocumentViewer/useLazyPageQueue.ts
 M src/components/Reader.tsx
 M src/index.ts
 M src/styles/reader.scss
 M test/intermediate-document-viewer.test.tsx
 M test/reader.test.tsx
 M test/setup.ts
 M test/types.test.ts
 M yarn.lock
?? src/components/IntermediateDocumentViewer/IntermediateDocumentTextPageContent.tsx
?? src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer.tsx
 README.md                                          |   6 +
 package.json                                       |   3 +-
 .../IntermediateDocumentViewer.tsx                 |  70 ++-
 src/components/IntermediateDocumentViewer/index.ts |   8 +
 .../IntermediateDocumentViewer/useLazyPageQueue.ts |  55 ++-
 src/components/Reader.tsx                          |  35 ++
 src/index.ts                                       |   6 +-
 src/styles/reader.scss                             |  54 +++
 test/intermediate-document-viewer.test.tsx         | 498 ++++++++++++++++++++-
 test/reader.test.tsx                               |  98 ++++
 test/setup.ts                                      | 194 ++++++++
 test/types.test.ts                                 |  27 +-
 yarn.lock                                          |  12 +
 13 files changed, 1014 insertions(+), 52 deletions(-)
```

Scope assessment:

- Changes are confined to text render mode feature implementation, direct tests/harness, dependency lockfile, public README/API export, and task evidence/notepads.
- No demo UI redesign appears in the diff.
- Pre-existing dirty-worktree guardrail files (`IntermediateDocumentViewer.tsx`, `useLazyPageQueue.ts`, `reader.scss`) were edited only for the text-mode feature and final lint compliance.

## Commit readiness

- Recent repository commits use semantic messages such as `feat(reader): ...`, `fix(reader): ...`, `docs(reader): ...`.
- Requested commit message `feat(reader): add text render mode` matches repository style.
- Final gate is green and the feature is ready for one atomic commit.
