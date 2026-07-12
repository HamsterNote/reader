# Tasks

## Plan: html-parser-decode-intermediate-doc

- [x] 1. Add html-parser dependency and build/test wiring
- [x] 2. Build an internal html-parser render adapter with deterministic fallback
- [x] 3. Integrate the adapter into Reader without changing the public input contract
- [x] 4. Expand automated tests for parser path, serialized parity, and fallback behavior
- [x] 5. Update demo to showcase the standard library rendering path
- [x] 6. Update README and packaging guidance to codify standard usage
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Plan: parser-0.6.0-upgrade

- [x] 1. Bump parser dependency specs and refresh lockfile
- [x] 2. Validate upstream 0.6.0 type surface against local shim
- [x] 3. Audit parser-related mocks and assertions for upgrade drift
- [x] 4. Align `src/types/pdf-parser.d.ts` to the 0.6.0 export surface
- [x] 5. Tighten html-parser integration regression coverage
- [x] 6. Tighten pdf-parser demo/build regression coverage and patch config only if required
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep
