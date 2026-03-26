# Reader Demo PDF JSON 分页预览

## TL;DR
> **Summary**: 在 demo 层接入 `@hamster-note/pdf-parser` 的上传解析流程，把 `PdfParser.encode()` 结果序列化为 `IntermediateDocumentSerialized` 后传给 `Reader`；`Reader` 默认展示第一页的格式化 JSON，并提供上一页/下一页切换。
> **Deliverables**:
> - demo 上传 → encode → serialize → 传入 `Reader`
> - `Reader` 当前页 JSON 预览、上一页/下一页按钮、零页兜底
> - demo loading / parse failure 状态
> - Vitest 自动化覆盖 Reader 与 demo 全链路状态
> **Effort**: Medium
> **Parallel**: NO
> **Critical Path**: 1 → 2 → 3 → 4 → 5

## Context
### Original Request
增加文档解析功能，上传文档之后，通过 `pdf-parser encode`，得到中间文档，默认展示第一页的数据，只展示序列化之后、格式化过的 JSON，并增加上一页和下一页按钮，点击后切换 JSON。

### Interview Summary
- `pdf-parser` 明确为 `@hamster-note/pdf-parser`
- `Reader` 组件入参继续保持“处理之后的中间文档数据”，不在 `Reader` 内做解析
- demo 负责上传文件、调用 `PdfParser.encode`、再调用 `IntermediateDocument.serialize`
- 范围包含 loading 与解析失败态
- 自动化测试采用现有 `Vitest + @testing-library/react`，策略为 tests-after

### Metis Review (gaps addressed)
- 固定边界：`Reader` 只做 viewer；解析、错误恢复、loading 全在 demo 层处理
- 固定重传入口：初始上传走 `Reader` upload zone；成功态二次上传走 demo 外层隐藏 input + `Upload Another PDF` 按钮
- 固定导入方式：demo 使用动态导入 `@hamster-note/pdf-parser`，避免把解析器耦合进库运行时
- 固定失败模型：同时覆盖 `encode()` 返回 `undefined` 与抛错/拒绝两种失败路径
- 固定默认行为：新文件开始解析时清空旧的解析结果；零页文档显示 `No pages available`；仅显示当前页 JSON，不扩展成整份文档浏览器

## Work Objectives
### Core Objective
让 `reader` 仓库的 demo 能够上传 PDF、调用 `@hamster-note/pdf-parser` 生成中间文档、序列化后传给 `Reader`，并由 `Reader` 以格式化 JSON 方式展示当前页数据，默认第一页，可通过上一页/下一页切换。

### Deliverables
- `reader/demo/App.tsx`：异步解析状态机（idle/loading/success/error）
- `reader/demo/App.tsx`：成功态下的二次上传入口（demo 外层 uploader，不修改 `ReaderProps`）
- `reader/package.json`：仅供 demo / test 使用的 `@hamster-note/pdf-parser` 依赖接入
- `reader/src/components/Reader.tsx`：当前页 JSON 预览 + 翻页按钮 + 零页兜底
- `reader/src/styles/reader.scss`：JSON 预览、导航按钮、零页提示样式
- `reader/test/reader.test.tsx`：Reader 当前页/边界/零页覆盖
- `reader/test/demo.test.tsx`：demo 成功/失败/loading/retry 覆盖

### Definition of Done (verifiable conditions with commands)
- `yarn test:run test/reader.test.tsx test/demo.test.tsx` 通过
- `yarn typecheck` 通过
- `yarn build:demo` 通过
- 上传有效 PDF 后，demo 出现 `Parsing PDF...`，完成后 `Reader` 默认展示第一页格式化 JSON
- 当 JSON 页码位于第一页时上一页按钮禁用；位于最后一页时下一页按钮禁用
- `PdfParser.encode()` 返回 `undefined` 或抛错时，demo 显示 `Failed to parse PDF`，且不保留旧的成功预览

