# 文字选择多边形覆盖层（Selection Overlay Polygon）实施计划

## TL;DR
> **Summary**: 用 SVG 多边形覆盖层替代原生选区，几何相交的选框合并为多边形（支持凹多边形/孔洞/多区域），选择结束后显示可拖动的"收尾手柄"以调整选区，全部行为在 `selectionOverlay` 开启时才生效（opt-in，向后兼容）。
> **Deliverables**:
> - 新几何模块 `src/components/selectionGeometry.ts`（rect→并集多边形→SVG path 纯函数 + 单测）
> - `IntermediateDocumentViewer.tsx` 两条渲染路径（html-parser + direct-render）统一改用 SVG `<path>` 覆盖层
> - 内置默认安卓水滴手柄（可被 `selectionHandleElement` 覆盖、可禁用），两条路径均启用且支持 mouse/touch/pen 拖动
> - 新增向后兼容类型 `ReaderSelectionOverlayPolygon` 并从 `index.ts` 导出
> - Vitest 单测 + 集成测试 + R5 回归测试
> **Effort**: Medium
> **Parallel**: YES — 3 waves（Wave1 并行 / Wave2 同文件串行 / Wave3 测试并行）+ 最终验证波
> **Critical Path**: T1（几何模块）→ T5（覆盖层集成）→ T6（手柄集成）→ T8（集成测试）→ F1-F4

## Context

### Original Request
用户原话："现在本项目的文字选框功能有很大问题"。共五点：
- **R1**（OUT OF SCOPE）：不管之前"文字选择结束要就近选择"的需求。
- **R2**：美化文字选框——原生多行/多段选区参差不齐且重叠，希望用"矩形覆盖在选中文字上"的形式替代原生选框。
- **R3**：多个选框有交集时合并，合并后是多边形也没关系，按多边形绘制即可。
- **R4**：选择结束后（鼠标/触摸/手写笔抬起）出现"收尾选择"图标，拖动它可改变选择范围（类似安卓选词）。
- **R5**：若使用方通过 props 已指定用"后渲染的选择框"，则隐去原生选框样式避免冲突。

### Interview Summary（已确认决策）
- **两条路径都要**：html-parser 路径（README 主路径）与 direct-render 回退路径行为一致。
- **手柄**：内置默认安卓水滴手柄图形；可被 `selectionHandleElement` prop 覆盖；可禁用。
- **绘制方式**：per-page SVG `<path>`，用 vendored `clipper-lib` 做并集，`fill-rule="evenodd"` 处理孔洞，clipper 用定点整数缩放（scale 1e4–1e6），支持凹多边形/孔洞/多区域。
- **测试策略**：tests-after（Vitest 单测，风格对齐现有测试）；Agent 执行的 QA 场景始终包含。
- **合并语义**：仅合并"几何相交"（含极小邻接容差）的矩形；不相交的框保持独立（避免误实现 R1）。
- **API 兼容**：保留 `ReaderSelectionOverlayRect`；新增 additive 类型 `ReaderSelectionOverlayPolygon`；consumer render-prop API 仅做新增字段，不破坏。
- **分层**：几何逻辑抽到独立模块，避免继续膨胀 2182 行的 IDV.tsx。
- **性能**：大范围选择时用 `requestAnimationFrame` 节流覆盖层重算；clipper 按页（per-page）做并集而非一次性全量。

### Metis Review（已纳入的缺口）
- MUST：覆盖两条路径；保持 opt-in（未开启 custom overlay 时行为与现版本一致）；仅合并几何相交（非邻近）；rect 提取 / 多边形并集 / SVG 渲染 / 手柄定位分层；不为手柄拖动重写整套 selection 模型；不破坏现有 consumer render-prop API（仅可新增字段）。
- QA：`npx vitest run test/*.test.tsx` 全过；相交 rect→单多边形、非相交→多多边形；跨页生成 page-local SVG path + 首尾手柄定位；启用时容器含 `--custom-selection`、未启用不含；pointerType mouse/touch/pen 拖动触发 range 重建；JSDOM 无法可靠模拟 pointer-capture 时补 Playwright。

### Oracle Phase-1 Verification → VERDICT: GO
所有 Metis 关注点均为 planner 可解的实现细节，无阻断性用户偏好分歧。关键解析：
- html-parser 手柄定位到与覆盖层同一 page/container（坐标已是 page-relative，无需 data-text-id）。
- 跨页：start 手柄在首页第一个 rect，end 手柄在末页最后一个 rect（沿用 `getSelectionHandlePositions` 模式）。
- zoom/scroll/DPR 同步：沿用现有 `getBoundingClientRect` viewport→page-relative 转换；SVG `<path>` 继承覆盖层容器坐标系。
- clipper scale 取 1e4–1e6；per-page 并集以保性能。
- JSDOM：在 `test/setup.ts` mock `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture`，用 `fireEvent.pointerDown/Move/Up` 测拖动；必要时 Playwright 补充。
- **Watch**：R5 已实现（仅验证不重建）；`clipper-lib.ts` 模块缺失时 init 抛错（确保被打包或优雅降级）；polygon 类型为新增 additive 类型。

## Work Objectives

### Core Objective
当 `selectionOverlay` 开启时，用合并后的 SVG 多边形覆盖层替代浏览器原生选区渲染，并在选择结束后提供可拖动的收尾手柄以调整选区——两条渲染路径行为一致，全程向后兼容、opt-in。

### Deliverables
- `src/components/selectionGeometry.ts`：`ReaderSelectionOverlayPolygon` 类型、`rectsToUnionPolygons`、`polygonsToSvgPath` 纯函数。
- `test/selection-geometry.test.tsx`：几何纯函数单测。
- `src/styles/reader.scss`：SVG 覆盖层 path 样式 + 默认安卓水滴手柄样式。
- `test/setup.ts`：pointer-capture mock。
- `src/index.ts`：导出 `ReaderSelectionOverlayPolygon`。
- `src/components/IntermediateDocumentViewer.tsx`：两条路径改用 SVG path 覆盖层 + 内置默认手柄启用/拖动。
- 集成与回归测试。

