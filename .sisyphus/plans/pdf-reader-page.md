# Build PDF Reader Demo + Lazy Viewer

## TL;DR
> **Summary**: 在 `reader` 仓库内同时完成两层能力：`demo/` 首页先选本地 PDF，再用 `@hamster-note/pdf-parser` 解析为 `IntermediateDocument`；库级 `Reader` 组件升级为可消费懒加载中间态文档的真实阅读器，并通过预先计算总高度 + 视口窗口渲染来保证滚动条正确且大文档可用。
> **Deliverables**:
> - `demo/App.tsx` 的单页上传 → 解析 → 阅读切换流
> - `Reader` 对 `IntermediateDocument | IntermediateDocumentSerialized | null` 的兼容输入
> - 基于页面尺寸元数据的总高度占位与窗口化挂载
> - 基于 `IntermediateText` 的拟真页面文本层渲染（不做图片/图形还原）
> - 覆盖成功、失败、懒加载与兼容性的 `Vitest + Testing Library` 测试
> - 更新 `README.md` 与 `CHANGELOG.md` 的公开说明
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 → Task 3 → Task 4 → Task 5 → Task 6

## Context
### Original Request
- 引入 `@hamster-note/pdf-parser`。
- 引入 `@hamster-note/types`。
- 制作一个展示文档的 Reader 页面，首页先选择文件。
- 目前只支持 PDF，上传后通过 parser 转成 `types` 中声明的中间态再展示。
- 由于 PDF 可能页数和字数很多，需要尽可能懒加载，但滚动条必须正常显示，因此要提前撑开高度。

### Interview Summary
- 当前仓库是 **组件库 + demo**，不是完整路由应用；本次实现落点固定为 `demo/` 与 `src/components/Reader.tsx` 两层。
- 首页交互固定为 **单页切换**：先显示上传区，选择文件后同页切换为 Reader 视图，并保留“重新选择文件”入口。
- 文件状态固定为 **仅当前会话**；刷新后不恢复。
- 展示策略固定为 **页面拟真优先**，但首版只做基于 `IntermediateText` 的文本层还原，不扩展到图片/图形/canvas PDF viewer。
- 测试策略固定为 **测试后补**，使用现有 `Vitest + Testing Library + jsdom`。

### Metis Review (gaps addressed)
- 已锁定 **向后兼容**：`Reader` 不放弃原有序列化输入，统一支持 `IntermediateDocument | IntermediateDocumentSerialized | null`。
- 已锁定 **依赖分层**：`@hamster-note/types` 继续作为库依赖；`@hamster-note/pdf-parser` 仅供 demo 与测试使用，优先放入 `devDependencies`，避免把解析器强加给所有库消费者。
- 已锁定 **滚动方案**：总高度只能基于 `getPageSizeByPageNumber(pageNumber)` 预先计算，不能为了算高度先把全部页面或全部文本加载出来。
- 已锁定 **渲染边界**：首版“拟真”定义为按页面容器 + 绝对定位文本层渲染，明确不做图片、矢量图形、注释、搜索、缩放工具栏、目录侧栏。
- 已锁定 **错误模型**：必须同时定义文件类型错误、解析失败、单页懒加载失败三类 UI，而不是只做 happy path。

## Work Objectives
### Core Objective
- 让 `reader` 仓库的本地 demo 真正能读取本地 PDF，并让公开 `Reader` 组件在不破坏现有序列化输入兼容性的前提下，支持大文档的懒加载阅读。

### Deliverables
- `package.json` 新增 `@hamster-note/pdf-parser`，且其依赖层级与库/ demo 角色一致。
- `demo/App.tsx` 从静态 fixture 改为文件选择、解析状态机和阅读器切换页。
- `src/components/Reader.tsx` 从 placeholder 升级为懒加载阅读器总控。
- 新增内部虚拟化/页面渲染辅助模块与样式，支持预留总高度、绝对定位页面、窗口化挂载。
- 自动化测试覆盖：兼容旧输入、上传成功、无效文件、解析失败、总高度占位、窗口化挂载、按页懒加载、页面错误态。
- `README.md` 说明新的输入契约与“本地 PDF → parser → Reader”的推荐接线方式；`CHANGELOG.md` 在 `[Unreleased]` 下补充新增功能。