### Must Have
- demo 动态导入 `@hamster-note/pdf-parser`
- 解析成功后调用 `IntermediateDocument.serialize()` 再传给 `Reader`
- 成功态必须存在 demo 级 `Upload Another PDF` 入口，不能依赖 `Reader` 在 `document` 存在时继续暴露上传壳
- `Reader` 使用 `document.pages[currentIndex]` 生成 `JSON.stringify(page, null, 2)`
- 初始页索引固定为第一页（索引 `0` / 页码 `1`）
- 文档变化时重置当前页到第一页
- 零页文档有稳定兜底 UI，且前后按钮禁用
- loading 使用 `role="status"`，错误使用 `role="alert"`

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不把 PDF 解析逻辑放进 `src/components/Reader.tsx`
- 不让 `Reader` 接收 `File`、`Promise`、`PdfParser` 实例或解析配置
- 不展示整份文档 JSON，不增加 JSON tree、编辑器、搜索、缩放、导出
- 不新增 Playwright / E2E 基建
- 不修改 `src/index.ts` 的公开导出契约
- 不把 `@hamster-note/pdf-parser` 放入会影响发布库运行时的公开 API 层

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: tests-after + `Vitest` / `@testing-library/react`
- QA policy: 每个任务都含 agent-executed 场景；所有成功/失败/边界状态均用自动化断言固定
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> 本任务高度共享 `Reader` / `demo/App.tsx` 文件，按顺序执行更稳妥；不强行拆并行波次。

Wave 1: Task 1（Reader 当前页 JSON 基线）
Wave 2: Task 2（Reader 翻页与零页兜底）
Wave 3: Task 3（demo 成功路径 + 依赖接入）
Wave 4: Task 4（demo loading / error / retry）
Wave 5: Task 5（回归收口：类型、构建、测试选择器稳定性）

### Dependency Matrix (full, all tasks)
| Task | Depends On | Notes |
|---|---|---|
| 1 | none | 先固定 Reader 对 `document.pages` 的展示契约 |
| 2 | 1 | 翻页逻辑依赖 Task 1 的当前页 JSON 容器 |
| 3 | 1, 2 | demo 成功路径依赖 Reader 已可展示序列化页数据 |
| 4 | 3 | 失败/重试在 demo 成功状态机基础上扩展 |
| 5 | 1, 2, 3, 4 | 最终稳定性与回归收口 |