### Definition of Done（可验证条件）
- [x] `npx vitest run test/*.test.tsx` 全部通过（含新增测试）。
- [x] `npx tsc --noEmit`（或项目类型检查脚本）无类型错误。
- [x] 项目库构建脚本（`npm run build` / vite.lib.config.ts）成功产出 dist 且 clipper-lib 被正确打包（无 init 抛错）。
- [x] 启用 `selectionOverlay` 时：相交选框渲染为单一多边形 path；不相交渲染为多个多边形；容器含 `--custom-selection` 类。
- [x] 选择结束（pointerup/touchend/pen-up）后两条路径均显示内置默认手柄；拖动手柄重建 Range 并刷新覆盖层。
- [x] 未启用 `selectionOverlay` 时行为与改动前一致（无 SVG 覆盖层、无手柄、原生选区正常）。

### Must Have
- 两条渲染路径（html-parser + direct-render）行为一致。
- 仅几何相交合并；按页 clipper 并集；evenodd 孔洞。
- 内置默认手柄可被 prop 覆盖、可禁用。
- opt-in，向后兼容（保留旧 rect 类型与 API）。
- rAF 节流；几何逻辑分层到独立模块。

### Must NOT Have（护栏 / 反 AI-slop / 范围边界）
- 不实现 R1（"就近结束选择"）——不要因合并逻辑顺手实现它；仅合并真正几何相交的框。
- 不为手柄拖动重写整套 selection 模型——复用现有 `applyHandleDragSelection` + `getCaretFromPoint`（native caretRangeFromPoint）。
- 不破坏 `ReaderSelectionOverlayRect`、`selectionHandleElement`、`onTextSelection*` 等现有 API——只新增 additive 字段/类型。
- 不重建 R5（`--custom-selection` 已实现）——仅回归验证。
- 不删除/不破坏现有已导出且被测试的 `mergeSelectionRects`、`getSelectionOverlayRects`（手柄定位仍依赖）。
- 不引入新的第三方库——使用已 vendored 的 `clipper-lib`。
- 不在未开启 overlay 时改变任何默认行为。

## Verification Strategy
> ZERO HUMAN INTERVENTION — 所有验证均由 agent 执行。
- 测试决策：tests-after，框架 Vitest 3 + @testing-library/react 16 + jsdom 27。
- QA policy：每个任务都有 agent 可执行的 happy + failure 场景。
- Evidence：写入 `.omo/evidence/task-{N}-{slug}.{ext}`（命令输出 / 测试报告 / 截图）。
- 几何纯函数优先单测（无需 DOM）；DOM/pointer 行为用 `fireEvent` + JSDOM mock；若 pointer-capture 在 JSDOM 不可靠，补 Playwright（webapp-testing skill）。

## Execution Strategy

### Parallel Execution Waves
> 说明：本特性大量改动集中在单一 2182 行文件（IDV.tsx）、单一 SCSS、单一新几何模块，存在固有串行性；故 Wave2 为同文件串行、各 Wave 任务数偏小属合理设计，而非 under-splitting。

- **Wave 1（基础层，全部新建/独立文件，可并行）**：T1 几何模块、T2 测试 setup mock、T3 SCSS 样式、T4 index 导出。
- **Wave 2（IDV.tsx 集成，同文件串行）**：T5 覆盖层 SVG 化（两路径）、T6 内置手柄启用+拖动（两路径）。
- **Wave 3（测试/回归，可并行）**：T7 R5 回归测试、T8 跨页与集成测试。
- **Final Verification Wave**：F1–F4 并行评审。

### Dependency Matrix（全任务）
| Task | Wave | Blocked By | Blocks |
|------|------|-----------|--------|
| T1 selectionGeometry.ts | 1 | — | T4, T5, T8 |
| T2 test/setup.ts mock | 1 | — | T8 |
| T3 reader.scss | 1 | — | T5, T6 |
| T4 index.ts 导出 | 1 | T1（类型存在即可，可后置） | — |
| T5 覆盖层 SVG 集成（两路径） | 2 | T1, T3 | T6, T8 |
| T6 内置手柄启用+拖动（两路径） | 2 | T5, T3 | T8 |
| T7 R5 回归测试 | 3 | T5 | F1-F4 |
| T8 跨页+集成测试 | 3 | T5, T6, T1, T2 | F1-F4 |
| F1-F4 最终验证 | Final | T1-T8 | — |

### Agent Dispatch Summary
- Wave 1：4 任务 → T1 `visual-engineering`，T2 `quick`，T3 `visual-engineering`，T4 `quick`。
- Wave 2：2 任务（同文件串行）→ T5 `visual-engineering`，T6 `visual-engineering`。
- Wave 3：2 任务 → T7 `quick`，T8 `visual-engineering`（必要时 load `webapp-testing`）。
- Final：F1 oracle，F2 `unspecified-high`，F3 `unspecified-high`(+playwright if UI)，F4 `deep`。

## TODOs
> 规则：实现 + 测试 = 一个任务，不拆分。每个任务都必须含 Agent Profile + Parallelization + QA Scenarios。
> 执行 agent 没有访谈上下文，References 必须详尽。