### Definition of Done (verifiable conditions with commands)
- `yarn lint && yarn typecheck && yarn test:run && yarn build:all` 全部通过。
- `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('missing pdf parser devDependency'); if(!p.dependencies?.['@hamster-note/types']) throw new Error('missing types dependency');"` 通过。
- `yarn test:run test/reader.test.tsx test/demo.test.tsx` 覆盖 Reader 兼容输入、demo 上传流、懒加载窗口化与失败路径。
- `yarn build:demo` 产物可在 `demo-dist/` 中构建成功，且 demo 使用本地 PDF 解析流而非静态 fixture。
- `README.md` 出现 `PdfParser.encode(file)` 示例，`CHANGELOG.md` 的 `[Unreleased]` 出现本次功能说明。

### Must Have
- `ReaderProps.document` 明确支持 `IntermediateDocument | IntermediateDocumentSerialized | null`。
- `Reader` 内部对序列化输入统一转换为 `IntermediateDocument.parse(...)` 后再走单一渲染管线。
- 页面总高度使用每页原始尺寸计算；缩放后高度必须随容器宽度变化而重算。
- 页面挂载窗口固定为“可视区 + 上下各 1 个视口 overscan”。
- 页面间距固定为 `24px`；页面内容列最大宽度固定为 `960px`；阅读区域水平内边距固定为 `24px`。
- 懒加载粒度固定到“页”：只有进入挂载窗口的页才调用 `getPageByPageNumber(pageNumber)`；只有页组件需要文本时才调用 `page.getTexts()`。
- 单页渲染必须支持 `IntermediateText` 的 `x` / `y` 百分比语义、`fontSize` 的 `px|em` 语义、`rotate` / `skew` / `dir` / `vertical` 基础映射。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不引入新的虚拟列表第三方库；本次窗口化必须基于仓库内自实现数学计算完成。
- 不把 `@hamster-note/pdf-parser` 变成库公共运行时硬依赖，除非 `src/` 公共 API 明确直接导入它。
- 不新增路由系统、文件持久化、最近文件记录、多文档标签、目录侧栏、搜索、缩放工具栏、打印、导出、标注。
- 不尝试实现图片/图形/canvas 级 PDF 复刻；首版仅对文本层拟真负责。
- 不为总高度计算而预取全部页文本或整本文档。
- 不使用 `any` 逃逸；所有内部状态、页模型、错误模型必须显式类型化。

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: `tests-after`，沿用 `Vitest + Testing Library + jsdom`。
- QA policy: 每个任务都包含 agent 可执行的 happy path 与 failure/edge case；无浏览器 E2E 基建时，使用 focused unit/integration tests + build/type/lint 命令完成验证。
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`。

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. 本计划因存在严格链式依赖（Task 4 → Task 5 → Task 6），无法把所有波次都塞满；优先保证依赖正确性，最终采用 4 waves + 最终验证波次。

Wave 1: Task 1（依赖分层 + 公共契约 + 数据归一化基线）

Wave 2: Task 2（demo 上传/解析状态机）、Task 3（Reader 高度占位与窗口化骨架）

Wave 3: Task 4（页面拟真文本层与页级懒加载）

Wave 4: Task 5（集成态打磨与失败路径）、Task 6（README / CHANGELOG 更新）

### Dependency Matrix (full, all tasks)
- Task 1 → 无前置依赖
- Task 2 → Blocked By: Task 1
- Task 3 → Blocked By: Task 1
- Task 4 → Blocked By: Task 1, Task 3
- Task 5 → Blocked By: Task 2, Task 3, Task 4
- Task 6 → Blocked By: Task 1, Task 2, Task 5
- F1 / F2 / F3 / F4 → Blocked By: Task 1-6 全部完成且用户明确同意进入最终验证

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `unspecified-high`
- Wave 2 → 2 tasks → `visual-engineering`, `unspecified-high`
- Wave 3 → 1 task → `visual-engineering`
- Wave 4 → 2 tasks → `unspecified-high`, `writing`
- Final Verification → 4 review tasks → `oracle`, `unspecified-high`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Add parser dependency and unify Reader document contract

  **What to do**: 更新 `package.json`，保持 `@hamster-note/types` 留在 `dependencies`，并把 `@hamster-note/pdf-parser` 加入 `devDependencies`，因为 parser 只服务于 `demo/` 与测试，不应成为库消费者的默认运行时负担。将 `src/components/Reader.tsx` 的 `ReaderProps.document` 扩展为 `IntermediateDocument | IntermediateDocumentSerialized | null`，但保留现有 `className` / `emptyText` 契约。新增内部归一化模块（固定命名为 `src/lib/normalizeDocument.ts`），提供单一入口：若传入的是 `IntermediateDocumentSerialized`，则调用 `IntermediateDocument.parse(document)`；若传入的是 `IntermediateDocument`，则直接返回；若为 `null | undefined`，返回空。`Reader` 后续所有渲染路径都必须基于这个归一化结果，避免双代码路径。同步更新 `test/reader.test.tsx` 的基础用例，明确验证序列化输入和类实例输入都会被接受，并且空态仍然使用 `emptyText`。
  **Must NOT do**: 不在 `src/` 公共库代码中直接导入 `@hamster-note/pdf-parser`；不删除现有序列化输入支持；不把新的文档归一化 helper 暴露为公开 API；不把 `ReaderProps` 拆成多套互斥 props。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 同时涉及依赖分层、公开 API 兼容、类型收敛和基础测试修订。
  - Skills: `[]` — 仓库已有足够上下文，无需额外技能。
  - Omitted: `['frontend-ui-ux']` — 此任务以契约与类型为主，不需要视觉设计能力。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Task 2, Task 3, Task 4, Task 5, Task 6 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `package.json:45` — 当前 `@hamster-note/types` 已在 `dependencies`，需要在此基础上补充 parser 但不能破坏现有分层。
  - Pattern: `src/components/Reader.tsx:1` — 当前 `ReaderProps.document` 只接受 `IntermediateDocumentSerialized | null`，是本次向后兼容扩展的直接入口。
  - Pattern: `src/index.ts:1` — 公开导出面当前极小，说明新增 helper 应保持内部化，不额外暴露新 API。
  - Test: `test/reader.test.tsx:1` — 现有测试已经覆盖标题和空态，是扩展兼容输入断言的最佳落点。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:11` — `IntermediateDocumentSerialized` 定义。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:187` — `IntermediateDocument.parse(...)` 是序列化输入统一转类实例的既有入口。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:195` — `IntermediateDocument` 构造契约，后续 Reader 内部统一按类实例消费。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('parser must be devDependency'); if(!p.dependencies?.['@hamster-note/types']) throw new Error('types must stay dependency');"` 通过。
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且包含“序列化输入仍可渲染”和“`IntermediateDocument` 实例输入可渲染”两个场景。
  - [ ] `yarn typecheck` 通过，且 `ReaderProps.document` 的公开类型已扩展为三态联合。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Dependency layering stays correct
    Tool: Bash
    Steps: run `node -e "const p=require('./package.json'); if(!p.devDependencies?.['@hamster-note/pdf-parser']) throw new Error('missing parser devDependency'); if(!p.dependencies?.['@hamster-note/types']) throw new Error('missing types dependency'); if(p.dependencies?.['@hamster-note/pdf-parser']) throw new Error('parser must not be runtime dependency');"`
    Expected: command exits 0 only when parser is dev-only and types remains runtime dependency
    Evidence: .sisyphus/evidence/task-1-contract.txt

  Scenario: Backward-compatible Reader input contract
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx && yarn typecheck`
    Expected: tests prove both serialized and lazy document inputs render without breaking `emptyText`; typecheck exits 0
    Evidence: .sisyphus/evidence/task-1-contract-error.txt
  ```

  **Commit**: YES | Message: `feat(reader): support lazy and serialized document inputs` | Files: `package.json`, `src/components/Reader.tsx`, `src/lib/normalizeDocument.ts`, `test/reader.test.tsx`

