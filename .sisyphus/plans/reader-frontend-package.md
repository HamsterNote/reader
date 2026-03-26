# Bootstrap `@hamster-note/reader`

## TL;DR
> **Summary**: 在空仓库中初始化一个可发布到 npm 的 React 库包 `@hamster-note/reader`，技术栈固定为 TypeScript、Vite、SCSS、React，并在同仓库提供本地 Demo 用于联调与打包边界验证。
> **Deliverables**:
> - npm 可发布的库包骨架（ESM、类型声明、显式 CSS 导出）
> - 本地 Demo（通过包名入口消费库包，而非深度引用 `src/`）
> - `Vitest + React Testing Library` 最小测试基线
> - 对齐 `types` 仓库的 PR CI 与 `version/*` 分支发版工作流
> - 公共包所需 README、CHANGELOG 与打包校验
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

## Context
### Original Request
- 创建前端项目，技术栈固定为 `typescript`、`vite`、`scss`、`react`。
- 安装依赖 `@hamster-note/types`。
- 包名固定为 `@hamster-note/reader`。
- 目标是公开 npm 包，后续会上 npm。
- GitHub CI / 发布脚本参考 `~/frontend/HamsterNote/types`。

### Interview Summary
- 当前仓库 `reader` 基本为空，仅有 `.git/` 和 `LICENSE`，属于全新初始化，不是增量改造。
- 用户确认产物形态为“**库包 + Demo**”：npm 包是主产物，Demo 只用于开发/验证，不进入发布物。
- 用户确认测试策略为“**测试后补**”，但第一版必须接入可运行的 `Vitest + React Testing Library` 最小测试基线。
- 用户确认 GitHub 发版流程直接对齐 `types`：PR CI + `version/*` 分支自动发布到 npm。

### Metis Review (gaps addressed)
- 已锁定默认公开 API 为最小占位版本：仅导出 `Reader` 组件、`ReaderProps` 与显式样式入口 `@hamster-note/reader/style.css`，不额外导出 hooks、工具函数或业务逻辑。
- 已锁定依赖模型：`react`、`react-dom` 使用 `peerDependencies + devDependencies`；`@hamster-note/types` 作为 `dependency`，因为公共声明文件会引用其类型。
- 已锁定模块策略：首版仅输出 **ESM**，与参考仓库的 `type: module` 风格保持一致，不额外生成 CJS/UMD。
- 已锁定样式契约：库包不在 JS 入口自动注入样式，消费者需显式引入 `@hamster-note/reader/style.css`；Demo 必须按此契约接入。
- 已加入公共包护栏：Demo 不得成为发布物、README/CHANGELOG 必须齐备、`npm pack --dry-run` 必须作为一等校验项。

## Work Objectives
### Core Objective
- 产出一个“可安装、可构建、可测试、可 dry-run 打包、可接入 GitHub 自动发版”的前端库包脚手架，为后续真正的 Reader 功能迭代提供稳定基础。

### Deliverables
- `package.json`、`yarn.lock`、Vite/TS/ESLint/Prettier 配置齐备。
- `src/` 下最小库包入口、占位 `Reader` 组件、显式 SCSS 样式入口。
- `demo/` 或等价本地预览入口，使用包名 `@hamster-note/reader` 进行消费。
- `Vitest + RTL + jsdom + setupFiles` 测试基线与至少一条公共 API 渲染烟雾测试。
- `.github/workflows/ci-pr.yml` 与 `.github/workflows/publish.yml`，行为与 `types` 保持一致。
- `README.md`、`CHANGELOG.md`、打包内容校验脚本/流程。

### Definition of Done (verifiable conditions with commands)
- `yarn install --frozen-lockfile` 在干净环境可执行成功。
- `yarn lint`、`yarn test:run`、`yarn build`、`yarn typecheck` 全部通过。
- `npm pack --dry-run` 生成的发布清单仅包含 npm 需要的内容，不包含 `demo/`、`src/`、测试文件和 `.github/`。
- `dist/` 至少包含 `index.js`、`index.d.ts`、`style.css`。
- 本地启动 Demo 后，页面可渲染占位 Reader 组件，且样式通过显式 CSS 导入生效。
- `version/x.y.z` 与 `version/x.y.z-beta.*` / `version/x.y.z-dev.*` 分支的发布逻辑与 dist-tag 映射明确且可审查。