- [x] 1. 创建几何模块 `src/components/selectionGeometry.ts`（rect→并集多边形→SVG path）

  **What to do**:
  - 新建 `src/components/selectionGeometry.ts`，定义并导出 additive 类型 `ReaderSelectionOverlayPolygon`（建议形状：`{ pageNumber: number; rings: Array<Array<{ x: number; y: number }>>; }`，rings[0] 为外环，其余为孔洞；或等价的 `points: number[][]` + `holes`）。在文件顶部用块注释说明数据结构含义。
  - 实现纯函数 `rectsToUnionPolygons(rects: ReaderSelectionOverlayRect[]): ReaderSelectionOverlayPolygon[]`：按 `pageNumber` 分组，**逐页**用 vendored `ClipperLib`（`src/vendor/clipper-lib.ts` 默认导出）做矩形并集（Union，subject=各矩形路径，clipType=ctUnion，fillType=pftNonZero）；坐标先乘以定点缩放因子（常量 `CLIPPER_SCALE = 1e5`，取值区间 1e4–1e6）取整传入 clipper，输出后除回。仅合并几何相交（clipper 天然处理）；为容忍亚像素邻接，可在并集前对每个矩形做极小膨胀（如 0.5px，offset 量需远小于行距，避免误并相邻行——默认不膨胀，若测试显示同词内 rect 有缝隙再启用，记为可选）。返回每页一个或多个多边形（含孔洞环）。
  - 实现纯函数 `polygonsToSvgPath(polygons: ReaderSelectionOverlayPolygon[]): string`（或 per-polygon 版本 `polygonToSvgPathD(polygon): string`）：把每个环转为 SVG path `d` 字符串（`M x y L ... Z`），多环拼接为一个 `d`，配合 `fill-rule="evenodd"` 渲染孔洞。坐标保留页内相对坐标（不做 viewport 偏移——偏移由渲染容器负责）。
  - 添加 `test/selection-geometry.test.tsx`：纯函数单测（无需 DOM）。
  - **Must NOT do**: 不在此模块做任何 DOM 读写或 React 渲染；不引用 IDV.tsx 的内部状态；不改动/不删除现有 `mergeSelectionRects`、`getSelectionOverlayRects`。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 前端几何/SVG 纯函数实现，需精确坐标处理。
  - Skills: 无强制（纯算法）；可不加载。
  - Omitted: `webapp-testing`（此任务无浏览器交互）。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T4, T5, T8 | Blocked By: —

  **References**:
  - Vendored lib: `src/vendor/clipper-lib.ts:1-19` — 默认导出 `ClipperLib`；注意模块缺失时 init 抛错，import 写法需确保被打包（直接静态 import 即可，构建任务会验证）。
  - 现有类型与并集对照: `src/components/IntermediateDocumentViewer.tsx:224`（`mergeSelectionRects`，仅做行内水平合并，2px Y 容差/2px X 邻接——本模块要做的是真正几何并集，语义不同，勿混用）、`:266`（`getSelectionOverlayRects`，返回 page-relative `ReaderSelectionOverlayRect[]`，是本模块输入来源）。
  - 类型定义: `ReaderSelectionOverlayRect = {x,y,width,height,pageNumber}`（定义在 `src/components/IntermediateDocumentViewer.tsx` 内；注意该类型当前未从 `src/index.ts` 公开导出，本模块从 IDV.tsx 直接 import 即可）。
  - 测试风格参考: `test/*.test.tsx` 现有对 `mergeSelectionRects`/`getSelectionOverlayRects` 的单测（断言风格、import 路径、mock 工厂 makeDocument/makeText）。
  - ClipperLib API 参考: Union/Clipper/Paths/IntPoint、`AddPaths(paths, polyType, closed)`、`Execute(clipType, solution, subjFillType, clipFillType)`、`pftNonZero`/`pftEvenOdd`、`ctUnion`。

  **Acceptance Criteria**:
  - [ ] `npx vitest run test/selection-geometry.test.tsx` 通过。
  - [ ] `rectsToUnionPolygons` 对两个相交矩形返回 1 个多边形；对两个分离矩形返回 2 个多边形；对同页含孔洞布局返回带 holes 环。
  - [ ] `polygonsToSvgPath` 输出以 `M` 开头、以 `Z` 结尾、多环正确拼接的合法 `d` 字符串。
  - [ ] `npx tsc --noEmit` 无类型错误。

  **QA Scenarios**:
  ```
  Scenario: 相交矩形合并为单一多边形（happy）
    Tool: Bash (vitest)
    Steps: 构造两个重叠 rect（同 pageNumber，x 区间重叠），调用 rectsToUnionPolygons；断言返回 length===1，外环顶点数>4。
    Expected: 返回单个多边形，覆盖两矩形并集轮廓。
    Evidence: .omo/evidence/task-1-geometry.txt

  Scenario: 分离矩形保持多个多边形（failure/edge）
    Tool: Bash (vitest)
    Steps: 构造两个完全不相交 rect（同页，无重叠无邻接），调用 rectsToUnionPolygons；断言返回 length===2。
    Expected: 不发生误合并（保护 R1 边界）。
    Evidence: .omo/evidence/task-1-geometry-separate.txt
  ```

  **Commit**: YES | Message: `feat(selection): add selection geometry module for polygon union` | Files: `src/components/selectionGeometry.ts`, `test/selection-geometry.test.tsx`

- [x] 2. 在 `test/setup.ts` mock pointer-capture API

  **What to do**:
  - 在 `test/setup.ts` 中为 `HTMLElement.prototype` 添加 `setPointerCapture`、`releasePointerCapture`、`hasPointerCapture` 的 no-op/stub 实现（若未定义），使 JSDOM 下手柄拖动测试不抛错。
  - 保持现有 `MockIntersectionObserver` 等 setup 不变，仅追加。
  - **Must NOT do**: 不改动现有 mock 行为；不引入真实 pointer-capture 语义（仅 stub）。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 单文件少量追加，机械性改动。
  - Skills: 无。
  - Omitted: 全部（trivial）。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T8 | Blocked By: —

  **References**:
  - `test/setup.ts` — 现有 `MockIntersectionObserver` 注册位置（在文件末尾追加同风格全局/原型 mock）。
  - Oracle 指引：mock `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture` on `HTMLElement.prototype`。

  **Acceptance Criteria**:
  - [ ] `HTMLElement.prototype.setPointerCapture` 等三方法在测试环境可调用且不抛错。
  - [ ] `npx vitest run test/*.test.tsx` 现有测试仍全部通过（无回归）。

  **QA Scenarios**:
  ```
  Scenario: pointer-capture 方法可调用（happy）
    Tool: Bash (vitest)
    Steps: 在一个最小测试中对 document.createElement('div') 调用 setPointerCapture(1)/hasPointerCapture(1)/releasePointerCapture(1)。
    Expected: 不抛异常。
    Evidence: .omo/evidence/task-2-setup.txt

  Scenario: 现有测试无回归（failure guard）
    Tool: Bash (vitest)
    Steps: 运行 npx vitest run test/*.test.tsx。
    Expected: 全部通过，无新增失败。
    Evidence: .omo/evidence/task-2-setup-regression.txt
  ```

  **Commit**: YES | Message: `test(selection): mock pointer capture in test setup` | Files: `test/setup.ts`