- [ ] 2. Replace demo fixture with local PDF selection and parse state flow

  **What to do**: 将 `demo/App.tsx` 从静态 `demoDocument` fixture 改为本地文件驱动的单页状态机，固定状态为 `idle | parsing | ready | error`。页面初始渲染上传区：标题、说明文案、`accept=".pdf,application/pdf"` 的文件输入、支持文本。选择文件后先做前端校验：只接受 MIME 为 `application/pdf` 或扩展名 `.pdf` 的文件；非法文件直接进入 `error` 态并保持在上传区，不调用 parser。合法文件则进入 `parsing` 态，禁用文件输入，调用 `PdfParser.encode(file)`；若返回 `undefined` 或抛错，则展示解析失败错误文案并回到上传区；若成功拿到 `IntermediateDocument`，写入状态并切换到 `ready` 态，在同页渲染 `<Reader document={parsedDocument} />`。`ready` 态必须提供稳定的“重新选择文件”按钮，点击后清空文档、错误和文件输入值并回到 `idle`。新增 `test/demo.test.tsx`，通过 `vi.mock('@hamster-note/pdf-parser')` 精确覆盖成功上传、非法文件拦截、parser 抛错、重新选择文件四类路径。
  **Must NOT do**: 不把文件内容持久化到 localStorage / IndexedDB；不实现拖拽上传；不允许并发解析多个文件；不在 `ready` 态保留旧错误消息；不引入路由跳转或独立阅读页。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 需要完成 demo 页面交互流、解析状态切换和本地文件输入体验。
  - Skills: `[]` — 现有栈已足够完成。
  - Omitted: `['playwright']` — 当前仓库没有 E2E 基建，使用集成测试即可覆盖该状态机。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 5, Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `demo/App.tsx:1` — 当前 demo 使用静态 fixture，需在这个文件内直接承载上传 → 解析 → 阅读单页切换流。
  - Pattern: `demo/main.tsx:4` — demo 已通过 `@hamster-note/reader/style.css` 引入库样式，说明 `App.tsx` 只需聚焦状态与结构。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/PdfParser/src/index.ts:31` — `PdfParser` 类定义。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/PdfParser/src/index.ts:39` — `PdfParser.encode(fileOrBuffer)` 的静态签名，demo 必须以 `File` 直接调用。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:152` — parser 成功后返回的文档类实例契约。
  - Test: `test/smoke.test.tsx:1` — 测试文件组织与 Testing Library 用法基线。
  - Test: `vite.config.ts:24` — Vitest 已配置 `jsdom` 与 `setupFiles`，适合新增 demo 集成测试。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/demo.test.tsx` 通过，且测试显式断言非法文件不会调用 `PdfParser.encode`。
  - [ ] `yarn test:run test/demo.test.tsx` 通过，且测试显式断言成功解析后同页出现 `Reader` 根节点与“重新选择文件”按钮。
  - [ ] `yarn build:demo` 通过，证明 demo 真实引入 parser 包后仍可构建。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: PDF upload switches to reader view
    Tool: Bash
    Steps: run `yarn test:run test/demo.test.tsx`
    Expected: suite contains a case that uploads a `File` with `.pdf` name, mocks `PdfParser.encode` success, and asserts same-page transition from picker UI to `data-testid="reader-root"`
    Evidence: .sisyphus/evidence/task-2-demo.txt

  Scenario: Invalid file and parser failure stay recoverable
    Tool: Bash
    Steps: run `yarn test:run test/demo.test.tsx`
    Expected: suite contains one case where non-PDF selection never calls parser and another where parser rejection shows an inline error while keeping the picker visible
    Evidence: .sisyphus/evidence/task-2-demo-error.txt
  ```

  **Commit**: YES | Message: `feat(demo): add local pdf upload and parse flow` | Files: `demo/App.tsx`, `test/demo.test.tsx`, `package.json`

- [ ] 3. Implement Reader height reservation and viewport windowing shell

  **What to do**: 把 `Reader` 从“只显示标题”升级为真正的阅读器外壳，但此任务先只完成 **几何与窗口化**，不在这里渲染真实文本。新增内部模块：`src/lib/readerLayout.ts`（负责从 `document.pageNumbers`、`getPageSizeByPageNumber(pageNumber)`、容器宽度、`PAGE_GAP=24`、`PAGE_MAX_WIDTH=960`、`HORIZONTAL_PADDING=24` 计算每页的缩放宽高、`top` 偏移和总高度）、`src/lib/useReaderWindow.ts`（基于 `scrollTop`、`viewportHeight` 以及“上下各 1 个视口 overscan”计算当前应挂载页码范围），以及 `src/components/ReaderPageShell.tsx`（只输出定位好的页面白底占位壳）。`Reader` 根节点固定为一个可滚动容器，内部使用一个 `position: relative` 的总画布承载所有页位；总画布高度必须等于所有页缩放后高度之和再加页间距。只为处于窗口范围内的页渲染 `ReaderPageShell`，窗口外的页只保留空间，不挂载 DOM。通过 `ResizeObserver` 监听容器宽度变化并重算布局；滚动监听使用 `requestAnimationFrame` 节流，避免每次 `scroll` 直接 setState。
  **Must NOT do**: 不在本任务调用 `page.getTexts()`；不把所有页面壳都挂进 DOM；不引入 `react-virtual`、`react-window` 等库；不把布局常量做成公开 props；不把页面放进普通文档流导致滚动高度失真。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 该任务主要是窗口化数学、布局缓存和 React 生命周期控制。
  - Skills: `[]` — 不需要外部技能。
  - Omitted: `['frontend-ui-ux']` — 重点是性能与正确性，不是美术打磨。

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: Task 4, Task 5 | Blocked By: Task 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src/components/Reader.tsx:9` — 当前公共组件入口必须继续作为总控，而不是新增第二个公开入口。
  - Pattern: `src/styles/reader.scss:1` — 当前样式几乎为空，说明页面壳、滚动容器和占位高度样式都需要在现有样式入口内扩展。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:210` — `pageCount` 可用来快速识别空文档。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:214` — `pageNumbers` 提供稳定页序。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:233` — `getPageSizeByPageNumber(pageNumber)` 是预估高度的唯一合法数据源。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/HtmlParser/src/lazyLoadPage.ts:3` — 既有实现已经证明“先建页面容器，再按需填内容”是可行模式。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/E-Ink-web/src/reader/renderer.ts:97` — 旧阅读器在测量/缓存上强调避免重复计算；本次应同样缓存布局计算结果。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且至少一条测试断言总高度等于所有页缩放高度之和再加固定 `24px` 页间距。
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且至少一条测试断言初始只挂载可视区附近页，而不是整本文档所有页。
  - [ ] `yarn typecheck` 通过，且布局/窗口化辅助模块无 `any`。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Scroll height is reserved before page content loads
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx`
    Expected: suite contains a layout test using a fake document with known page sizes and asserts the inner canvas height equals scaled page heights plus fixed page gaps before any text fetch occurs
    Evidence: .sisyphus/evidence/task-3-windowing.txt

  Scenario: Mounted pages stay bounded to viewport window
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx`
    Expected: suite contains a virtualization test proving off-screen pages are absent from the DOM until scroll position moves them into the overscanned range
    Evidence: .sisyphus/evidence/task-3-windowing-error.txt
  ```

  **Commit**: YES | Message: `feat(reader): reserve total height and virtualize page shells` | Files: `src/components/Reader.tsx`, `src/components/ReaderPageShell.tsx`, `src/lib/normalizeDocument.ts`, `src/lib/readerLayout.ts`, `src/lib/useReaderWindow.ts`, `src/styles/reader.scss`, `test/reader.test.tsx`