### Agent Dispatch Summary (wave → task count → categories)
| Wave | Task Count | Recommended Categories |
|---|---:|---|
| 1 | 1 | `quick` |
| 2 | 1 | `visual-engineering` |
| 3 | 1 | `quick` |
| 4 | 1 | `quick` |
| 5 | 1 | `unspecified-low` |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. 让 `Reader` 默认展示第一页格式化 JSON

  **What to do**:
  - 在 `src/components/Reader.tsx` 中把“有 document 时只显示标题”的逻辑替换为“有 pages 时显示当前页 JSON”。
  - 新增 `currentPageIndex` 本地状态，初始值固定为 `0`。
  - 新增文档切换重置逻辑：当 `document?.id` 变化时，把 `currentPageIndex` 重置为 `0`。
  - 当前页 JSON 必须来源于 `document.pages[currentPageIndex]`，并使用 `JSON.stringify(currentPage, null, 2)` 渲染到 `<pre>` 容器。
  - JSON 容器固定使用 `data-testid="reader-json-preview"`；保留 `reader-root`、`reader-content` 既有测试钩子。
  - `document` 为空时继续保留现有 upload zone / emptyText 逻辑；不得影响 `onFileUpload` 回调行为。
  - 在 `test/reader.test.tsx` 中把公开 API 用例改为断言第一页 JSON，而不是标题文本；`emptyText` 用例继续保留。

  **Must NOT do**:
  - 不在 `Reader` 内调用 `PdfParser.encode()` 或 `IntermediateDocument.serialize()`。
  - 不把整份 `document` JSON 一次性渲染出来；只渲染当前页对象。
  - 不删除 upload zone/file info 现有行为。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 主要集中在单组件状态与单测更新
  - Skills: `[]` — 不需要额外技能
  - Omitted: `['/frontend-ui-ux']` — 当前任务以行为正确性为主，不涉及复杂视觉设计

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked By: []

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `reader/src/components/Reader.tsx:17-38` — 现有本地状态与 `handleFile` 写法，沿用同一 hooks 风格
  - Pattern: `reader/src/components/Reader.tsx:90-142` — 现有 `showUploadZone/showDocumentContent/showFileInfo` 条件渲染入口
  - API/Type: `types/src/HamsterDocument/IntermediatePage.ts:6-14` — 单页序列化结构（`id/texts/width/height/number/thumbnail`）
  - API/Type: `reader/src/components/Reader.tsx:4-9` — 当前 `ReaderProps`，不得改成接收 `File` 或 parser 类型
  - Test: `reader/test/reader.test.tsx:29-47` — 公开 API 测试块，需改成第一页 JSON 断言

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且新增断言验证 `data-testid="reader-json-preview"` 存在
  - [ ] 使用包含两页数据的 `document` 渲染时，初始 JSON 输出包含第一页字段（例如 `"number": 1`）而不包含第二页字段
  - [ ] `document={null}` 时，`emptyText` 仍按现有行为显示
  - [ ] 重新传入不同 `document.id` 的文档时，Reader 会从第一页重新开始展示

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Reader 初始渲染第一页 JSON
    Tool: Bash
    Steps: 在 `test/reader.test.tsx` 中构造 2 页 `IntermediateDocumentSerialized` fixture；运行 `yarn test:run test/reader.test.tsx`
    Expected: 用例断言 `reader-json-preview` 含有格式化 JSON 片段 `"number": 1`，且不含第二页唯一文本
    Evidence: .sisyphus/evidence/task-1-reader-first-page.txt

  Scenario: 空文档仍显示 emptyText
    Tool: Bash
    Steps: 运行 `yarn test:run test/reader.test.tsx`
    Expected: `document={null}` 用例仍通过，并断言根节点包含 `Nothing to render`
    Evidence: .sisyphus/evidence/task-1-reader-empty-state.txt
  ```

  **Commit**: NO | Message: `feat(reader): render serialized page json preview` | Files: `src/components/Reader.tsx`, `test/reader.test.tsx`

- [ ] 2. 为 `Reader` 增加翻页按钮、边界禁用与零页兜底

  **What to do**:
  - 在 `src/components/Reader.tsx` 的 JSON 预览区域内新增导航容器，按钮文案固定为 `Previous Page` 与 `Next Page`。
  - 按钮固定使用 `data-testid="reader-prev-page-btn"` 与 `data-testid="reader-next-page-btn"`。
  - `currentPageIndex === 0` 时禁用上一页按钮；`currentPageIndex === document.pages.length - 1` 时禁用下一页按钮。
  - 当 `document.pages.length === 0` 时，不渲染 `<pre>` JSON，改为显示 `No pages available`，容器使用 `data-testid="reader-empty-pages"`，同时两个按钮都禁用。
  - 在 `src/styles/reader.scss` 中新增 `hamster-reader__json-preview`、`hamster-reader__page-nav`、`hamster-reader__page-button`、`hamster-reader__empty-pages` 样式；按钮视觉基于现有 `__upload-another` 风格扩展，不重做整套主题。
  - 在 `test/reader.test.tsx` 中增加翻页成功、第一页禁用、最后一页禁用、零页兜底用例。

  **Must NOT do**:
  - 不新增页码输入框、跳页、分页器、页缩略图。
  - 不把按钮放到 demo 层；翻页属于 `Reader` viewer 责任。
  - 不删除已有 upload/file-info 区域样式。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 需要同时调整组件结构、交互状态和样式
  - Skills: `[]` — 无额外技能依赖
  - Omitted: `['/frontend-ui-ux']` — 仅做最小样式扩展，不需要大规模设计探索

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [3, 4, 5] | Blocked By: [1]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `reader/src/components/Reader.tsx:138-176` — 现有内容区与 file-info 区的 DOM 结构，新增导航应落在内容区内部
  - Pattern: `reader/src/styles/reader.scss:84-156` — `__content` 与 `__upload-another` 现有视觉风格，可直接延展按钮和预览样式
  - API/Type: `types/src/HamsterDocument/IntermediatePage.ts:33-42` — 页面序列化字段，按钮切换的对象即该结构
  - Test: `reader/test/reader.test.tsx:49-159` — 现有测试偏好 `data-testid` 与交互断言风格

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx` 通过，且新增翻页/边界/零页用例全部为绿
  - [ ] 点击 `Next Page` 后，`reader-json-preview` 显示第二页 JSON；点击 `Previous Page` 后返回第一页 JSON
  - [ ] 第一页时 `reader-prev-page-btn` 为禁用态；最后一页时 `reader-next-page-btn` 为禁用态
  - [ ] 零页文档时显示 `No pages available`，且两个导航按钮都禁用

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Reader 翻到下一页再返回上一页
    Tool: Bash
    Steps: 在 `test/reader.test.tsx` 中使用 `userEvent.click` 点击 `reader-next-page-btn` 与 `reader-prev-page-btn`；运行 `yarn test:run test/reader.test.tsx`
    Expected: JSON 预览先出现第二页唯一字段，再恢复第一页唯一字段
    Evidence: .sisyphus/evidence/task-2-reader-pagination.txt

  Scenario: 零页文档稳定兜底
    Tool: Bash
    Steps: 运行 `yarn test:run test/reader.test.tsx`
    Expected: `reader-empty-pages` 显示 `No pages available`，并断言两个按钮 `toBeDisabled()`
    Evidence: .sisyphus/evidence/task-2-reader-zero-pages.txt
  ```

  **Commit**: NO | Message: `feat(reader): add page navigation for json preview` | Files: `src/components/Reader.tsx`, `src/styles/reader.scss`, `test/reader.test.tsx`

- [ ] 3. 在 demo 层接入 `@hamster-note/pdf-parser` 成功路径

  **What to do**:
  - 在 `reader/package.json` 中把 `@hamster-note/pdf-parser` 加到 `devDependencies`，不要加到 `dependencies`。
  - 将 `demo/App.tsx` 改为只有一个上传驱动的演示区；删除当前静态 `demoDocument` 展示区与 `Last Uploaded File` 摘要区，避免与真实解析流冲突。
  - 在 demo 顶层新增隐藏 `<input type="file" accept=".pdf,application/pdf">` 与一个仅在 `parsedDocument` 存在时显示的 `Upload Another PDF` 按钮；按钮点击只触发该 input，二次上传入口固定在 demo 层，不修改 `ReaderProps`。
  - 在 `demo/App.tsx` 中新增 `parsedDocument`, `isParsing`, `parseError` 三个状态，类型分别为 `IntermediateDocumentSerialized | null`、`boolean`、`string | null`。
  - 把 `handleFileUpload` 改成 `async`：
    1. `setParseError(null)`
    2. `setParsedDocument(null)`
    3. `setIsParsing(true)`
    4. 动态导入 `@hamster-note/pdf-parser`
    5. `const arrayBuffer = await file.arrayBuffer()`
    6. `const intermediate = await PdfParser.encode(arrayBuffer)`
    7. 若结果为空，抛出 `new Error('Encode returned empty result')`
    8. `const serialized = await IntermediateDocument.serialize(intermediate)`
    9. `setParsedDocument(serialized)`
    10. `setIsParsing(false)`（放在 `finally`）
  - `Reader` 调用固定为 `document={parsedDocument}`、`onFileUpload={handleFileUpload}`、`emptyText='No document loaded'`；当 `parsedDocument` 存在时，Reader 只负责 viewer，二次上传由 demo 外层按钮负责。
  - 在 `test/demo.test.tsx` 中创建 demo 成功路径测试：mock parser 返回可序列化中间文档、mock `IntermediateDocument.serialize()` 返回两页 JSON，断言成功后 `Reader` 渲染第一页 JSON，且页面出现 `Upload Another PDF` 按钮。

  **Must NOT do**:
  - 不在 `Reader` 源码里静态 import `@hamster-note/pdf-parser`。
  - 不把 parser 依赖暴露到 `src/index.ts` 或 `ReaderProps`。
  - 不保留与真实解析结果无关的静态示例区块。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: demo 状态机与依赖接入明确，改动面集中
  - Skills: `[]` — 无需额外技能
  - Omitted: `['/git-master']` — 当前是规划内实现任务，不涉及即时 git 操作

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [4, 5] | Blocked By: [1, 2]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `reader/demo/App.tsx:13-45` — 当前 demo 上传回调位置与现有 `Reader` 使用方式
  - Pattern: `hamster-convertor/src/lib/converter.ts:19-24` — monorepo 内动态导入 `@hamster-note/pdf-parser` 的既有模式
  - Pattern: `PdfParser/demo/demo.js:168-203` — browser 侧 encode 成功路径、`try/catch` 与格式化 JSON 展示样式
  - API/Type: `PdfParser/src/pdfParser.ts:44-67` — `PdfParser.encode(fileOrBuffer)` 返回 `Promise<IntermediateDocument | undefined>`
  - API/Type: `types/src/HamsterDocument/IntermediateDocument.ts:169-185` — `IntermediateDocument.serialize()` 的异步序列化契约
  - Config: `reader/package.json:28-43` — 可用于验证的脚本命令
  - Config: `reader/vite.config.ts:28-36` — test include 规则，允许新增 `test/demo.test.tsx`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/demo.test.tsx` 通过，成功路径用例断言第一页 JSON 出现在页面中
  - [ ] `yarn build:demo` 通过，证明 demo 侧动态导入和依赖解析可用
  - [ ] 上传开始后出现 `Parsing PDF...` 状态；成功后消失
  - [ ] 成功路径中 `Reader` 接收到的是序列化结果，不是 `IntermediateDocument` 实例本身
  - [ ] 成功解析后页面出现 demo 级 `Upload Another PDF` 按钮，可作为二次上传入口

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: demo 上传成功后展示第一页 JSON
    Tool: Bash
    Steps: 在 `test/demo.test.tsx` 中 mock `@hamster-note/pdf-parser` 与 `IntermediateDocument.serialize()`；运行 `yarn test:run test/demo.test.tsx`
    Expected: 上传 PDF 后先看到 `Parsing PDF...`，随后页面出现 `reader-json-preview` 且包含第一页 `"number": 1`，并显示 `Upload Another PDF`
    Evidence: .sisyphus/evidence/task-3-demo-success.txt

  Scenario: demo 构建仍可打包
    Tool: Bash
    Steps: 运行 `yarn build:demo`
    Expected: Vite demo build 成功结束，无 `@hamster-note/pdf-parser` 解析失败错误
    Evidence: .sisyphus/evidence/task-3-demo-build.txt
  ```

  **Commit**: NO | Message: `feat(demo): parse uploaded pdf into reader preview` | Files: `package.json`, `demo/App.tsx`, `test/demo.test.tsx`

- [ ] 4. 固化 demo 的 loading、失败与重试状态机

  **What to do**:
  - 在 `demo/App.tsx` 中用统一错误文案 `Failed to parse PDF` 处理两类失败：`encode()` 返回 `undefined`，以及 `encode()` / `serialize()` 抛错或 reject。
  - 在上传开始时立即 `setParsedDocument(null)`，确保新一次解析不会保留旧的成功预览。
  - 在 demo 中渲染 `role="status"` 的 loading 区与 `role="alert"` 的错误区；这两个区域放在 `Reader` 外层，不把 loading/error 状态下沉到 `ReaderProps`。
  - 失败态保留 `Reader` 现有上传壳作为 retry 入口；成功态二次上传必须通过 Task 3 定义的 demo 级 `Upload Another PDF` 按钮触发。
  - 在 `test/demo.test.tsx` 中增加三个用例：
    1. `encode()` 返回 `undefined`
    2. `encode()` reject / throw
    3. 先成功后通过 demo 级 `Upload Another PDF` 再次上传失败时，旧的 JSON 预览已被清空且显示错误告警

  **Must NOT do**:
  - 不把 `parseError` 或 `isParsing` 变成 `Reader` props。
  - 不在失败后继续保留旧的 `parsedDocument`。
  - 不新增与需求无关的错误分类 UI。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 同一 demo 状态机上的失败分支与回归固定
  - Skills: `[]` — 无需外部技能
  - Omitted: `['/playwright']` — 当前失败流完全可用 Vitest + RTL 覆盖

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [5] | Blocked By: [3]

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `PdfParser/demo/demo.js:173-203` — encode 中的 loading / error 状态与 catch 处理方式
  - Pattern: `reader/src/components/Reader.tsx:144-176` — 上传后 file-info UI，可保留为 retry 的 upload shell
  - Pattern: `reader/test/reader.test.tsx:67-150` — 当前上传交互测试模式，可迁移到 demo 级测试
  - API/Type: `PdfParser/src/pdfParser.ts:47-52` — falsy 返回路径的来源（buffer coercion 失败时返回 `undefined`）
  - API/Type: `types/src/HamsterDocument/IntermediateDocument.ts:169-178` — `serialize()` 异步加载文本，必须纳入失败覆盖

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/demo.test.tsx` 通过，覆盖 falsy 失败与抛错失败两种路径
  - [ ] 解析进行中存在 `role="status"` 且文本为 `Parsing PDF...`
  - [ ] 解析失败时存在 `role="alert"` 且文本为 `Failed to parse PDF`
  - [ ] 通过 demo 级 `Upload Another PDF` 触发第二次上传时，旧成功 JSON 会在开始解析时移除；如果第二次失败，页面只留下错误态与 upload 入口

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: encode 返回 undefined 时进入失败态
    Tool: Bash
    Steps: 在 `test/demo.test.tsx` 中 mock `PdfParser.encode` 返回 `undefined`；运行 `yarn test:run test/demo.test.tsx`
    Expected: 页面出现 `role="alert"` + `Failed to parse PDF`，且不存在 `reader-json-preview`
    Evidence: .sisyphus/evidence/task-4-demo-undefined-error.txt

  Scenario: 成功后再次上传失败时清空旧预览
    Tool: Bash
    Steps: 在 `test/demo.test.tsx` 中先 mock 一次成功、点击 `Upload Another PDF` 重新选文件、再 mock 一次 reject；运行 `yarn test:run test/demo.test.tsx`
    Expected: 第二次上传开始即移除旧 JSON；失败后仅保留错误告警和 upload 入口
    Evidence: .sisyphus/evidence/task-4-demo-retry-clear.txt
  ```

  **Commit**: NO | Message: `feat(demo): handle parser loading and failures` | Files: `demo/App.tsx`, `test/demo.test.tsx`

- [ ] 5. 收口选择器、类型与回归验证

  **What to do**:
  - 在 `src/components/Reader.tsx` 与 `demo/App.tsx` 中固定新增测试钩子与无障碍语义：
    - `reader-json-preview`
    - `reader-prev-page-btn`
    - `reader-next-page-btn`
    - `reader-empty-pages`
    - `role="status"` / `role="alert"`
  - 确保所有新增状态与事件处理保持 TypeScript 明确类型，不引入 `any`。
  - 让 `test/reader.test.tsx` 继续保留并通过现有 upload zone / file-info 回归用例，证明新 viewer 行为没有破坏上传壳。
  - 新增/整理 `test/demo.test.tsx` 的 helper，使用确定性的 fixture 页面内容（第一页含唯一文本 `Page One Unique`，第二页含唯一文本 `Page Two Unique`），避免脆弱断言。
  - 运行并修正最终回归：`reader` 与 `demo` 两个测试文件、`typecheck`、`build:demo` 全绿。

  **Must NOT do**:
  - 不随意改名既有 `upload-zone`、`file-input`、`file-info`、`upload-another-btn` 测试钩子。
  - 不为了让测试通过而放宽类型或跳过失败分支断言。
  - 不新增 README/文档任务；本次只收口代码与测试回归。

  **Recommended Agent Profile**:
  - Category: `unspecified-low` — Reason: 回归收口、选择器稳定和类型验证
  - Skills: `[]` — 无需额外技能
  - Omitted: `['/refactor']` — 不做架构重构，仅做回归稳定

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: [] | Blocked By: [1, 2, 3, 4]

  **References** (executor has NO interview context — be exhaustive):
  - Config: `reader/vite.config.ts:28-36` — 测试入口与 jsdom 环境
  - Config: `reader/test/setup.ts:1-7` — `jest-dom` 与 cleanup 已就绪
  - Pattern: `reader/test/reader.test.tsx:49-159` — 必须保持通过的 upload shell 回归测试
  - Pattern: `reader/src/components/Reader.tsx:95-176` — 现有 `data-testid` 命名风格，新增钩子需保持一致
  - API/Type: `reader/demo/App.tsx:1-45` — demo 状态与 props 传递入口，所有新状态需显式类型化

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run test/reader.test.tsx test/demo.test.tsx` 通过
  - [ ] `yarn typecheck` 通过，新增代码无 `any`
  - [ ] `yarn build:demo` 通过
  - [ ] 既有上传壳测试（upload zone、file info、upload another）继续保持绿色

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: 全量测试回归通过
    Tool: Bash
    Steps: 运行 `yarn test:run test/reader.test.tsx test/demo.test.tsx`
    Expected: Reader 与 demo 新旧用例全部通过，无快照/异步泄漏错误
    Evidence: .sisyphus/evidence/task-5-regression-tests.txt

  Scenario: 类型与 demo 构建回归通过
    Tool: Bash
    Steps: 依次运行 `yarn typecheck` 与 `yarn build:demo`
    Expected: TypeScript 检查通过，Vite demo 构建通过
    Evidence: .sisyphus/evidence/task-5-typecheck-build.txt
  ```

  **Commit**: NO | Message: `test(reader): lock parser demo regressions` | Files: `src/components/Reader.tsx`, `demo/App.tsx`, `test/reader.test.tsx`, `test/demo.test.tsx`, `src/styles/reader.scss`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle

  **Tool**: task (`oracle`) + Bash
  **Steps**:
  - 运行 oracle 审核最终改动是否严格覆盖 Task 1-5 与 Must Have / Must NOT Have
  - 运行 `yarn test:run test/reader.test.tsx test/demo.test.tsx`
  **Expected**:
  - oracle 明确批准“未把 parser 下沉到 Reader、未超出 JSON 分页预览范围”
  - 测试命令全绿

- [ ] F2. Code Quality Review — unspecified-high

  **Tool**: task (`unspecified-high`) + Bash
  **Steps**:
  - 审阅 `src/components/Reader.tsx`、`demo/App.tsx`、`test/reader.test.tsx`、`test/demo.test.tsx`、`src/styles/reader.scss`
  - 运行 `yarn typecheck`
  **Expected**:
  - 审阅结论无阻塞级问题
  - TypeScript 检查通过，新增代码无 `any`

- [ ] F3. Agent-Executed UI QA — unspecified-high (+ playwright if UI)

  **Tool**: task (`unspecified-high`) + Bash
  **Steps**:
  - 基于测试与 demo 行为审核以下 5 条是否全部成立：默认第一页 JSON、前后按钮边界禁用、loading 状态、失败告警、成功态二次上传入口
  - 运行 `yarn build:demo`
  **Expected**:
  - 审核结果确认 5 条 UI 行为全部满足
  - demo 构建通过

- [ ] F4. Scope Fidelity Check — deep

  **Tool**: task (`deep`) + Bash
  **Steps**:
  - 核查最终改动未新增整份文档 JSON 浏览、搜索、缩放、编辑器、E2E 等计划外内容
  - 复跑 `yarn test:run test/reader.test.tsx test/demo.test.tsx && yarn typecheck && yarn build:demo`
  **Expected**:
  - deep 审核确认实现与计划范围完全一致
  - 全部命令再次通过

## Commit Strategy
- Commit 1: `feat(reader): render serialized page json preview`
  - Scope: Task 1 + Task 2
- Commit 2: `feat(demo): parse uploaded pdf into reader preview`
  - Scope: Task 3 + Task 4
- Commit 3: `test(reader): cover demo parser states and regression`
  - Scope: Task 5 + final green verification fixes only

## Success Criteria
- `Reader` 接收 `IntermediateDocumentSerialized` 后不再只显示标题，而是稳定展示当前页格式化 JSON
- demo 成功串联 `upload -> encode -> serialize -> preview`
- 用户无需手动刷新即可通过按钮在页 JSON 间切换
- 成功、loading、失败、零页、边界翻页均有自动化测试固定
- 库公开 API 保持 viewer 边界，不把解析器耦合进发布产物的公共使用方式