- [x] 3. 在 `src/styles/reader.scss` 添加 SVG 覆盖层与默认手柄样式

  **What to do**:
  - 添加 SVG 覆盖层 path 样式（建议 class `.hamster-reader__selection-overlay-path`）：`fill` 用现有 CSS 变量 `var(--hamster-reader-selection-color, #3b82f6)`，`fill-opacity` 用 `var(--hamster-reader-selection-opacity, 0.3)`，`fill-rule: evenodd`，`pointer-events: none`，`stroke: none`。SVG 容器（建议 `.hamster-reader__selection-overlay-svg`）`position:absolute; inset:0; pointer-events:none; overflow:visible`。
  - 添加内置默认安卓水滴手柄样式（建议 `.hamster-reader__selection-handle--default`，含 `--start`/`--end` 修饰符做镜像）：水滴形（圆 + 尖角，用 border-radius 或内嵌 SVG），尺寸约 18–24px，颜色复用 selection-color，`pointer-events:auto`，`cursor:grab`，`touch-action:none`（保证 pen/touch 拖动）。
  - 复用现有 BEM `hamster-reader__` 前缀，风格对齐现有 reader.scss。
  - **Must NOT do**: 不改动现有 `--custom-selection` 的 `::selection { background-color: transparent }`（line 287-294，R5 已实现）；不删除现有 `.hamster-reader__selection-overlay-block` 样式（direct-render 旧块在迁移完成前仍可能被引用，迁移后由 T5 决定是否清理）。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 视觉样式/手柄形状设计。
  - Skills: 无强制。
  - Omitted: `webapp-testing`。

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T5, T6 | Blocked By: —

  **References**:
  - `src/styles/reader.scss:287-294` — 现有 `--custom-selection` 的 `::selection` 透明规则（R5，勿动）。
  - `src/styles/reader.scss` — 现有 `.hamster-reader__selection-overlay-block`、selection 相关样式与 CSS 变量 `--hamster-reader-selection-color`/`--hamster-reader-selection-opacity` 的声明位置。
  - BEM 前缀约定：`hamster-reader__`。

  **Acceptance Criteria**:
  - [ ] 新增 `.hamster-reader__selection-overlay-path`、`.hamster-reader__selection-overlay-svg`、`.hamster-reader__selection-handle--default`（含 `--start`/`--end`）规则存在。
  - [ ] SCSS 编译无错误（运行项目 SCSS 编译/构建脚本）。
  - [ ] 手柄样式含 `touch-action:none` 与 `pointer-events:auto`；覆盖层 path 含 `pointer-events:none` 与 `fill-rule:evenodd`。

  **QA Scenarios**:
  ```
  Scenario: SCSS 编译通过（happy）
    Tool: Bash
    Steps: 运行项目 SCSS 编译/构建脚本（如 npm run build 中的 scss 步骤）。
    Expected: 无编译错误，输出含新 class。
    Evidence: .omo/evidence/task-3-scss.txt

  Scenario: 未破坏 R5 规则（failure guard）
    Tool: Grep
    Steps: 在 reader.scss 搜索 `--custom-selection` 与 `::selection`，确认透明规则仍存在。
    Expected: R5 规则保持不变。
    Evidence: .omo/evidence/task-3-scss-r5.txt
  ```

  **Commit**: YES | Message: `style(selection): add svg overlay path and default handle styles` | Files: `src/styles/reader.scss`

- [x] 4. 在 `src/index.ts` 导出 `ReaderSelectionOverlayPolygon` 类型

  **What to do**:
  - 在 `src/index.ts` 追加再导出 T1 新增的 `ReaderSelectionOverlayPolygon` 类型。由于 T1 把该类型定义在 `src/components/selectionGeometry.ts`，新增一行：`export { type ReaderSelectionOverlayPolygon } from './components/selectionGeometry'`（与现有从 `./components/IntermediateDocumentViewer` 的 type-only 再导出风格一致）。
  - **注意**：当前 `src/index.ts` 仅导出 `IntermediateDocumentViewer`、`IntermediateDocumentViewerProps`、`BackgroundQuality`、`ReaderPageRange`、`ReaderSelectionOverlayOptions`、`ReaderSelectionHandleRenderProps`、`ReaderTextSelectionDetail`、`Reader`、`ReaderProps`、`ReaderInteractiveProps`（见 `src/index.ts:1-15`）。`ReaderSelectionOverlayRect` 与 `ReaderSelectionHandlePosition` 目前**并未**从 index 导出——本任务不要假设它们已导出；如执行 agent 判断 consumer 也需要 polygon 的姊妹 rect 类型，可一并 additive 导出 `ReaderSelectionOverlayRect`（可选，不强制）。
  - **Must NOT do**: 不改动/不移除任何现有导出；不改变现有类型形状；不把不存在的导出写进断言。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 单行再导出。
  - Skills: 无。
  - Omitted: 全部。

  **Parallelization**: Can Parallel: YES（仅需 T1 的类型存在；若与 T1 并行需协调，建议 T1 落地后执行或同 agent 串行） | Wave 1 | Blocks: — | Blocked By: T1（类型定义）

  **References**:
  - `src/index.ts:1-15` — 现有 type-only 再导出块（`export { type ... } from './components/IntermediateDocumentViewer'`），照同样模式新增一行从 `./components/selectionGeometry` 导出 polygon 类型。
  - `src/components/selectionGeometry.ts`（T1 产出）— `ReaderSelectionOverlayPolygon` 类型来源。

  **Acceptance Criteria**:
  - [ ] `src/index.ts` 新增 `ReaderSelectionOverlayPolygon` 的 type-only 再导出。
  - [ ] `import type { ReaderSelectionOverlayPolygon } from '<pkg-entry>'` 可解析（`npx tsc --noEmit` 验证）。
  - [ ] `npx tsc --noEmit` 无类型错误。
  - [ ] 改动前已有的 7 个 type 导出（`IntermediateDocumentViewerProps`/`BackgroundQuality`/`ReaderPageRange`/`ReaderSelectionOverlayOptions`/`ReaderSelectionHandleRenderProps`/`ReaderTextSelectionDetail`/`ReaderProps`）全部保留。

  **QA Scenarios**:
  ```
  Scenario: 新类型可被外部导入（happy）
    Tool: Bash (tsc)
    Steps: 运行 npx tsc --noEmit；在一个临时/测试文件中 `import type { ReaderSelectionOverlayPolygon } from '../src'` 并用作类型注解。
    Expected: 类型解析成功，无错误。
    Evidence: .omo/evidence/task-4-index.txt

  Scenario: 现有导出无丢失（failure guard）
    Tool: Grep
    Steps: 在 src/index.ts grep 现有导出名：`ReaderSelectionOverlayOptions`、`ReaderSelectionHandleRenderProps`、`ReaderTextSelectionDetail`、`IntermediateDocumentViewerProps`，确认仍存在。
    Expected: 上述现有导出全部保留（不 grep 不存在的 Rect/HandlePosition）。
    Evidence: .omo/evidence/task-4-index-exports.txt
  ```

  **Commit**: YES | Message: `feat(selection): export ReaderSelectionOverlayPolygon type` | Files: `src/index.ts`