- [ ] 4. Render positioned page content with lazy page/text loading

  **What to do**: 在 Task 3 的页面壳基础上新增 `src/components/ReaderPage.tsx` 与 `src/components/ReaderTextLayer.tsx`。`Reader` 对窗口内页不再直接渲染 `ReaderPageShell`，而是渲染 `ReaderPage`；`ReaderPage` 负责在挂载时调用 `document.getPageByPageNumber(pageNumber)`，成功后再调用 `page.getTexts()`，并把结果交给 `ReaderTextLayer`。在内容加载完成前，页面保持固定尺寸白底骨架；任一 Promise 失败时，在该页位置内显示页级错误卡片，但不影响其他页和整体滚动。`ReaderTextLayer` 必须逐条渲染 `IntermediateText`：容器 `position: absolute`，以页面左上为原点；`x/y < 1` 解释为百分比，否则解释为像素并乘以页面缩放；`fontSize < 1` 解释为 `em`，否则按像素乘缩放；`width/height/lineHeight >= 1` 时按像素乘缩放；`rotate` / `skew` 映射到 `transform`；`vertical=true` 时映射到 `writing-mode: vertical-rl`；`dir` 映射到 `direction`；所有文本节点统一 `transform-origin: top left`。文本层只渲染文字，不补图片、背景图或 canvas。
  **Must NOT do**: 不在这里补充缩略图栏；不调用 `getThumbnail()` 作为主阅读渲染路径；不把所有文本合并成普通文档流段落；不让单页失败导致整个 Reader 崩溃；不忽略 `x/y/fontSize` 的百分比或 `em` 语义。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 该任务兼具页面视觉拟真、定位文本渲染与懒加载态设计。
  - Skills: `[]` — 现有仓库模式已足够提供参考。
  - Omitted: `['frontend-ui-ux']` — 本任务重点是基于现有中间态精确落地，而非重新设计视觉体系。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Task 5, Task 6 | Blocked By: Task 1, Task 3

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src/components/Reader.tsx:19` — 当前组件根节点已存在，页面内容必须继续从这个组件派生，而不是新增独立公共组件。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:229` — `getPageByPageNumber(pageNumber)` 是单页懒加载入口。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediatePage.ts:80` — `page.getTexts()` 是文本层按需加载入口。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediatePage.ts:95` — `hasLoadedTexts` 可用于避免重复判断或优化断言。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateText.ts:7` — 文本模型字段与坐标/字体语义定义。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/HtmlParser/src/lazyLoadPage.ts:3` — 页面容器尺寸必须先于内容渲染存在。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且至少一条测试断言某页进入可视窗口后才调用对应的 `getPageByPageNumber(pageNumber)` / `page.getTexts()`。
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且至少一条测试断言文本节点使用绝对定位并能渲染出 `IntermediateText.content`。
  - [ ] `yarn build:lib` 通过，证明新增页面/文本层模块不会破坏库构建。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Visible pages lazy-load their text only when mounted
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx`
    Expected: suite contains a test with mocked `getPageByPageNumber` / `getTexts` call counters, proving off-screen pages are not fetched until scroll moves them into range
    Evidence: .sisyphus/evidence/task-4-page-render.txt

  Scenario: Page-level load failure is isolated
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx`
    Expected: suite contains a case where one page rejects during lazy load and the DOM shows a page-local error card while neighboring pages still render
    Evidence: .sisyphus/evidence/task-4-page-render-error.txt
  ```

  **Commit**: YES | Message: `feat(reader): render positioned text pages lazily` | Files: `src/components/Reader.tsx`, `src/components/ReaderPage.tsx`, `src/components/ReaderTextLayer.tsx`, `src/styles/reader.scss`, `test/reader.test.tsx`

- [ ] 5. Polish integrated reader states, compatibility, and performance guards

  **What to do**: 对 `demo/` 与 `Reader` 做最后一轮集成打磨，确保所有状态闭环。`Reader` 对于 `null` 文档或 `pageCount === 0` 统一回退到 `emptyText`，避免空 PDF 进入坏态；对已归一化文档要缓存布局结果，只有容器宽度变更或文档 ID 变化时才重算。滚动监听、`ResizeObserver` 和任何异步页加载 effect 必须在卸载时清理，防止 demo 下内存泄漏或重复回调。`demo/App.tsx` 中 parsing 态必须显示明确的“解析中”文案并禁用文件输入；error 态必须显示用户可读错误，并保证用户无需刷新即可重选文件。`src/styles/reader.scss` 需要补齐阅读容器、页面阴影、页面间距、骨架态、页级错误卡片、demo 上传区与重新选择按钮所需的基础样式，但这些样式仍应维持 `hamster-` 前缀和组件库风格。补充并收敛测试：覆盖 `emptyText` 回退、零页文档、重新选择文件恢复到 idle、解析失败恢复、StrictMode 下不因副作用清理问题抛错。
  **Must NOT do**: 不新增全局状态管理器；不把 demo 状态塞进 Reader 公共 props；不加入持久化或最近文件；不把错误对象直接原样暴露给用户；不为“性能优化”而提前预取窗口外大量页。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 需要同时收口状态机、兼容性、资源清理和样式一致性。
  - Skills: `[]` — 不需要额外技能。
  - Omitted: `['playwright']` — 本任务仍然依赖 focused test + 构建检查完成验证。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Task 6 | Blocked By: Task 2, Task 3, Task 4

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `demo/App.tsx:11` — 当前 demo 主组件已是所有上传/错误/阅读状态的唯一入口。
  - Pattern: `src/styles/reader.scss:1` — 所有公开阅读器样式都从这里产出到 `@hamster-note/reader/style.css`。
  - Test: `test/reader.test.tsx:18` — 现有 `Reader` 测试组织方式应继续沿用，扩展兼容和失败路径。
  - Test: `test/smoke.test.tsx:14` — 测试风格偏轻量，说明新增断言应聚焦行为而非实现细节。
  - CI: `.github/workflows/ci-pr.yml:36` — 最终集成必须同时满足 lint、typecheck、test、build 四类验证。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx test/demo.test.tsx` 通过，且覆盖零页文档、重新选择文件、解析失败恢复、页级失败隔离。
  - [ ] `yarn lint && yarn typecheck` 通过，证明状态清理与样式类名扩展后仍满足仓库规则。
  - [ ] `yarn build:all` 通过，证明库与 demo 集成态均可构建。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Integrated states remain recoverable
    Tool: Bash
    Steps: run `yarn test:run test/reader.test.tsx test/demo.test.tsx`
    Expected: suite contains cases proving parse failure keeps the picker usable, reselect resets previous document state, and zero-page documents fall back to `emptyText`
    Evidence: .sisyphus/evidence/task-5-integration.txt

  Scenario: Full project validation stays green
    Tool: Bash
    Steps: run `yarn lint && yarn typecheck && yarn build:all`
    Expected: all commands exit 0 with no leaked observer warnings, missing-style errors, or build failures
    Evidence: .sisyphus/evidence/task-5-integration-error.txt
  ```

  **Commit**: YES | Message: `fix(reader): harden integrated states and recovery paths` | Files: `demo/App.tsx`, `src/components/Reader.tsx`, `src/styles/reader.scss`, `test/reader.test.tsx`, `test/demo.test.tsx`

- [ ] 6. Document the parser workflow and record release notes

  **What to do**: 更新 `README.md`，保留当前“显式引入 `@hamster-note/reader/style.css`”契约，同时新增两段信息：1) `Reader` 现在既接受 `IntermediateDocumentSerialized`，也接受 `IntermediateDocument`；2) 如果调用方希望像 demo 一样在浏览器里选择本地 PDF 并先解析，再传给 `Reader`，则应在自己的应用里额外安装 `@hamster-note/pdf-parser`，并使用 `PdfParser.encode(file)`。README 示例必须给出完整的最小接线片段，而不是只描述概念。同步更新 `CHANGELOG.md` 的 `[Unreleased] -> Added`，新增本次功能的 2-4 条 bullet，涵盖“本地 PDF demo 上传流”“惰性文档渲染”“滚动高度占位/窗口化”。
  **Must NOT do**: 不把 demo 专属 UI 文案写成公共 API 契约；不暗示库自身会解析 PDF 文件；不删除已有安装、脚本与发版说明；不把 changelog 写到 `[Unreleased]` 以外的版本节。

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: 此任务主要是面向使用者的技术文档和发布记录收口。
  - Skills: `[]` — 仓库已有文档样式清晰。
  - Omitted: `['pre-publish-review']` — 当前不是发版前总检，而是文档更新。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: none | Blocked By: Task 1, Task 2, Task 5

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `README.md:15` — 当前 README 已明确样式需手动引入，新文档必须延续这条公开契约。
  - Pattern: `README.md:17` — 现有使用示例是修改的直接落点，应替换为兼容新输入契约的示例。
  - Pattern: `CHANGELOG.md:8` — 变更记录当前停留在 `[Unreleased]`，本次新增项必须写入这里。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/PdfParser/src/index.ts:39` — README 示例中 parser 接线应与真实 API 签名一致。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:152` — README 必须说明 `IntermediateDocument` 可直接传给 `Reader`。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `rg "PdfParser\.encode\(file\)|IntermediateDocumentSerialized|IntermediateDocument" README.md` 能命中新的使用说明。
  - [ ] `rg "lazy|PDF|window|scroll|IntermediateDocument" CHANGELOG.md` 能命中新增的 `[Unreleased]` 条目。
  - [ ] `yarn test:run && yarn build:all` 在文档更新后仍通过，证明示例与实现未脱节。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: README documents the optional parser workflow
    Tool: Bash
    Steps: run `rg "PdfParser\.encode\(file\)|@hamster-note/pdf-parser|@hamster-note/reader/style.css" README.md`
    Expected: output proves README documents explicit style import plus the optional local-PDF parsing flow before rendering Reader
    Evidence: .sisyphus/evidence/task-6-docs.txt

  Scenario: CHANGELOG records the new reader capability
    Tool: Bash
    Steps: run `rg "Unreleased|PDF|lazy|scroll|Reader" CHANGELOG.md`
    Expected: output shows new `[Unreleased]` bullets describing the PDF upload demo and lazy reader rendering improvements
    Evidence: .sisyphus/evidence/task-6-docs-error.txt
  ```

  **Commit**: YES | Message: `docs(reader): document pdf parsing and lazy rendering flow` | Files: `README.md`, `CHANGELOG.md`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle

  **What to do**: 让 `oracle` 基于 `.sisyphus/plans/pdf-reader-page.md`、最终代码 diff、以及 `.sisyphus/evidence/task-*.{txt,md}` 逐项核对 Task 1-6 的 Acceptance Criteria 是否全部被满足，尤其检查依赖分层、向后兼容输入、窗口化范围、README/CHANGELOG 更新是否与计划一致。
  **Acceptance Criteria**:
  - [ ] `oracle` 明确给出 “pass / fail” 结论，并指出对应 Task 编号。
  - [ ] 审计结果覆盖 Task 1-6 全部任务，而非只看最新提交。
  - [ ] 若存在偏差，输出必须精确定位到任务编号和文件路径。

  **QA Scenarios**:
  ```
  Scenario: Plan compliance is audited against all task outcomes
    Tool: task (oracle)
    Steps: review `.sisyphus/plans/pdf-reader-page.md`, implementation diff, and `.sisyphus/evidence/task-1-*.txt` through `.sisyphus/evidence/task-6-*.txt`; map each delivered change back to Task 1-6 acceptance criteria
    Expected: oracle returns a binary pass/fail verdict with explicit references to any unmet task criteria
    Evidence: .sisyphus/evidence/f1-plan-compliance.md
  ```

