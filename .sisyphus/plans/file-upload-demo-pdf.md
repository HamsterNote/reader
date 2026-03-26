# Demo PDF Upload Flow

## TL;DR
> **Summary**: 在 `reader` 仓库内新增一个仅供 `demo/` 使用的本地 PDF 选择流程。首版只负责把 `File` 解析为 `Reader` 现有可消费的数据并显示在现有 `Reader` 中，不扩展成真实 PDF 页面渲染器。
> **Deliverables**:
> - `demo/App.tsx` 的最小 PDF 选择/解析/错误反馈流
> - demo 范围内的 PDF 解析与 `Reader` 输入适配
> - 面向 happy path、非法文件、解析失败、恢复重试的 `Vitest + Testing Library` 测试
> - `README.md` 与 `CHANGELOG.md` 的同步说明
> **Effort**: Short
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3

## Context
### Original Request
- 增加上传文件功能。

### Interview Summary
- 范围固定为 **仅 demo**，不把上传入口做进公共 `Reader` 组件。
- 文件处理方式固定为 **浏览器本地读取**，不接后端、不接第三方存储。
- 文件类型固定为 **仅 PDF**。
- 交互复杂度固定为 **极简选择**：不做拖拽上传。
- 展示目标固定为 **接入现有 `Reader`**：打通“选文件 → 解析 → 展示”链路，不升级 `Reader` 为真实 PDF 渲染器。
- 测试策略固定为 **tests-after**，沿用仓库现有 `Vitest + Testing Library + jsdom`。

### Metis Review (gaps addressed)
- 已锁定 **库边界稳定**：`src/components/Reader.tsx` 保持当前契约与渲染语义，不为 demo 上传流扩大公共 API。
- 已锁定 **最低风险适配路径**：`demo/` 内部调用 `PdfParser.encode(file)`，再用 `IntermediateDocument.serialize(...)` 适配为 `Reader` 已支持的 `IntermediateDocumentSerialized`。
- 已锁定 **默认空态策略**：demo 初始为空态，不再保留静态样例文档。
- 已锁定 **失败回退策略**：非法文件或解析失败时清空当前文档并回到空态，同时显示稳定错误文案。
- 已锁定 **最小交互策略**：文件输入始终可见；成功后不新增复杂“重选”流程，直接允许再次选择覆盖当前结果。

## Work Objectives
### Core Objective
- 在不改动 `Reader` 公共能力边界的前提下，让本地 demo 支持选择 PDF 文件、在浏览器内完成解析，并把解析结果交给现有 `Reader` 展示。

### Deliverables
- `package.json` 将 `@hamster-note/pdf-parser` 从 `dependencies` 迁移到 `devDependencies`，确保 parser 仅服务 demo。
- `demo/App.tsx` 从静态 fixture 改为最小 PDF 文件选择流。
- demo 范围内新增一个解析适配模块，把 `PdfParser` 输出适配为 `IntermediateDocumentSerialized`。
- 自动化测试覆盖：初始空态、合法 PDF、非法文件、解析失败、失败后再次成功。
- `README.md` 增加 demo 接线说明；`CHANGELOG.md` 在 `[Unreleased]` 记录本次能力。

### Definition of Done (verifiable conditions with commands)
- `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('missing pdf parser devDependency'); if(p.dependencies?.['@hamster-note/pdf-parser']) throw new Error('pdf parser must stay out of dependencies')"` 通过。
- `yarn test:run test/demo.test.tsx test/reader.test.tsx` 通过。
- `yarn build:demo` 通过。
- `yarn lint && yarn typecheck` 通过。
- `README.md` 包含 demo 侧 `PdfParser.encode(file)` 接线说明，`CHANGELOG.md` 的 `[Unreleased]` 包含本次更新条目。