- [x] 5. IDV.tsx：两条路径覆盖层改用合并 SVG 多边形（R2 + R3）

  **What to do**:
  - 在 `IntermediateDocumentViewer.tsx` 的 `refreshSelectionOverlay`（line 1556 起）中，把现有"逐页 `<div class="hamster-reader__selection-overlay-block">` innerHTML 注入"替换为"逐页 `<svg class="hamster-reader__selection-overlay-svg">` 内嵌 `<path class="hamster-reader__selection-overlay-path" fill-rule="evenodd" d="...">`"。
  - 新增 `getSelectionOverlayPolygons(...)`（在 IDV.tsx 内或调用 T1 模块）：以现有 `getSelectionOverlayRects` 的 page-relative rects 为输入，调用 `rectsToUnionPolygons` 得到多边形，再用 `polygonsToSvgPath` 生成 `d`。**保留** `getSelectionOverlayRects` 原样（手柄定位 T6 仍依赖）。
  - 两条路径都改：
    - direct-render 路径（line 1608 起，per-page 容器）：每页容器注入一个 SVG，path 用该页多边形。坐标系沿用现有 page-relative（viewport→page-relative 转换已存在，line 266 区域）。
    - html-parser 路径（line 1556 起，单容器 + `getHtmlParserSelectionOverlayRects` line 339，pageNumber:1 sentinel）：同样用并集多边形生成 SVG path 注入该容器。
  - 性能：用 `requestAnimationFrame` 节流 `refreshSelectionOverlay` 的重算（大范围选择时合并多次 selectionchange 到一帧）；cancel 上一帧未执行的 rAF。
  - zoom/scroll/resize 时覆盖层重算：沿用现有 resize/scroll useEffect（line 1652）触发 refresh，确认 SVG 路径随之更新。
  - **Must NOT do**: 不删除 `getSelectionOverlayRects`/`mergeSelectionRects`；不改变 `selectionOverlay` 关闭时的行为（关闭时不渲染 SVG）；不做跨页一次性并集（按页）；不实现 R1。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 核心渲染集成，DOM/SVG/坐标系。
  - Skills: 无强制（可选 `vercel-react-best-practices` 关注 rAF/重渲染）。
  - Omitted: `webapp-testing`（集成测试在 T8）。

  **Parallelization**: Can Parallel: NO（与 T6 同改 IDV.tsx，串行） | Wave 2 | Blocks: T6, T8 | Blocked By: T1, T3

  **References**:
  - `src/components/IntermediateDocumentViewer.tsx:1556` — `refreshSelectionOverlay`（useCallback dep `[overlayOptions]`），两路径分支起点。
  - `:1608` — direct-render per-page 注入分支；`:339` — `getHtmlParserSelectionOverlayRects`（html-parser 单容器、pageNumber:1 sentinel）。
  - `:266` — `getSelectionOverlayRects`（viewport→page-relative 转换，保留作手柄输入）；`:224` — `mergeSelectionRects`（保留）。
  - T1 模块：`src/components/selectionGeometry.ts`（`rectsToUnionPolygons`/`polygonsToSvgPath`/`ReaderSelectionOverlayPolygon`）。
  - T3 样式：`.hamster-reader__selection-overlay-svg` / `.hamster-reader__selection-overlay-path`。
  - `:1524` — `--custom-selection` 根类（opt-in 判定 `overlayOptions?.enabled`，勿动）。
  - `:995-1005` — `overlayOptions` memo（null=disabled），渲染前判定。

  **Acceptance Criteria**:
  - [ ] 启用 `selectionOverlay` 选择多行文字时，两条路径均渲染 SVG `<path>`（DOM 含 `.hamster-reader__selection-overlay-path`），不再注入 `selection-overlay-block` div。
  - [ ] 相交选框在 path `d` 中表现为单一连通多边形；不相交为多个子路径/多个 path。
  - [ ] 关闭 `selectionOverlay` 时无 SVG 覆盖层、原生选区正常。
  - [ ] `npx vitest run test/*.test.tsx` 全过（含现有 getSelectionOverlayRects 测试仍通过）。
  - [ ] `npx tsc --noEmit` 无错误。

  **QA Scenarios**:
  ```
  Scenario: 多行选择渲染合并 SVG 多边形（happy）
    Tool: Bash (vitest) + 可选 Playwright
    Steps: 渲染 Reader（selectionOverlay 开启），构造跨多行 Range，触发 selectionchange；查询容器内 .hamster-reader__selection-overlay-path 元素及其 d 属性非空。
    Expected: 至少一个 path，d 以 M 开头含 Z；无 selection-overlay-block div。
    Evidence: .omo/evidence/task-5-overlay.txt

  Scenario: 关闭 overlay 不渲染（failure guard）
    Tool: Bash (vitest)
    Steps: 渲染 Reader（selectionOverlay=false 或未传），构造选择；查询 .hamster-reader__selection-overlay-path。
    Expected: 不存在 SVG 覆盖层；行为与改动前一致。
    Evidence: .omo/evidence/task-5-overlay-disabled.txt
  ```

  **Commit**: YES | Message: `feat(selection): render selection overlay as merged svg polygons on both paths` | Files: `src/components/IntermediateDocumentViewer.tsx`