- [ ] F2. Code Quality Review — unspecified-high

  **What to do**: 让高强度代码审查 agent 检查最终实现是否满足仓库编码约束：无 `any` 逃逸、无不必要依赖、无把 parser 拉进公共运行时依赖、无明显性能反模式（如预加载整本文本、挂载全部页 DOM）。
  **Acceptance Criteria**:
  - [ ] 审查覆盖 `package.json`、`demo/`、`src/`、`test/`、`README.md`、`CHANGELOG.md` 的最终改动。
  - [ ] 明确指出是否存在类型、性能、可维护性或边界越界问题。
  - [ ] 审查结论为 pass 时，不再留下“建议但未决策”的模糊项。

  **QA Scenarios**:
  ```
  Scenario: Final diff passes code quality review
    Tool: task (unspecified-high)
    Steps: inspect final diff across `package.json`, `demo/`, `src/`, `test/`, `README.md`, and `CHANGELOG.md`; check for `any`, unnecessary parser runtime coupling, full-document eager loading, and cleanup omissions
    Expected: reviewer returns pass/fail and lists only concrete code-quality defects if any remain
    Evidence: .sisyphus/evidence/f2-code-quality.md
  ```

- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)

  **What to do**: 在无现成 Playwright 基建的前提下，执行真实运行态 QA：启动 demo、上传一个真实 PDF、确认同页切换、长文档滚动、高度占位、重新选择文件、非法文件和解析失败路径。若执行阶段已新增 Playwright，则优先使用 Playwright；否则使用 `Bash` 启动服务 + 人工驱动最小浏览器自动化或记录性 QA 流程。
  **Acceptance Criteria**:
  - [ ] 成功覆盖有效 PDF、非法文件、解析失败、重新选择文件、长文档滚动五类核心场景。
  - [ ] 输出必须包含每个场景的结果，而不是只写“手测通过”。
  - [ ] 若发现问题，必须给出复现步骤与观察结果。

  **QA Scenarios**:
  ```
  Scenario: Demo behaves correctly with a real PDF file
    Tool: Bash / Playwright
    Steps: start the demo with `yarn dev --host 127.0.0.1 --strictPort`; open the app; upload a real `.pdf`; verify same-page transition into Reader, long-scroll behavior, and reselect flow; then retry with an invalid file and a mocked parser-failure path if available
    Expected: all core user flows behave as planned, and any failure is captured with exact reproduction notes
    Evidence: .sisyphus/evidence/f3-manual-qa.md
  ```