### Must Have
- `demo/App.tsx` 保留 `data-testid='reader-demo-root'` 根节点。
- 新增文件输入必须使用 `accept='.pdf,application/pdf'`，并在解析中禁用自身，防止重复触发。
- demo 默认空态文案固定为 `Upload a PDF to preview.`，供 `Reader.emptyText` 与测试断言复用。
- 非法文件错误文案固定为 `Please choose a PDF file.`。
- 解析失败错误文案固定为 `Failed to parse PDF file.`。
- 解析成功后必须通过适配结果把文档传给 `Reader`，而不是把 parser 类型泄漏进公共 API。
- 文件输入在成功和失败状态下都保持可见，允许用户直接再次选择文件覆盖当前状态。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不修改 `src/components/Reader.tsx`、`src/index.ts` 或其他公共库导出文件。
- 不新增拖拽上传、多文件队列、上传进度、文件持久化、服务端接口、第三方存储。
- 不实现真实 PDF 页面渲染、缩略图、分页预览或懒加载阅读器内核。
- 不把 demo 解析逻辑抽进 `src/` 公共目录；仅允许放在 `demo/` 范围内。
- 不使用 `any` 逃逸；状态、错误和适配结果都必须显式类型化。

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: `tests-after`，沿用 `Vitest + Testing Library + jsdom`（`vite.config.ts:28`）。
- QA policy: 每个任务都包含 agent 可执行的 happy path 与 failure/edge case；不依赖人工点页面。
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`。

## Execution Strategy
### Parallel Execution Waves
> 本计划存在明显顺序依赖：先锁定依赖与适配边界，再实现 demo UI，随后补测试与文档，因此不拆并行波次。

Wave 1: Task 1（依赖与 demo 适配边界）

Wave 2: Task 2（demo 选择/解析/错误流 + 自动化测试）

Wave 3: Task 3（README / CHANGELOG / 全量验证）

### Dependency Matrix (full, all tasks)
- Task 1 → 无前置依赖
- Task 2 → Blocked By: Task 1
- Task 3 → Blocked By: Task 2
- F1 / F2 / F3 / F4 → Blocked By: Task 1-3 全部完成且用户明确同意进入最终验证

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `unspecified-high`
- Wave 2 → 1 task → `visual-engineering`
- Wave 3 → 1 task → `writing`
- Final Verification → 4 review tasks → `oracle`, `unspecified-high`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Move PDF parser to demo-only dependency scope and add adapter boundary

  **What to do**: 在 `package.json` 中把 `@hamster-note/pdf-parser` 从 `dependencies` 迁移到 `devDependencies`，并确保 `dependencies` 仅保留 `@hamster-note/types` 等真正属于库运行时的依赖。在 `demo/lib/parsePdfToReaderDocument.ts` 新增 demo 专用适配函数，固定签名为 `export async function parsePdfToReaderDocument(file: File): Promise<IntermediateDocumentSerialized | undefined>`。函数内部只做两件事：调用 `PdfParser.encode(file)`；若成功拿到 `IntermediateDocument`，再调用 `IntermediateDocument.serialize(...)` 返回序列化结果；若 parser 返回 `undefined`，则原样返回 `undefined`。该 helper 不做 UI 状态、不做文件类型校验、不写入 localStorage、不导出到公共 API。
  **Must NOT do**: 不修改 `src/components/Reader.tsx`；不修改 `src/index.ts`；不在 `src/` 下新增 parser 相关 helper；不把 parser 引入任何发布库入口。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 涉及依赖分层、demo 边界约束和类型安全适配。
  - Skills: `[]` — 现有仓库上下文足够。
  - Omitted: `['frontend-ui-ux']` — 此任务不是交互打磨。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Task 2, Task 3 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `package.json:45` — 当前 `@hamster-note/pdf-parser` 仍在 `dependencies`，本任务必须把它迁移到 `devDependencies` 以恢复 demo-only 边界。
  - Pattern: `demo/App.tsx:1` — demo 当前直接持有静态文档，是本次接入 parser 的唯一前端落点。
  - Pattern: `src/components/Reader.tsx:3` — `Reader` 当前只接受 `IntermediateDocumentSerialized | null`，证明适配应发生在 demo 侧而非扩公共契约。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/PdfParser/src/index.ts:31` — `PdfParser` 类入口。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/PdfParser/src/index.ts:39` — `PdfParser.encode(fileOrBuffer)` 静态方法，支持直接传 `File`。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:169` — `IntermediateDocument.serialize(...)` 是把 parser 结果适配回现有 `Reader` 契约的既有入口。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:187` — `parse()` 已存在，说明当前库契约围绕序列化对象工作，无需因 demo 上传流改公共 API。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('missing devDependency'); if(p.dependencies?.['@hamster-note/pdf-parser']) throw new Error('parser leaked into dependencies')"` 通过。
  - [ ] `yarn typecheck` 通过，且 `demo/lib/parsePdfToReaderDocument.ts` 暴露的返回类型是 `Promise<IntermediateDocumentSerialized | undefined>`。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Parser package stays demo-only
    Tool: Bash
    Steps: run `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('missing pdf parser devDependency'); if(p.dependencies?.['@hamster-note/pdf-parser']) throw new Error('pdf parser must not be runtime dependency');"`
    Expected: command exits 0 only when parser exists exclusively in `devDependencies`
    Evidence: .sisyphus/evidence/task-1-parser-boundary.txt

  Scenario: Demo adapter remains type-safe and internal
    Tool: Bash
    Steps: run `yarn typecheck`
    Expected: typecheck exits 0 with demo-scoped adapter compiling and no `Reader` public API changes required
    Evidence: .sisyphus/evidence/task-1-parser-boundary-error.txt
  ```

  **Commit**: YES | Message: `feat(demo): add pdf parser adapter for local preview flow` | Files: `package.json`, `demo/lib/parsePdfToReaderDocument.ts`

- [ ] 2. Replace the static demo document with a minimal PDF picker flow and focused integration tests

  **What to do**: 在 `demo/App.tsx` 重写 demo 页面，并在 `test/demo.test.tsx` 同步补齐行为测试。组件侧去掉静态 `demoDocument`，改为最小状态流：`document: IntermediateDocumentSerialized | null`、`errorMessage: string | null`、`isParsing: boolean`。根节点继续使用 `data-testid='reader-demo-root'`。页面固定结构：标题 `Hamster Reader Demo`、说明文案 `Select a PDF file to preview in Reader.`、文件输入 `data-testid='reader-demo-input'`、可选解析中提示、错误区域 `data-testid='reader-demo-error'`（仅在有错时渲染）、以及始终渲染的 `<Reader document={document} emptyText='Upload a PDF to preview.' />`。文件输入配置固定为 `accept='.pdf,application/pdf'`。`onChange` 行为固定如下：若无文件则直接返回；若 `file.type !== 'application/pdf'` 且文件名不以 `.pdf` 结尾，则设置 `Please choose a PDF file.`、清空 `document`、清空 input 值；若合法，则先清空错误并设置 `isParsing=true`，调用 `parsePdfToReaderDocument(file)`；若返回 `undefined` 或抛错，则设置 `Failed to parse PDF file.`、清空 `document`；若成功，写入 `document`、清空错误；最后统一把 `event.currentTarget.value = ''` 并恢复 `isParsing=false`，从而允许同一文件再次被选择。测试侧固定使用 `Vitest + Testing Library + user-event`，并通过 `vi.mock('../demo/lib/parsePdfToReaderDocument')` 隔离 parser 与真实 PDF 解析。测试文件必须定义稳定 fixture：`{ id: 'pdf-1', title: 'Parsed PDF Title', pages: [] }`，并覆盖五个场景：① 初始渲染显示 `Upload a PDF to preview.` 且无错误；② 上传合法 `sample.pdf` 后 helper 返回 fixture，页面出现 `Parsed PDF Title` 且错误消失；③ 上传 `notes.txt` 时 helper 不被调用，页面显示 `Please choose a PDF file.`；④ helper 返回 `undefined` 时页面显示 `Failed to parse PDF file.` 并回到空态；⑤ 先失败再上传合法 PDF 时，错误消失并显示成功标题。
  **Must NOT do**: 不增加拖拽区域；不加“最近文件”或持久化；不在成功态跳转页面；不新增“重新选择文件”按钮；不把错误态做成 toast；不让 parser 异常冒泡到未处理 promise；不在 Vitest 中解析真实 PDF；不 mock `Reader`；不引入 Playwright/Cypress；不新增脆弱的快照测试。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 任务同时覆盖 demo 页面交互和与之强绑定的集成测试。
  - Skills: `[]` — 现有栈足够。
  - Omitted: `['playwright']` — 当前仓库没有浏览器 E2E 基建，此任务通过集成测试验证即可。

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 3 | Blocked By: Task 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `demo/App.tsx:1` — 当前 demo 结构极简，需要在同文件内演进为选择/解析/展示流。
  - Pattern: `src/components/Reader.tsx:9` — `Reader` 已支持 `document | emptyText` 组合，最小方案是让它在空态显示占位文本，而不是额外造一套展示容器。
  - API/Type: `demo/lib/parsePdfToReaderDocument.ts:1` — 本任务必须复用 Task 1 中的 demo-scoped 适配 helper，而不是直接在组件里串写 parser/serialize 细节。
  - Test: `test/reader.test.tsx:18` — 现有测试使用 `render`、`screen.getByTestId` 和 `toHaveTextContent`，新测试应延续相同断言风格。
  - Pattern: `vite.config.ts:28` — Vitest 已使用 `jsdom` 与 `test/setup.ts`，无需额外环境配置。
  - Pattern: `package.json:58` — `@testing-library/user-event` 已安装，可直接用 `user.upload(...)` 模拟选文件。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/demo.test.tsx` 通过，且显式断言非法文件不会调用 demo helper。
  - [ ] `yarn test:run test/demo.test.tsx test/reader.test.tsx` 通过，证明 demo 上传流新增测试没有破坏现有 `Reader` 基线。
  - [ ] `yarn build:demo && yarn typecheck` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Valid PDF selection renders parsed title
    Tool: Bash
    Steps: run `yarn test:run test/demo.test.tsx -t "renders parsed title after selecting a valid pdf"`
    Expected: command exits 0 after uploading `sample.pdf` through `data-testid="reader-demo-input"`; mocked adapter resolves fixture; `Parsed PDF Title` appears inside `reader-root`
    Evidence: .sisyphus/evidence/task-2-demo-flow.txt

  Scenario: Invalid file and parse failure remain recoverable
    Tool: Bash
    Steps: run `yarn test:run test/demo.test.tsx -t "rejects non-pdf files without calling parser" && yarn test:run test/demo.test.tsx -t "recovers after a failed parse when a valid pdf is selected next"`
    Expected: first command proves `notes.txt` shows `Please choose a PDF file.` without calling helper; second proves a later valid PDF clears `Failed to parse PDF file.` and restores title rendering
    Evidence: .sisyphus/evidence/task-2-demo-flow-error.txt
  ```

  **Commit**: YES | Message: `feat(demo): add local pdf selection and error states` | Files: `demo/App.tsx`, `test/demo.test.tsx`

- [ ] 3. Document the demo PDF flow and lock final verification commands

  **What to do**: 更新 `README.md` 的“使用”章节，保留现有库用法示例，同时新增一个明确标注为 demo / local preview 的小节，固定展示 `PdfParser.encode(file)` 不是公共库 API，而是 demo 侧接线思路；文档中必须说明 parser 为 demo 范围依赖、`Reader` 本身不负责文件上传。更新 `CHANGELOG.md` 的 `[Unreleased]` → `Added`，补充两到三条本次能力：本地 PDF 选择、demo 预览接线、上传错误反馈。最后把最终验证命令固定为：`yarn lint && yarn typecheck && yarn test:run && yarn build:all`。
  **Must NOT do**: 不在 README 中暗示 `Reader` 公开支持文件上传；不修改历史 release 条目；不删除已有使用示例；不增加与本次 demo 上传流无关的文档段落。

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: 以文档准确性和范围表述为主。
  - Skills: `[]` — 现有上下文充足。
  - Omitted: `['frontend-ui-ux']` — 非界面任务。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: F1, F2, F3, F4 | Blocked By: Task 2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `README.md:13` — 当前 README 只有库级使用示例，需要在保留现有结构的前提下补 demo 接线说明。
  - Pattern: `CHANGELOG.md:8` — 当前 `[Unreleased]` 已存在 `Added` 段，新增条目应继续写在这里。
  - Pattern: `package.json:28` — 现有脚本已提供 `lint`、`typecheck`、`test:run`、`build:all`，最终 DoD 应直接复用这些命令。
  - Pattern: `demo/App.tsx:11` — demo 已是本地开发入口，文档说明必须聚焦 demo 场景而不是扩写公共 API。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const fs=require('node:fs'); const readme=fs.readFileSync('README.md','utf8'); const changelog=fs.readFileSync('CHANGELOG.md','utf8'); if(!readme.includes('PdfParser.encode(file)')) throw new Error('README missing parser example'); if(!readme.includes('demo') && !readme.includes('Demo')) throw new Error('README missing demo scope note'); if(!changelog.includes('PDF')) throw new Error('CHANGELOG missing pdf note');"` 通过。
  - [ ] `yarn lint && yarn typecheck && yarn test:run && yarn build:all` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Documentation describes demo-only parser wiring
    Tool: Bash
    Steps: run `node -e "const fs=require('node:fs'); const readme=fs.readFileSync('README.md','utf8'); if(!readme.includes('PdfParser.encode(file)')) throw new Error('missing parser example'); if(!readme.includes('Reader')) throw new Error('missing Reader mention');"`
    Expected: command exits 0 only when README documents the local demo parser flow without deleting the base Reader example
    Evidence: .sisyphus/evidence/task-3-docs.txt

  Scenario: Final verification command stays green
    Tool: Bash
    Steps: run `yarn lint && yarn typecheck && yarn test:run && yarn build:all`
    Expected: all four commands exit 0 with demo upload flow, focused tests, and docs updates integrated
    Evidence: .sisyphus/evidence/task-3-docs-error.txt
  ```

  **Commit**: YES | Message: `docs(reader): document demo pdf upload flow` | Files: `README.md`, `CHANGELOG.md`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
  - Tool: `task(subagent_type="oracle", load_skills=[], run_in_background=false, prompt="Audit implemented changes against .sisyphus/plans/file-upload-demo-pdf.md. Verify no public Reader API changes, parser remains demo-only, and all acceptance criteria were satisfied. Return APPROVED/REJECTED with file-specific findings.")`
  - Expected: `APPROVED` with no unplanned edits outside `demo/`, `test/`, `README.md`, `CHANGELOG.md`, and `package.json`
  - Evidence: `.sisyphus/evidence/f1-plan-compliance.md`
- [ ] F2. Code Quality Review — unspecified-high
  - Tool: `task(category="unspecified-high", load_skills=[], run_in_background=false, description="Review upload code", prompt="Review the implemented demo PDF upload flow for type safety, error handling, dependency boundaries, and test quality. Focus on demo/App.tsx, demo/lib/parsePdfToReaderDocument.ts, test/demo.test.tsx, package.json, README.md, and CHANGELOG.md. Return APPROVED/REJECTED with exact fixes if needed.")`
  - Expected: `APPROVED` with no `any`, no unhandled promise errors, and no parser leakage into public library code
  - Evidence: `.sisyphus/evidence/f2-code-quality.md`
- [ ] F3. Automated UI QA — unspecified-high
  - Tool: Bash
  - Steps: run `yarn test:run test/demo.test.tsx test/reader.test.tsx && yarn build:demo`
  - Expected: tests prove empty state, valid PDF success, invalid file rejection, parse failure, and recovery; demo build exits 0
  - Evidence: `.sisyphus/evidence/f3-automated-ui-qa.txt`
- [ ] F4. Scope Fidelity Check — deep
  - Tool: `task(category="deep", load_skills=[], run_in_background=false, description="Check scope fidelity", prompt="Compare the implemented changes with .sisyphus/plans/file-upload-demo-pdf.md and the original request. Verify the work stayed demo-only, local-only, PDF-only, minimal UI, and did not expand into Reader API changes or real PDF rendering. Return APPROVED/REJECTED with exact scope deviations.")`
  - Expected: `APPROVED` with no scope creep into drag-drop, backend upload, persistence, or Reader renderer expansion
  - Evidence: `.sisyphus/evidence/f4-scope-fidelity.md`

## Commit Strategy
- Commit 1: `feat(demo): add pdf parser adapter for local preview flow`
- Commit 2: `feat(demo): add local pdf selection and error states`
- Commit 3: `docs(reader): document demo pdf upload flow`

## Success Criteria
- 用户在 demo 中选择一个本地 PDF 后，页面不刷新即可看到 `Reader` 从空态切换到已加载标题态。
- 用户选择非 PDF 文件时，不调用解析器，页面展示稳定错误文案。
- 解析器返回 `undefined` 或抛错时，页面回到空态并允许再次选择文件。
- 公共库入口和 `Reader` 契约保持不变，`pdf-parser` 不泄漏到发布产物的运行时依赖中。