- [x] 6. IDV.tsx：两条路径启用内置默认手柄 + 选择结束显示 + 拖动调整（R4 + 手柄部分 R2）

  **What to do**:
  - 内置默认手柄：当未传 `selectionHandleElement` 时，渲染内置安卓水滴手柄（用 T3 的 `.hamster-reader__selection-handle--default --start/--end`）。当传入 `selectionHandleElement` 时沿用现有 `renderSelectionHandle`（line 820，cloneElement 注入 `ReaderSelectionHandleRenderProps`）。提供禁用语义：`selectionHandleElement={null}` 表示显式禁用手柄（不渲染默认也不渲染自定义）——在 `renderSelectionHandle`/手柄渲染判定处区分 `undefined`（用默认）与 `null`（禁用）。
  - 两条路径都显示手柄：html-parser 路径当前在 line 1594 用 `setSelectionHandlePositions([])` **禁用**了手柄——改为同样计算手柄位置（用 `getSelectionHandlePositions` line 789 模式：start=首页第一个 rect 左下，end=末页最后一个 rect 右下，按 pageNumber/y/x 排序）。html-parser 手柄定位到与覆盖层同一容器坐标系（page-relative，无需 data-text-id）。
  - 选择结束才显示：手柄在 selection-end（pointerup/touchend/pen-up，复用 `emitSelectionEnd` line 1793 / mouseup/touchend/keyup useEffect）后出现；选择进行中可不显示或显示（沿用现有 selectionchange 行为，但确保结束后稳定显示）。
  - 拖动调整选区（两路径）：复用现有 pointerdown/move/up（line 1874-1999）+ `setPointerCapture` + `applyHandleDragSelection`（line 1825，经 `getCaretFromPoint` line 862 → `document.createRange` + `selection.addRange` → `refreshSelectionOverlay`）。确认 html-parser 路径下 `getCaretFromPoint`（caretPositionFromPoint→caretRangeFromPoint→fallback）对真实 text node 有效，**无需 data-text-id**。支持 `pointerType` 为 mouse/touch/pen（事件处理对三者一致；touch/pen 依赖 T3 的 `touch-action:none`）。
  - **Must NOT do**: 不重写 selection 模型（仅复用 applyHandleDragSelection）；不改变 `ReaderSelectionHandleRenderProps` 形状（仅可新增字段）；不破坏自定义 `selectionHandleElement` 现有行为；不在 overlay 关闭时显示手柄。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 交互 + DOM 定位 + 渲染分支。
  - Skills: 无强制。
  - Omitted: `webapp-testing`（测试在 T8）。

  **Parallelization**: Can Parallel: NO（与 T5 同改 IDV.tsx，串行，T5 后） | Wave 2 | Blocks: T8 | Blocked By: T5, T3

  **References**:
  - `:789` — `getSelectionHandlePositions`（start/end 定位 + 排序规则，跨页首尾页取法）。
  - `:820` — `renderSelectionHandle`（cloneElement 注入 `ReaderSelectionHandleRenderProps {type,position,isDragging}`）。
  - `:1594` — html-parser 当前 `setSelectionHandlePositions([])`（需改为真实计算）。
  - `:1617` — direct-render 手柄渲染分支（参照其位置/容器）。
  - `:1793` — `emitSelectionEnd`（selection-end 时机：mouseup/touchend/keyup useEffect）。
  - `:1825` — `applyHandleDragSelection`（Range 重建：createRange + addRange + refreshSelectionOverlay，复用）。
  - `:862` — `getCaretFromPoint`（caretPositionFromPoint→caretRangeFromPoint→fallback，对真实 text node 有效，无需 data-text-id）。
  - `:1874-1999` — 手柄 pointerdown/move/up + setPointerCapture（复用，确保 pointerType mouse/touch/pen 一致）。
  - 类型：`ReaderSelectionHandlePosition={x,y,pageNumber}`、`ReaderSelectionHandleRenderProps={type:'start'|'end',position,isDragging}`（仅可新增字段）。
  - T3 样式：`.hamster-reader__selection-handle--default`（`touch-action:none`）。

  **Acceptance Criteria**:
  - [ ] 未传 `selectionHandleElement` 时，选择结束后两条路径均显示内置默认手柄（start + end）。
  - [ ] 传入 `selectionHandleElement` 时沿用自定义渲染（现有行为不变）；`selectionHandleElement={null}` 时不显示任何手柄。
  - [ ] html-parser 路径不再恒为空手柄（line 1594 改造生效），手柄位置位于选区首尾。
  - [ ] 拖动手柄（fireEvent.pointerDown/Move/Up，pointerType mouse/touch/pen）触发 `applyHandleDragSelection` 重建 Range 并刷新覆盖层。
  - [ ] 跨页选择：start 手柄在首页第一个 rect，end 在末页最后一个 rect。
  - [ ] `npx vitest run test/*.test.tsx` 全过；`npx tsc --noEmit` 无错误。

  **QA Scenarios**:
  ```
  Scenario: 选择结束后两路径显示默认手柄并可拖动（happy）
    Tool: Bash (vitest, T2 mock) + 可选 Playwright
    Steps: 渲染 Reader（overlay 开启，不传 selectionHandleElement），构造 Range，触发 selectionchange + mouseup；断言出现两个默认手柄；对 end 手柄 fireEvent.pointerDown→pointerMove(新坐标)→pointerUp（pointerType:'touch'）；断言 Range/覆盖层更新。
    Expected: 手柄出现；拖动后选区范围改变、path d 变化。
    Evidence: .omo/evidence/task-6-handles.txt

  Scenario: selectionHandleElement={null} 禁用手柄（failure/edge）
    Tool: Bash (vitest)
    Steps: 渲染 Reader（overlay 开启，selectionHandleElement={null}），构造选择 + 结束；查询手柄元素。
    Expected: 无任何手柄渲染（默认与自定义都不渲染）。
    Evidence: .omo/evidence/task-6-handles-disabled.txt
  ```

  **Commit**: YES | Message: `feat(selection): enable built-in draggable handles on both render paths` | Files: `src/components/IntermediateDocumentViewer.tsx`