### Must Have
- 保持包名为 `@hamster-note/reader`。
- 使用 `yarn@1.22.22`，与 `types` 仓库一致。
- `package.json` 采用 `type: module`、`files: ["dist"]`、`publishConfig.access = public`。
- `react`、`react-dom` 为 peer 依赖；`@hamster-note/types` 为直接依赖。
- Vite 使用 library mode 产出 ESM 构建；显式导出 `./style.css`。
- Demo 通过包名消费库入口，不能深度导入 `src/`。
- README 与 CHANGELOG 在首版即补齐。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不添加 Storybook、GitHub Pages、SSR、MDX、Monorepo、自动版本管理器、真实 Reader 业务逻辑。
- 不输出 CJS/UMD，除非用户后续明确要求兼容旧消费端。
- 不在 JS 入口自动注入样式副作用，避免消费者样式契约不透明。
- 不让 Demo 或测试资源进入 npm 发布物。
- 不引入 `any` 逃逸类型；与 `@hamster-note/types` 的类型关系必须显式、可追踪。

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: `tests-after`，但初始化即接入 `Vitest` + `React Testing Library` + `jsdom`。
- QA policy: 每个任务都包含 agent 可执行的 Happy path 与 Failure/edge case。
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`。

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. 本计划总任务数为 6，按依赖压缩为 3 waves；最终验证单独作为收尾波次。

Wave 1: Task 1（包元数据与工具链地基）

Wave 2: Task 2（测试基线）、Task 3（最小库 API + 样式契约）

Wave 3: Task 4（Demo 入口与本地预览）、Task 5（GitHub CI / Publish 工作流）、Task 6（README / CHANGELOG / 打包校验）

### Dependency Matrix (full, all tasks)
- Task 1 → 无前置依赖
- Task 2 → Blocked By: Task 1
- Task 3 → Blocked By: Task 1, Task 2
- Task 4 → Blocked By: Task 1, Task 3
- Task 5 → Blocked By: Task 1, Task 2, Task 3, Task 4
- Task 6 → Blocked By: Task 1, Task 2, Task 3, Task 4, Task 5
- F1 / F2 / F3 / F4 → Blocked By: Task 1-6 全部完成且用户确认进入最终验证

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `quick`
- Wave 2 → 2 tasks → `unspecified-high`, `quick`
- Wave 3 → 3 tasks → `visual-engineering`, `unspecified-high`, `writing`
- Final Verification → 4 review tasks → `oracle`, `unspecified-high`, `unspecified-high`, `deep`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

<!-- TASKS_INSERT_POINT -->

- [x] 1. Bootstrap package metadata and toolchain

  **What to do**: 在仓库根目录创建首版脚手架配置：`package.json`、`yarn.lock`、`tsconfig.json`、`tsconfig.build.json`、`vite.config.ts`（供 dev/test/demo 使用）、`vite.lib.config.ts`（专用于库构建）、`eslint.config.js`、`prettier.config.cjs`、`.gitignore`、`src/index.ts` 占位入口。`package.json` 必须固定 `name=@hamster-note/reader`、`type=module`、`files=["dist"]`、`publishConfig.access=public`、`packageManager=yarn@1.22.22...`，并提供脚本：`dev`、`build:lib`、`build:demo`、`build:all`、`build`、`typecheck`、`lint`、`test`、`test:run`、`preview`、`prepublishOnly`。依赖分层固定为：`react`/`react-dom` 进入 `peerDependencies + devDependencies`，`@hamster-note/types` 进入 `dependencies`，`sass`/`typescript`/`vite`/`@vitejs/plugin-react`/`eslint`/`prettier`/`vitest`/`jsdom`/`@testing-library/*` 进入 `devDependencies`。`build:lib` 输出 `dist/`，`build:demo` 输出 `demo-dist/`，`prepublishOnly` 仅执行库构建而不构建 Demo。
  **Must NOT do**: 不生成 CJS/UMD；不把 `react` 或 `react-dom` 放入 `dependencies`；不让 Demo 目录进入 `files`；不让 `prepublishOnly` 依赖 Demo 构建成功。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 主要是基础配置与脚本搭建，逻辑明确且边界清晰。
  - Skills: `[]` — 无需额外技能即可完成。
  - Omitted: `['git-master']` — 当前阶段不涉及 git 历史操作。

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Task 2, Task 3, Task 4, Task 5, Task 6 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/package.json:1` — 对齐 `type: module`、`files`、`publishConfig`、`prepublishOnly` 与 `packageManager` 风格。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/tsconfig.json:1` — 复用基线 TS 配置思路，优先从基础包扩展。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/tsconfig.build.json:1` — 分离构建用 TS 配置，专门处理声明文件输出。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/eslint.config.js:1` — 复用 `@system-ui-js/development-base` 的 ESLint 配置入口模式。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/prettier.config.cjs:1` — 复用基础 Prettier 配置，避免本仓库另起一套规范。
  - External: `https://github.com/vitejs/vite/blob/main/docs/guide/build.md` — Vite library mode、external 配置与 CSS 导出策略。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn install --frozen-lockfile` 成功生成并锁定依赖。
  - [ ] `yarn lint` 与 `yarn typecheck` 在仅有脚手架文件和占位入口的情况下通过。
  - [ ] `node -e "const p=require('./package.json'); if(p.name!=='@hamster-note/reader') throw new Error('bad name'); if(p.type!=='module') throw new Error('bad module type'); if(p.publishConfig?.access!=='public') throw new Error('bad publishConfig'); if(!p.files?.includes('dist')) throw new Error('missing dist files'); if(p.dependencies?.react) throw new Error('react in dependencies'); if(!p.peerDependencies?.react || !p.peerDependencies?.['react-dom']) throw new Error('missing react peers'); if(!p.dependencies?.['@hamster-note/types']) throw new Error('missing types dep');"` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Baseline scaffold is installable
    Tool: Bash
    Steps: run `yarn install --frozen-lockfile && yarn lint && yarn typecheck`
    Expected: all commands exit 0; no missing-config or missing-entry errors
    Evidence: .sisyphus/evidence/task-1-scaffold.txt

  Scenario: Dependency placement guard
    Tool: Bash
    Steps: run `node -e "const p=require('./package.json'); if(p.dependencies?.react || p.dependencies?.['react-dom']) throw new Error('react must stay peer-only'); if(!p.dependencies?.['@hamster-note/types']) throw new Error('@hamster-note/types must stay dependency');"`
    Expected: command exits 0 only when React is peer-only and `@hamster-note/types` is a direct dependency
    Evidence: .sisyphus/evidence/task-1-scaffold-error.txt
  ```

  **Commit**: YES | Message: `chore(scaffold): initialize package metadata and toolchain` | Files: `package.json`, `yarn.lock`, `tsconfig.json`, `tsconfig.build.json`, `vite.config.ts`, `vite.lib.config.ts`, `eslint.config.js`, `prettier.config.cjs`, `.gitignore`, `src/index.ts`

- [x] 2. Establish Vitest + RTL smoke harness

  **What to do**: 在 `vite.config.ts` 中直接声明 `test` 配置，使用 `jsdom`、`setupFiles`、合理的 `include/exclude` 与 `coverage.provider=v8`；新增 `test/setup.ts` 加载 `@testing-library/jest-dom`；新增一个与业务无关的最小烟雾测试（可放在 `test/smoke.test.tsx`），使用本地内联测试组件证明 React 渲染、jsdom 环境和 `toBeInTheDocument` 断言链都工作。此任务只负责“测试底座”，不承担 Reader 组件逻辑。
  **Must NOT do**: 不在这里实现真实 `Reader`；不把测试配置拆成第二套与 Vite 脱节的独立配置；不把浏览器 E2E 框架引入首版。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 测试基线搭建是集中、确定性的配置任务。
  - Skills: `[]` — 无需额外技能即可完成。
  - Omitted: `['playwright']` — 首版仅需单测基线，不引入浏览器自动化依赖。

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 3, Task 5, Task 6 | Blocked By: Task 1

  **References** (executor has NO interview context — be exhaustive):
  - External: `https://github.com/vitest-dev/vitest/blob/main/docs/config/index.md` — 建议把 `test` 配置直接并入 Vite 配置。
  - External: `https://github.com/vitest-dev/vitest/blob/main/docs/config/environment.md` — `jsdom` 环境与 TypeScript `vitest/jsdom` 类型说明。
  - External: `https://github.com/vitest-dev/vitest/blob/main/docs/guide/coverage.md` — 首版 coverage provider 采用 `v8`。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/package.json:5` — 脚本命名仍需保留 `lint`、`test`、`build:all` 这一组 CI 友好命名。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run` 成功执行，且至少有一条 RTL 烟雾测试通过。
  - [ ] `test/setup.ts` 生效，测试文件中可直接使用 `toBeInTheDocument`。
  - [ ] `vite.config.ts` 中的 `test.environment` 为 `jsdom`，并声明了 `setupFiles`。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: jsdom + RTL smoke passes
    Tool: Bash
    Steps: run `yarn test:run`
    Expected: test output shows at least one passing smoke test and zero environment/setup failures
    Evidence: .sisyphus/evidence/task-2-vitest.txt

  Scenario: setupFiles matcher is declared in Vite config
    Tool: Bash
    Steps: run `rg "environment:\s*['\"]jsdom['\"]|setupFiles" vite.config.ts`
    Expected: command returns matches proving the Vitest config declares `jsdom` and at least one setup file
    Evidence: .sisyphus/evidence/task-2-vitest-error.txt
  ```

  **Commit**: YES | Message: `test(setup): add vitest rtl smoke coverage` | Files: `vite.config.ts`, `test/setup.ts`, `test/smoke.test.tsx`

- [x] 3. Implement minimal public Reader API and style contract

  **What to do**: 用最小占位实现公开 API：创建 `src/components/Reader.tsx`（或同等路径）、`src/styles/reader.scss`、`src/styles/index.scss`，并由 `src/index.ts` 仅导出 `Reader` 与 `ReaderProps`。`ReaderProps` 固定为最小且可扩展的结构：`document?: IntermediateDocumentSerialized | null`、`className?: string`、`emptyText?: string`。其中 `IntermediateDocumentSerialized` 必须从 `@hamster-note/types` 以 `import type` 引入。组件只做占位渲染：若有 `document.title` 则显示标题，否则显示 `emptyText`，同时在根节点加 `data-testid="reader-root"`。样式契约固定为显式导出 `@hamster-note/reader/style.css`，因此 JS 入口不得自动 `import` 样式；需要在库构建中产出独立 CSS 文件。同步补充公共 API 烟雾测试，覆盖“有标题”和“空文档回退文案”两个场景。
  **Must NOT do**: 不实现翻页、缩放、懒加载、解析器、网络请求或 hooks；不把 `IntermediateDocument` 类实例行为引入首版占位组件；不自动注入样式副作用。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 需要同时约束 API 设计、类型边界、样式契约与构建产物。
  - Skills: `[]` — 仓库内没有更专门的技能依赖。
  - Omitted: `['frontend-ui-ux']` — 这里只做占位渲染，不做视觉打磨。

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Task 4, Task 5, Task 6 | Blocked By: Task 1, Task 2

  **References** (executor has NO interview context — be exhaustive):
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/index.ts:1` — `@hamster-note/types` 顶层已导出 `HamsterDocument` 相关类型。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/index.ts:1` — `IntermediateDocument` 模块被顶层统一导出。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:11` — `IntermediateDocumentSerialized` 是最适合首版占位 API 的纯数据类型。
  - External: `https://github.com/vitejs/vite/blob/main/docs/guide/build.md` — 库模式可显式导出 CSS 产物，不必把样式绑定到 JS 入口。
  - Test: `.sisyphus/plans/reader-frontend-package.md:1` — 当前计划明确规定公开 API 只包含 `Reader`、`ReaderProps` 与显式样式入口。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn test:run` 通过，且测试覆盖标题渲染与空态回退文案。
  - [ ] `yarn build:lib` 后存在 `dist/index.js`、`dist/index.d.ts`、`dist/style.css`。
  - [ ] `node -e "import('./dist/index.js').then((m)=>{if(typeof m.Reader!=='function') throw new Error('missing Reader export')})"` 通过。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Public Reader export renders title
    Tool: Bash
    Steps: run `yarn test:run --reporter=default`
    Expected: test suite includes a case asserting `data-testid="reader-root"` renders the provided `document.title`
    Evidence: .sisyphus/evidence/task-3-reader.txt

  Scenario: Empty document falls back gracefully
    Tool: Bash
    Steps: run `yarn test:run --reporter=default`
    Expected: test suite includes a case where `document` is `null` or missing and the component renders `emptyText` without throwing
    Evidence: .sisyphus/evidence/task-3-reader-error.txt
  ```

  **Commit**: YES | Message: `feat(reader): add placeholder reader component and styles` | Files: `src/index.ts`, `src/components/Reader.tsx`, `src/styles/index.scss`, `src/styles/reader.scss`, `test/reader.test.tsx`

- [x] 4. Add local demo that consumes the package entry

  **What to do**: 新增根 `index.html` 作为 Vite dev/preview 入口，并在 `demo/` 下创建 `main.tsx`、`App.tsx` 与最小演示数据。Demo 必须使用 `import { Reader } from '@hamster-note/reader'` 与 `import '@hamster-note/reader/style.css'`，禁止深度导入 `src/`。为满足本地开发体验，在 `vite.config.ts` 中新增仅面向 dev/test 的 alias：`@hamster-note/reader -> src/index.ts`、`@hamster-note/reader/style.css -> src/styles/index.scss`，同时保持 `build:lib` 仍然从 `vite.lib.config.ts` 产出真实发布文件。Demo 页面需包含 `data-testid="reader-demo-root"` 与一个稳定标题（例如 `Hamster Reader Demo`），并使用一个 `IntermediateDocumentSerialized` fixture 展示标题渲染。`build:demo` 输出目录固定为 `demo-dist/`，与 npm 发布物隔离。
  **Must NOT do**: 不让 Demo 通过相对路径直接引用 `src/components/Reader`；不把 `demo-dist/` 写入 `package.json.files`；不把 Demo 构建和库构建混成一个输出目录。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 需要处理 Demo 入口、开发体验和样式接入的前端集成细节。
  - Skills: `[]` — 无需额外技能。
  - Omitted: `['playwright']` — 这里先用本地服务 + `curl`/静态断言完成 agent 可执行验证。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Task 5, Task 6 | Blocked By: Task 1, Task 3

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `.sisyphus/plans/reader-frontend-package.md:1` — 当前计划要求 Demo 必须通过包名消费库入口，并显式导入样式。
  - External: `https://github.com/vitejs/vite/blob/main/docs/guide/build.md` — Vite 允许同时保留 `index.html` 作为开发页与单独库构建配置。
  - API/Type: `/Users/zhangxiao/frontend/HamsterNote/types/src/HamsterDocument/IntermediateDocument.ts:11` — Demo fixture 采用 `IntermediateDocumentSerialized` 最稳妥。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `yarn build:demo` 成功并输出到 `demo-dist/`。
  - [ ] `yarn dev --host 127.0.0.1 --strictPort` 启动后，`curl -fsS http://127.0.0.1:5173` 返回包含 `Hamster Reader Demo` 的 HTML。
  - [ ] Demo 代码中不存在 `from '../src/`、`from './src/` 或 `from 'src/` 形式的深度库导入。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Demo renders through package entry alias
    Tool: Bash
    Steps: start `yarn dev --host 127.0.0.1 --strictPort` in background; run `curl -fsS http://127.0.0.1:5173`; stop the dev server
    Expected: response contains `Hamster Reader Demo` and the demo root marker; no module-resolution errors appear in server logs
    Evidence: .sisyphus/evidence/task-4-demo.txt

  Scenario: Deep-import guard
    Tool: Bash
    Steps: run `rg "from ['\"](\.\.?/)?src/|from ['\"].*src/components/Reader" demo index.html vite.config.ts`
    Expected: command returns no matches proving the demo does not bypass the public package specifier
    Evidence: .sisyphus/evidence/task-4-demo-error.txt
  ```

  **Commit**: YES | Message: `feat(demo): wire local demo through package entry` | Files: `index.html`, `demo/main.tsx`, `demo/App.tsx`, `vite.config.ts`

- [x] 5. Mirror `types` GitHub CI and npm publish workflows

  **What to do**: 在 `.github/workflows/` 下创建 `ci-pr.yml` 与 `publish.yml`，整体结构对齐参考仓库，但命令替换为本项目脚本：PR CI 按顺序执行 checkout、Node setup、`corepack enable`、`yarn install --frozen-lockfile`、`yarn lint`、`yarn test:run`、`yarn build:all`、`npm pack --dry-run`。发布工作流保留 `version/*` 分支触发、版本存在性检查、`NPM_TOKEN` 鉴权、`latest/dev/beta` dist-tag 映射与“已发布则跳过”的逻辑；构建命令使用 `yarn build:all`，发布命令保持 `npm publish --tag "$PUBLISH_TAG" --access public`。如需同步默认分支到 `dev`，可复制 `sync-master-to-dev.yml`，但作为可选附加项，不得阻塞主目标。
  **Must NOT do**: 不改成 `main` 直接发布；不跳过 `npm pack --dry-run`；不在 workflow 中硬编码 token；不让 publish 依赖人工手工修改脚本。

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 需要精确复制发布语义并避免 CI / 发版偏差。
  - Skills: `[]` — 无需额外技能。
  - Omitted: `['git-master']` — 这里只是 workflow 编排，不是 git 历史处理。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Task 6 | Blocked By: Task 1, Task 2, Task 3, Task 4

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/.github/workflows/ci-pr.yml:1` — PR CI 的 job 结构、Node 安装、缓存、lint/test/build/pack 顺序。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/.github/workflows/publish.yml:1` — `version/*` 分支触发、已发布版本跳过、`latest/dev/beta` dist-tag 映射与 npm 发布流程。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/package.json:5` — `build:all` / `prepublishOnly` 等脚本命名约定。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/CHANGELOG.md:1` — 发布前应已有标准变更日志文件。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `.github/workflows/ci-pr.yml` 中出现 `yarn lint`、`yarn test:run`、`yarn build:all`、`npm pack --dry-run` 四个关键步骤。
  - [ ] `.github/workflows/publish.yml` 仅匹配 `version/x.y.z` 与 `version/x.y.z-*` 分支，不匹配 `main`。
  - [ ] `publish.yml` 中存在“版本已发布则跳过”和 `latest/dev/beta` tag 分流逻辑。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: PR CI contains all required gates
    Tool: Bash
    Steps: run `rg "yarn lint|yarn test:run|yarn build:all|npm pack --dry-run" .github/workflows/ci-pr.yml`
    Expected: all four commands are present in the PR workflow
    Evidence: .sisyphus/evidence/task-5-ci.txt

  Scenario: Publish workflow branch/tag guard
    Tool: Bash
    Steps: run `rg "version/\[0-9\]\+\.[0-9]\+\.[0-9]\+|PUBLISH_TAG=dev|PUBLISH_TAG=beta|PUBLISH_TAG=latest|should_publish" .github/workflows/publish.yml`
    Expected: workflow contains version-branch triggers, deterministic dist-tag assignment, and skip-if-published logic
    Evidence: .sisyphus/evidence/task-5-ci-error.txt
  ```

  **Commit**: YES | Message: `ci(release): align workflows with types` | Files: `.github/workflows/ci-pr.yml`, `.github/workflows/publish.yml`, `.github/workflows/sync-master-to-dev.yml`

- [x] 6. Add public package docs, changelog, and pack verification

  **What to do**: 创建 `README.md`、`CHANGELOG.md` 与 `scripts/check-pack.mjs`。README 必须覆盖：安装方式、最小使用示例、显式样式导入方式、Peer 依赖要求、开发脚本与发版分支规则。CHANGELOG 采用 Keep a Changelog 结构，并至少包含 `## [Unreleased]`。`scripts/check-pack.mjs` 负责调用或解析 `npm pack --json --dry-run` 输出，断言发布物仅包含 `dist/`、`package.json`、`README.md`、`LICENSE`、`CHANGELOG.md` 等必要文件，不包含 `demo/`、`demo-dist/`、`src/`、`test/`、`.github/`。在 `package.json` 中补充 `pack:check` 脚本，并确保 CI 可调用。若 `package.json` 缺少 `repository`、`homepage`、`bugs` 字段，本任务一并补齐。
  **Must NOT do**: 不写与未来业务功能相关的文档承诺；不把 Demo 当作正式站点对外声明；不省略 `CHANGELOG` 的 `Unreleased` 节点；不把打包校验仅停留在人工肉眼检查。

  **Recommended Agent Profile**:
  - Category: `writing` — Reason: 文档与发布说明是主体，同时夹带一个明确的打包校验脚本。
  - Skills: `[]` — 无需额外技能。
  - Omitted: `['frontend-ui-ux']` — 这是包文档，不是视觉设计任务。

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification | Blocked By: Task 1, Task 2, Task 3, Task 4, Task 5

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/CHANGELOG.md:1` — Changelog 格式以 Keep a Changelog 为准，并保留 `Unreleased`。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/package.json:48` — `files` 仅发布 `dist`，其余文档依赖 npm 默认包含与显式验证。
  - Pattern: `/Users/zhangxiao/frontend/HamsterNote/types/.github/workflows/ci-pr.yml:48` — `npm pack --dry-run` 是 CI 正式门禁的一部分。
  - External: `https://github.com/vitejs/vite/blob/main/docs/guide/build.md` — CSS 文件可作为包 exports 的显式子路径对外暴露。

  **Acceptance Criteria** (agent-executable only):
  - [ ] `README.md` 包含安装、示例、样式导入、脚本说明、发版分支规则五部分最小内容。
  - [ ] `CHANGELOG.md` 存在 `## [Unreleased]` 节。
  - [ ] `yarn pack:check` 通过，并在 tarball 清单中排除 `demo/`、`demo-dist/`、`src/`、`test/`、`.github/`。

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: npm pack contents are clean
    Tool: Bash
    Steps: run `yarn pack:check`
    Expected: command exits 0 only when the dry-run tarball excludes `demo/`, `demo-dist/`, `src/`, `test/`, and `.github/`
    Evidence: .sisyphus/evidence/task-6-pack.txt

  Scenario: Public package docs are minimally complete
    Tool: Bash
    Steps: run `rg "安装|使用|style.css|peer|Peer|version/|Unreleased" README.md CHANGELOG.md`
    Expected: README and CHANGELOG both contain the expected public-package guidance and unreleased section
    Evidence: .sisyphus/evidence/task-6-pack-error.txt
  ```

  **Commit**: YES | Message: `docs(release): add readme changelog and pack guards` | Files: `README.md`, `CHANGELOG.md`, `scripts/check-pack.mjs`, `package.json`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle ✅ APPROVED

  **What to do**: 使用 `oracle` 对照本计划逐条审计落地结果，重点核对：交付物是否齐全、任务依赖是否被尊重、默认决策（ESM-only、显式 CSS、`@hamster-note/types` 为 dependency、Demo 不进发布物）是否全部执行。
  **Tool / Agent**: `task(subagent_type="oracle")`
  **Steps**:
  - 读取 `.sisyphus/plans/reader-frontend-package.md` 与实现后的仓库状态。
  - 逐项核对 Task 1-6 的 Acceptance Criteria 和 Must Have / Must NOT Have。
  - 输出 `PASS` / `FAIL` 清单，并给出缺失项文件路径。
  **Expected**: Oracle 明确给出 `PASS`，且不存在未实现或越界项。
  **Evidence**: `.sisyphus/evidence/f1-plan-compliance.md`

- [x] F2. Code Quality Review — unspecified-high ✅ APPROVED

  **What to do**: 使用高强度代码审查代理检查类型安全、配置一致性、脚本可执行性和发布边界，尤其关注 `peerDependencies` / `dependencies` 分类、`exports`、构建产物与测试配置是否互相匹配。
  **Tool / Agent**: `task(category="unspecified-high")`
  **Steps**:
  - 审查 `package.json`、Vite/TS/Vitest 配置、工作流文件和 pack 校验脚本。
  - 运行或复核 `yarn lint`、`yarn typecheck`、`yarn test:run`、`yarn build`、`yarn pack:check` 的结果。
  - 标记任何类型逃逸、错误脚本名、错误输出路径或发布风险。
  **Expected**: 审查结果无高严重度问题；若有中低问题，必须已修复后再重跑本项。
  **Evidence**: `.sisyphus/evidence/f2-code-quality.md`

- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI) ✅ APPROVED

  **What to do**: 做一轮面向最终用户路径的真实联调：安装依赖、运行测试、构建库包、启动 Demo，并确认 Demo 通过包名入口加载到占位 Reader 组件与样式。
  **Tool / Agent**: `task(category="unspecified-high")` + Playwright only if the executor decides browser confirmation is needed
  **Steps**:
  - 执行 `yarn install --frozen-lockfile && yarn test:run && yarn build && yarn pack:check`。
  - 启动 `yarn dev --host 127.0.0.1 --strictPort`，访问 `http://127.0.0.1:5173`。
  - 确认页面存在 `Hamster Reader Demo`、`data-testid="reader-demo-root"`，且显式样式导入生效。
  **Expected**: 从安装到预览全链路通过，无模块解析错误、无缺失样式、无 Demo 深度导入。
  **Evidence**: `.sisyphus/evidence/f3-manual-qa.md`

- [x] F4. Scope Fidelity Check — deep ✅ APPROVED

  **What to do**: 使用 `deep` 代理核查交付是否严格停留在“脚手架 + 占位 API + Demo + CI/发布 + 文档”范围内，没有偷带真实 Reader 业务、Storybook、SSR 或额外发版机制。
  **Tool / Agent**: `task(category="deep")`
  **Steps**:
  - 审阅新增文件清单与目录结构。
  - 对照 `Must NOT Have` 和用户原始请求，标出任何超范围功能。
  - 检查 README 是否只承诺已实现内容，没有未来功能的虚假描述。
  **Expected**: Deep 审查确认零越界；若发现额外功能或多余基础设施，必须删减后重跑。
  **Evidence**: `.sisyphus/evidence/f4-scope-fidelity.md`

## Commit Strategy
- 采用 green-only 原子提交，不允许把失败测试或半完成配置推到共享分支。
- 推荐提交序列：
- `chore(scaffold): initialize package metadata and toolchain`
- `test(setup): add vitest rtl smoke coverage`
- `feat(reader): add placeholder reader component and styles`
- `feat(demo): wire local demo through package entry`
- `ci(release): align workflows with types`
- `docs(release): add readme changelog and pack guards`

## Success Criteria
- 任意执行代理不需要额外猜测目录结构、导出契约、依赖归类、样式接入方式或发版规则。
- 产物在本地与 CI 中都能完成安装、测试、构建、预览与 dry-run 打包。
- npm 发布行为与 `types` 仓库一致，但不把 Demo 与无关文件带入发布包。
