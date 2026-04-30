# F2 Code Quality Review

## Scope Reviewed

- `package.json`
- `vite.config.ts`
- `vite.lib.config.ts`
- `tsconfig.json`
- `tsconfig.build.json`
- `.github/workflows/ci-pr.yml`
- `.github/workflows/publish.yml`
- `scripts/check-pack.mjs`

## Quality Gate Results

| Command | Result | Notes |
| --- | --- | --- |
| `yarn lint` | PASS | `eslint .` completed successfully |
| `yarn typecheck` | PASS | `tsc --project tsconfig.json --noEmit` completed successfully |
| `yarn test:run` | PASS | Vitest passed: 2 files, 3 tests |
| `yarn build:all` | PASS | Library output written to `dist/`; demo output written to `demo-dist/` |
| `yarn pack:check` | PASS | Pack boundary check passed with 9 files |
| `npm pack --json --dry-run` | PASS | Published contents matched pack-check expectations |

## Review Summary

- Type safety baseline is healthy: no `any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` escapes were found in project TS/JS sources.
- Build and test configuration are largely aligned: demo build uses `demo-dist`, tests exclude `dist/**` and `demo-dist/**`, and library declarations emit into `dist/`.
- `exports` is complete for the documented public surface: package root and `./style.css` both map to actual built files.
- `react` and `react-dom` are correctly modeled as `peerDependencies` and duplicated in `devDependencies` for local development.
- `@hamster-note/types` is referenced from public TypeScript signatures, so keeping it in `dependencies` is defensible because consumers need it for declaration resolution.

## Findings

### 1. Unused runtime dependency in published package

- Severity: Medium
- Evidence: `package.json` declares `@hamster-note/pdf-parser` under `dependencies`, but no source, test, or demo file references that package.
- Impact: consumers install an apparently unused runtime dependency, which increases install surface and can hide stale package relationships.
- Recommendation: remove `@hamster-note/pdf-parser` if it is no longer required, or add the missing runtime usage and corresponding tests if it is intended to stay.

### 2. Local publish path can bypass package-boundary verification

- Severity: Medium
- Evidence: `package.json` defines `prepublishOnly` as `yarn build:lib`, while `yarn pack:check` is only enforced in CI and the GitHub publish workflow.
- Impact: a local `npm publish` or `yarn publish` can proceed after building the library without re-running the boundary guard, so accidental package-content regressions are not blocked outside CI.
- Recommendation: include `yarn pack:check` in `prepublishOnly`, or route local publishing through a dedicated release script that always runs both build and package validation.

### 3. Publish workflow does not verify branch version matches package version

- Severity: Medium
- Evidence: `.github/workflows/publish.yml` extracts `VERSION` from the branch name and `PKG_VERSION` from `package.json`, but only uses them for logging and dist-tag classification; no equality check blocks mismatch.
- Impact: pushing `version/x.y.z` with a different `package.json` version can publish an unexpected version while still appearing to follow the version-branch contract.
- Recommendation: add a hard check that `VERSION == PKG_VERSION` before any publish attempt.

## Configuration Consistency Notes

- `vite.lib.config.ts` writes JS output to `dist/index.js`; `tsconfig.build.json` writes declaration output to `dist/index.d.ts`; both match `package.json` `main` / `module` / `types` / `exports` entries.
- `vite.config.ts` writes demo assets to `demo-dist`; tests explicitly exclude both `dist/**` and `demo-dist/**`, avoiding false positives from generated files.
- `scripts/check-pack.mjs` correctly bans `demo/`, `demo-dist/`, `src/`, `test/`, and `.github/` from the tarball and only allows `dist/` plus release metadata files.
- `npm pack --json --dry-run` currently includes 9 files: `LICENSE`, `README.md`, `package.json`, `dist/index.js`, `dist/index.d.ts`, `dist/index.d.ts.map`, `dist/style.css`, `dist/components/Reader.d.ts`, and `dist/components/Reader.d.ts.map`.
- Published `dist/components/*` declaration artifacts are not exported publicly. This is not a breakage today, but the pack boundary is broader than the public API surface declared in `exports`.

## Verdict

- Overall status: PASS with follow-up issues
- Blocking command failures: none
- Release risks requiring follow-up: 3 medium-severity items above