- [x] 7. R5 回归测试：原生选区抑制（仅验证，不重建）

  **What to do**:
  - 新增/补充测试，验证：启用 `selectionOverlay` 时根容器含 `hamster-reader__intermediate-document-viewer--custom-selection` 类（line 1524）；未启用时不含。
  - 验证 SCSS 中 `--custom-selection` 下 `::selection { background-color: transparent }`（line 287-294）规则仍存在（可用 grep/快照层面，或断言根 class 存在即代表样式钩子生效）。
  - **Must NOT do**: 不修改 R5 实现代码；不新增 R5 逻辑；仅做回归断言。

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 仅断言现有行为。
  - Skills: 无。
  - Omitted: 全部。

  **Parallelization**: Can Parallel: YES（与 T8 并行，不同测试文件） | Wave 3 | Blocks: F1-F4 | Blocked By: T5

  **References**:
  - `:1524` — rootClassName 添加 `--custom-selection`（判定 `overlayOptions?.enabled`）。
  - `src/styles/reader.scss:287-294` — `::selection` 透明规则。
  - `test/*.test.tsx` — 现有渲染 + class 断言风格、makeDocument/makeText。

  **Acceptance Criteria**:
  - [ ] 测试：overlay 启用 → 根容器含 `--custom-selection`；未启用 → 不含。
  - [ ] 测试通过：`npx vitest run test/*.test.tsx`。

  **QA Scenarios**:
  ```
  Scenario: 启用时类存在（happy）
    Tool: Bash (vitest)
    Steps: 渲染 Reader（selectionOverlay 开启），查询根元素 className 含 --custom-selection。
    Expected: 含该类。
    Evidence: .omo/evidence/task-7-r5.txt

  Scenario: 未启用时类缺失（failure guard）
    Tool: Bash (vitest)
    Steps: 渲染 Reader（未传 selectionOverlay），查询根元素 className。
    Expected: 不含 --custom-selection。
    Evidence: .omo/evidence/task-7-r5-off.txt
  ```

  **Commit**: YES | Message: `test(selection): regression for native selection suppression (R5)` | Files: `test/*.test.tsx`（新增或现有渲染测试文件）

- [x] 8. 跨页与集成测试（多边形合并 / 跨页路径 / 手柄定位 / pointer 拖动）

  **What to do**:
  - 新增集成测试覆盖：
    - 相交选框 → 单一多边形 path；不相交 → 多个多边形（端到端经 `refreshSelectionOverlay`，而非仅纯函数，验证 T5 集成）。
    - 跨页选择 → 每页生成 page-local SVG path（断言不同 pageNumber 容器各有 path，坐标为页内相对）。
    - 手柄定位：start 在首页首 rect、end 在末页末 rect。
    - pointer 拖动：`pointerType` 为 mouse/touch/pen 时 `fireEvent.pointerDown/Move/Up` 触发 `applyHandleDragSelection`（断言 Range 重建/覆盖层刷新被调用或选区改变）。依赖 T2 的 pointer-capture mock。
  - 若 JSDOM 下 pointer-capture/caret-from-point 行为不可靠导致拖动断言不稳定，补一个 Playwright 场景（load `webapp-testing` skill）覆盖真实浏览器拖动。
  - 运行 `npx vitest run test/*.test.tsx` 确保全绿。
  - **Must NOT do**: 不为通过测试而放宽实现；不删除现有测试；不测试 R1 行为（确认其未实现即可）。

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: DOM/交互集成测试。
  - Skills: `webapp-testing`（仅当需要 Playwright 补充真实 pointer 拖动时加载）。
  - Omitted: 默认不加载 Playwright（优先 JSDOM；不稳时再补）。

  **Parallelization**: Can Parallel: YES（与 T7 并行，不同测试文件） | Wave 3 | Blocks: F1-F4 | Blocked By: T5, T6, T1, T2

  **References**:
  - T1 `selectionGeometry.ts`、T5/T6 IDV.tsx 改动、T2 `test/setup.ts` mock。
  - `:789` 手柄定位、`:1825` applyHandleDragSelection、`:862` getCaretFromPoint、`:1874-1999` pointer handlers。
  - `test/*.test.tsx` 现有集成测试风格、makeDocument/makeText（构造跨页文档）、`data-testid` 约定。
  - webapp-testing skill（仅 Playwright 补充时）。

  **Acceptance Criteria**:
  - [ ] 集成测试：相交→单 path、不相交→多 path（经完整 refresh 流程）。
  - [ ] 集成测试：跨页选择各页容器均有 page-local path。
  - [ ] 集成测试：首尾手柄定位正确。
  - [ ] 集成测试：mouse/touch/pen 三种 pointerType 拖动触发 range 重建。
  - [ ] `npx vitest run test/*.test.tsx` 全部通过。

  **QA Scenarios**:
  ```
  Scenario: 跨页选择生成 page-local 多边形（happy）
    Tool: Bash (vitest)
    Steps: makeDocument 构造≥2 页，构造跨页 Range，触发 refresh；断言两页容器各含 .hamster-reader__selection-overlay-path，坐标为页内相对（y 不累加跨页偏移）。
    Expected: 每页独立 path，坐标正确。
    Evidence: .omo/evidence/task-8-crosspage.txt

  Scenario: pen 拖动手柄重建选区（failure/edge）
    Tool: Bash (vitest, T2 mock) / Playwright fallback
    Steps: 选择→结束→对 end 手柄 fireEvent.pointerDown/Move/Up（pointerType:'pen'）；断言 applyHandleDragSelection 路径执行、选区或 path 变化。
    Expected: pen 与 mouse/touch 行为一致，选区改变。
    Evidence: .omo/evidence/task-8-pen-drag.txt
  ```

  **Commit**: YES | Message: `test(selection): cross-page and pointer-drag integration tests` | Files: `test/*.test.tsx`（新增集成测试文件，可选 Playwright spec）




