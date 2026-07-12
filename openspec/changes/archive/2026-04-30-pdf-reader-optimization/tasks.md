# Tasks: PDF Reader Optimization

## Summary

All implementation tasks completed with verification. Final verification wave (F1-F4) passed.

---

## Plan: pdf-reader-optimization

### Tasks

- [x] 1. Define public API, OCR config, and dependency surface

- [x] 2. Render PDF base image layer and make text selectable

- [x] 3. Add deterministic text selection extraction and events in the viewer

- [x] 4. Add opt-in lazy OCR for visible base images only

- [x] 5. Wire Reader props through and update demo console logging

- [x] 6. Complete targeted tests for the integrated behavior

- [x] 7. Run final hardening, builds, and package-surface verification

### Final Verification

- [x] F1. Plan Compliance Audit — oracle ✅ APPROVED
- [x] F2. Code Quality Review — unspecified-high ✅ APPROVED
- [x] F3. Real Manual QA — unspecified-high ✅ APPROVED
- [x] F4. Scope Fidelity Check — deep ✅ APPROVED

---

## Plan: intermediate-document-lazy-display

### Tasks

- [x] 1. Install parser dependency and verify type compatibility

- [x] 2. Add public lazy `IntermediateDocumentViewer`

- [x] 3. Integrate viewer into `Reader`

- [x] 4. Update demo to parse and display uploaded PDFs

- [x] 5. Add viewer and document styles

- [x] 6. Add comprehensive tests and run full verification

### Final Verification

- [x] F1. Plan Compliance Audit — oracle ✅ APPROVED
- [x] F2. Code Quality Review — unspecified-high ✅ APPROVED
- [x] F3. Real Manual QA — unspecified-high ✅ APPROVED
- [x] F4. Scope Fidelity Check — deep ✅ APPROVED

---

## Plan: document-json-preview-pagination

### Tasks

- [ ] 1. 让 `Reader` 默认展示第一页格式化 JSON

- [ ] 2. 为 `Reader` 增加翻页按钮、边界禁用与零页兜底

- [ ] 3. 在 demo 层接入 `@hamster-note/pdf-parser` 成功路径

- [ ] 4. 固化 demo 的 loading、失败与重试状态机

- [ ] 5. 收口选择器、类型与回归验证

### Final Verification

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Agent-Executed UI QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

---

## Plan: file-upload-demo-pdf

### Tasks

- [ ] 1. Move PDF parser to demo-only dependency scope and add adapter boundary

- [ ] 2. Replace the static demo document with a minimal PDF picker flow and focused integration tests

- [ ] 3. Document the demo PDF flow and lock final verification commands

### Final Verification

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Automated UI QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

---

## Plan: pdf-reader-page

### Tasks

- [ ] 1. Add parser dependency and unify Reader document contract

- [ ] 2. Replace demo fixture with local PDF selection and parse state flow

- [ ] 3. Implement Reader height reservation and viewport windowing shell

- [ ] 4. Render positioned page content with lazy page/text loading

- [ ] 5. Polish integrated reader states, compatibility, and performance guards

- [ ] 6. Document the parser workflow and record release notes

### Final Verification

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

---

## Archived Plan: reader-frontend-package

### Tasks

- [x] 1. Bootstrap package metadata and toolchain

- [x] 2. Establish Vitest + RTL smoke harness

- [x] 3. Implement minimal public Reader API and style contract

- [x] 4. Add local demo that consumes the package entry

- [x] 5. Mirror `types` GitHub CI and npm publish workflows

- [x] 6. Add public package docs, changelog, and pack verification

### Final Verification

- [x] F1. Plan Compliance Audit — oracle ✅ APPROVED
- [x] F2. Code Quality Review — unspecified-high ✅ APPROVED
- [x] F3. Real Manual QA — unspecified-high ✅ APPROVED
- [x] F4. Scope Fidelity Check — deep ✅ APPROVED