- [ ] F4. Scope Fidelity Check — deep

  **What to do**: 让 `deep` agent 从范围控制角度复核最终结果，确认没有偷偷扩展到搜索、缩放、侧栏、持久化、canvas PDF viewer、非 PDF 支持等计划外功能，也没有因为实现偷懒而退化成只显示标题/纯文本列表。
  **Acceptance Criteria**:
  - [ ] 审查明确覆盖“计划外新增功能”和“计划内能力缺失”两个方向。
  - [ ] 输出必须明确说明结果是否仍然满足“页面拟真 + 懒加载 + 正确滚动高度 + demo 上传流”四个核心目标。
  - [ ] 若 scope 偏移，必须指出是 over-build 还是 under-deliver。

  **QA Scenarios**:
  ```
  Scenario: Delivered scope matches the approved plan exactly
    Tool: task (deep)
    Steps: compare `.sisyphus/plans/pdf-reader-page.md` against the final delivered behavior and changed files; verify no extra viewer features were added and no core planned behaviors were omitted
    Expected: deep reviewer returns pass/fail with explicit over-scope or under-delivery findings if mismatches exist
    Evidence: .sisyphus/evidence/f4-scope-fidelity.md
  ```

## Commit Strategy
- Commit 1: `feat(reader): add lazy document contract and parser-ready demo foundation`
- Commit 2: `feat(demo): add local pdf selection and parse state flow`
- Commit 3: `feat(reader): reserve full scroll height and virtualize mounted pages`
- Commit 4: `feat(reader): render positioned text pages with lazy page loading`
- Commit 5: `fix(reader): harden integrated states and recovery paths`
- Commit 6: `docs(reader): document pdf parser workflow`

## Success Criteria
- 用户在本地 demo 首页只能选择 PDF；非法文件不会进入解析链路。
- 选择有效 PDF 后，同页切换到 Reader 视图，且可回到上传态重新选择文件。
- 大文档不会一次性挂载所有页；滚动条长度与文档总高度一致。
- `Reader` 仍可渲染旧的 `IntermediateDocumentSerialized` 输入。
- 页面显示为“页面容器 + 定位文本层”的拟真阅读效果，而不是单纯标题或纯文本列表。
- 文档与变更说明足以让后续使用者知道何时需要额外安装 `@hamster-note/pdf-parser`。