## Final Verification Wave（MANDATORY — 在所有实现任务之后）
> 4 个评审 agent 并行运行。全部 APPROVE 后将合并结果呈现给用户，取得用户明确 "okay" 后才可标记完成。
> **验证后不要自动继续。等待用户明确批准再标记工作完成。**
> **在取得用户 okay 之前，绝不勾选 F1-F4。** 被拒或有反馈 → 修复 → 重跑 → 再呈现 → 等待 okay。
- [x] F1. Plan Compliance Audit — oracle（核对计划每条 MUST/MUST NOT 落实，两路径一致性，opt-in 未破坏）

  **QA Scenario**:
  ```
  Scenario: 逐条核对计划 MUST/MUST NOT
    Tool: oracle (read-only) + Grep/Read
    Steps: 读取 .omo/plans/selection-overlay-polygon.md 的 "Must Have" 与 "Must NOT Have"；对每条逐一在改动后的 src/ 代码中核验落实情况（两条渲染路径都接入 SVG polygon、handle 在两路径都启用、仅合并几何相交、几何逻辑在 selectionGeometry.ts 分层、未重写 selection 模型、未删现有 API）。
    Expected: 每条 MUST 给出对应代码位置证据；每条 MUST NOT 给出"未违反"证据。任一未落实 = 整体 REJECT。
    Evidence: .omo/evidence/final-f1-compliance.md
  ```

- [x] F2. Code Quality Review — unspecified-high（几何模块分层、无重复、命名/BEM 一致、无 AI slop）

  **QA Scenario**:
  ```
  Scenario: 代码质量与 AI slop 审查
    Tool: Bash (tsc/eslint) + Read
    Steps: 运行 `npx tsc --noEmit` 与项目 lint（若有）；人工/agent 通读 selectionGeometry.ts 与 IDV.tsx 改动 diff，检查：无复制粘贴重复、无无用注释/占位、BEM 前缀 `hamster-reader__` 一致、无 console.log、无死代码、clipper-lib 导入有 graceful 处理。
    Expected: tsc/lint 零错误；diff 无 AI slop（冗余注释、无意义抽象、未用变量）。有问题 = REJECT 并列出。
    Evidence: .omo/evidence/final-f2-quality.md
  ```

- [x] F3. Real Manual QA — unspecified-high（+ playwright if UI；实际选择→多边形→手柄拖动全流程）

  **QA Scenario**:
  ```
  Scenario: 端到端真实交互（happy + 失败路径）
    Tool: Playwright (webapp-testing skill) + Bash (vitest)
    Steps: (1) `npx vitest run test/*.test.tsx` 全绿。(2) 启动 demo/dev 页面，鼠标拖选跨行/跨段文字 → 截图确认渲染为合并 SVG 多边形（非参差原生框）；选区相交处合并为单一多边形。(3) 选择结束后确认首尾出现默认手柄；拖动 end 手柄扩大选区 → 截图确认 Range 重建且 overlay 跟随。(4) pointerType=touch/pen 重复拖动（或 fireEvent 模拟）。(5) 失败路径：在无文字空白区拖动 → 确认无残留 overlay/手柄、无报错。
    Expected: 每步截图与预期一致；vitest 全过；失败路径优雅无异常。
    Evidence: .omo/evidence/final-f3-manual-qa/（截图 + vitest 输出）
  ```

- [x] F4. Scope Fidelity Check — deep（确认未实现 R1、未重建 R5、未破坏现有 API、无范围蔓延）

  **QA Scenario**:
  ```
  Scenario: 范围保真核对
    Tool: deep agent + Grep/Read + git diff
    Steps: 审 `git diff` 全量改动；逐项确认：(a) 未实现"就近选择/吸附结束点"逻辑(R1)——无新增就近/snap 相关代码；(b) R5 的 `--custom-selection` 类与 `::selection{transparent}` 为原样复用非重建；(c) 现有公开导出与 render-prop API 仅 additive 未变形；(d) 改动仅落在计划列出的文件（selectionGeometry.ts/test/setup.ts/reader.scss/index.ts/IDV.tsx/新增测试），无范围外文件。
    Expected: 四项全部确认；任一越界 = REJECT 并指明 diff 位置。
    Evidence: .omo/evidence/final-f4-scope.md
  ```

## Commit Strategy
- 每个 Wave 完成后提交一次（或每任务一次），message 用 Conventional Commits。
- 建议提交点：
  - `feat(selection): add selection geometry module for polygon union` (T1)
  - `test(selection): mock pointer capture in test setup` (T2)
  - `style(selection): add svg overlay path and default handle styles` (T3)
  - `feat(selection): export ReaderSelectionOverlayPolygon type` (T4)
  - `feat(selection): render selection overlay as merged svg polygons on both paths` (T5)
  - `feat(selection): enable built-in draggable handles on both render paths` (T6)
  - `test(selection): regression for native selection suppression (R5)` (T7)
  - `test(selection): cross-page and pointer-drag integration tests` (T8)

## Success Criteria
- 全部 Definition of Done 勾选完成。
- R2/R3/R4/R5 行为可在测试/QA 中验证；R1 明确未实现。
- 两条渲染路径行为一致；opt-in 未破坏；现有测试全过。
- Final Verification Wave F1-F4 全部 APPROVE 且用户明确 okay。
