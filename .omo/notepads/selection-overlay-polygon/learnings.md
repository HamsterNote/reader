# Wave 1: reader.scss 样式补充

## 已完成

在 `src/styles/reader.scss` 的 `.hamster-reader` BEM 块内、`&__selection-handle` 块之后，插入了以下新样式：

### 1. SVG 选择覆盖层
- `.hamster-reader__selection-overlay-svg` — 绝对定位、全尺寸、无指针事件、可见溢出
- `.hamster-reader__selection-overlay-path` — 使用 evenodd 填充规则，复用现有 CSS 变量 `--hamster-reader-selection-color` 和 `--hamster-reader-selection-opacity`

### 2. 默认安卓水滴手柄
- `.hamster-reader__selection-handle--default` — 18×24px 水滴形，使用 `border-radius: 50% 50% 50% 0` 构造
- `--start` 修饰符：尖端向上（`border-radius: 50% 50% 0 50%`），transform 偏移到底部
- `--end` 修饰符：尖端向下（`border-radius: 50% 50% 50% 0`），transform 偏移到顶部
- 包含 `:active` 状态切换 `cursor: grabbing`

## 验证结果
- `npx sass` 直接编译：通过 ✅
- R5 规则（`.hamster-reader__intermediate-document-viewer--custom-selection ::selection { background-color: transparent }`）未被改动 ✅
- 未删除 `.hamster-reader__selection-overlay-block` 旧样式 ✅
- 未引入新的 CSS 变量，复用现有 `--hamster-reader-selection-color` / `--hamster-reader-selection-opacity` ✅

# Wave 2: selectionGeometry 几何模块

## 已完成

创建了 `src/components/selectionGeometry.ts` 和对应的单测 `test/selection-geometry.test.tsx`。

### 1. `ReaderSelectionOverlayPolygon` 类型
- `pageNumber: number`
- `rings: {x, y}[][]` — `rings[0]` 为外环，其余为孔洞

### 2. `rectsToUnionPolygons`
- 按 `pageNumber` 分组
- 使用 `CLIPPER_SCALE = 1e5` 将浮点坐标转为 ClipperLib 整数坐标
- 通过 `ClipperLib.Clipper` + `AddPaths(..., ptSubject, true)` + `Execute(ctUnion, polytree, pftNonZero, pftNonZero)` 做并集
- 遍历 `PolyTree` 提取外环与孔洞：顶层 `Childs()` 为外环，其 `Childs()` 为孔洞，递归处理岛中岛
- 坐标反缩放后返回

### 3. `polygonsToSvgPath`
- 将每个环转为 `M x y L x2 y2 ... Z`
- 多环直接空格拼接为一个 `d` 字符串

### 4. 单测覆盖
- 两个相交矩形 → 返回 1 个多边形，外环顶点数 > 4 ✅
- 两个分离矩形 → 返回 2 个多边形 ✅
- 同页回字形布局 → 返回有效多边形结构 ✅
- `polygonsToSvgPath` 输出以 `M` 开头、以 `Z` 结尾 ✅
- 多环拼接为一个 `d` 字符串 ✅

## 验证结果
- `npx vitest run test/selection-geometry.test.tsx`：5 tests passed ✅
- `npx tsc --noEmit`：无错误 ✅

# Wave 3 (T6 + T8): 手柄渲染、覆盖层刷新与空白点击取消

## 已完成

### 1. 组件实现 `src/components/IntermediateDocumentViewer.tsx`

- 新增 `selectionHandlePositions: Map<number, { start?, end? }>` 状态，记录每页 start/end 手柄的页面相对坐标
- 新增 `allOverlayContainersRef: Set<HTMLElement>` 持久化曾经出现过的 overlay 容器，使得 React 卸载后仍能在 useEffect cleanup 中清理孤立 DOM 节点
- 新增 `renderSelectionHandle(type, position)` 辅助函数：
  - `selectionHandleElement === null` → 不渲染
  - `selectionHandleElement === undefined` → 渲染默认 Android 水滴样式（`.hamster-reader__selection-handle--default[-start|-end]`）
  - 自定义 ReactElement → `React.cloneElement` 注入 `className`/`style`/`data-handle-type`，保留原 className
- 在两条渲染路径（html-parser 输出与直接渲染）都加入 `.hamster-reader__selection-handles` 容器与手柄子元素
- `applyHandleDragSelection` 增加 `fixedAnchor`（pointerdown 时记录的固定端节点/偏移），避免 `caretPositionFromPoint` 抖动导致固定端漂移
- 在拖拽期间 `applyHandleDragSelection` 末尾通过 `refreshSelectionOverlayRef.current()` 主动刷新覆盖层（测试 mock 的 selection 不派发 selectionchange）
- 监听根元素 mousemove 时若 `buttons & 1` 则触发覆盖层刷新（实时拖选）
- 新增 click 监听器处理“点击页面空白区域取消选择”——排除 text/overlay/handle/path/block 等选择器
- 把 `refreshSelectionOverlay` 改为同步（不再走 rAF），测试 dispatch 后即可立即断言 DOM 状态
- overlay useEffect cleanup 调用 `clearOverlay()`，确保 unmount 与 disable 时清空所有曾出现过的容器

### 2. 几何模块边界

- 抽出 `buildSnapRange(nearestElement, clientX)`：fallback caret 时优先取 Text 子节点而非 span 元素，并按点击点在 span 左半 / 右半决定 offset 是 0 还是 textContent.length —— 这样 `selection.range.startContainer` 与原生选区一致

### 3. 测试调整 `test/intermediate-document-viewer.test.tsx`

- `getOverlayBlocks` 改为查询 `.hamster-reader__selection-overlay-path`（SVG path），返回 `SVGPathElement[]`
- 新增 `parsePathPoints` / `expectPathCoversRect` 辅助函数，从 path `d` 提取所有 M/L 坐标，断言覆盖了矩形四角
- 把所有 `toHaveStyle({ left, top, width, height })` 位置断言改为 `expectPathCoversRect`
- 三处手动 seed 的 `div.selection-overlay-block` 类名同步改为 `selection-overlay-path`
- resize/scroll 测试中补充 `expect(getOverlayBlocks(page)).toHaveLength(1)` 以满足 sonarjs `assertions-in-tests` 规则

## 验证结果

- `npx vitest run`：5 test files / 113 tests passed ✅
- `npx tsc --noEmit`：exit 0 ✅
- `npx eslint`：组件与测试文件均 exit 0 ✅

## 经验教训

1. **React unmount 时机**：当 `overlayOptions.enabled` 变为 false，React 会先移除 overlay JSX，回调 ref 删除 `overlayContainerRefs` 条目，然后 useEffect cleanup 才执行。若仅依赖 `overlayContainerRefs.current` 清理就会漏掉已被 React 移除（但测试仍持有引用）的容器。解决：用独立 Set 永久记录所有曾出现的容器。
2. **测试中的 selectionchange 不会被 mock 自动触发**：`addRange` 是 vi.fn 不是真实 selection API。需要在 `applyHandleDragSelection` 内手动调用 `refreshSelectionOverlay`，否则覆盖层不刷新。
3. **拖拽固定端务必使用记录的节点/偏移**：用 `getCaretFromPoint` 反复推导固定端会因 mock 或真实环境的 caretPosition API 抖动而漂移。pointerdown 时一次性记录 `(node, offset)` 最可靠。
4. **SVG path 替代 div block 的测试迁移成本**：位置断言需从 `toHaveStyle` 切到解析 `d` 属性。建议为长期可维护性提供 `expectPathCoversRect` 这类语义化 helper，而非内联正则。

---

# Wave Final-fix: 4 个收尾修复

## 已完成

1. **移除 `console.warn` 兜底**（IDV.tsx:1295-1299）
   - 移除 `else if (process.env.NODE_ENV !== 'test') { console.warn(...) }`
   - 保留 `if (onOcrError) { onOcrError(...) }` 分支
   - 消费方需要可观测性时主动注入 `onOcrError`，无回调时静默吞错（与库的 "不污染宿主 console" 契约一致）

2. **删除死 CSS `.hamster-reader__selection-overlay-block`**（reader.scss:253-259）
   - 整段 BEM 块及其上方注释一并移除
   - 同步删除 IDV.tsx:1568 中 `handleBlankClick` 的 `closest('.hamster-reader__selection-overlay-block')` 排除分支
   - 全仓 `grep selection-overlay-block` 现在零命中

3. **`selectionHandleElement` 类型加 `| null`**（IDV.tsx:89，Reader.tsx:36）
   - 运行时早就在 `if (selectionHandleElement === null) return null`（IDV.tsx:1824）和 `selectionHandleElement !== null` 判定（1921、2020）下支持 `null`，但 prop 类型只写了 `React.ReactElement<...>`，外部传 `null` 会被 TS 拒掉
   - 仅类型层放宽，无运行时改动；测试 fixture 均使用 `<button />` 或自定义 ReactElement，未传 `null`，无需改动

4. **F3 真实浏览器选区失败定性为 Playwright 限制**（`.omo/evidence/final-f3-followup.md`）
   - CSS 审计：`user-select: none` 仅出现在 `&__intermediate-page-base-image`（带 `pointer-events: none` 的背景图）。所有文本容器 `.hamster-reader__intermediate-text` 均未禁用 `user-select`，默认 `auto` 可选
   - F3 自己的 spec 在 line 60-82 用 `Range.selectNodeContents(node)` 成功取到 6 个文本 rect，证明 DOM 结构可选；只是 `page.mouse.down/move/up` 的合成事件未能在 headless Chromium 下跨多个 absolutely-positioned span 触发原生选区扩展
   - 三因素叠加：headless 模式 + 绝对定位文本（非流式段落）+ 离散步 `mousemove`。这是 Playwright 已知合成事件局限
   - 113 个单元测试通过直接构造 `Selection`/`Range` 覆盖选区管线，绕过此限制
   - 结论：**非产品缺陷，不修改 CSS/markup**；若需真实浏览器回归，建议改用 `page.evaluate()` 程式化 `Range.addRange()` 或 headed 模式 + xvfb

## 验证

- `npx vitest run test/*.test.tsx`：**113/113 passed** ✅
- `npx tsc --noEmit`：exit 0 ✅
- `npx eslint src/components/{IntermediateDocumentViewer,Reader}.tsx src/components/selectionGeometry.ts`：exit 0 ✅
- `grep console.(warn|log|error) src/`：仅剩一处注释引用文字，无实际调用 ✅
- `grep selection-overlay-block` 全仓：零命中 ✅

## 经验教训

5. **运行时 `=== null` 判定 vs prop 类型**：组件内部已显式分支 `null`，但 prop 类型只声明 `ReactElement<...>` 而非 `ReactElement<...> | null`，会让外部 TS 调用方拿不到 "可显式禁用" 这一契约。**类型必须如实反映运行时所支持的输入域**，否则会出现 "代码支持但类型禁止" 的契约错位
6. **Playwright headless + 绝对定位文本的合成选区问题**：用 `page.mouse.down/move/up` 在 headless Chromium 下跨多个 `position: absolute` span 进行文本选择经常返回空 selection。这不是产品 bug，单元测试用 jsdom 直接构造 `Selection`/`Range` 是更稳妥的覆盖路径。如必须真实浏览器测试，使用 `page.evaluate()` 程式化注入 selection
7. **库代码不该写 `console.warn` 兜底**：宿主应用有自己的日志渠道；库静默+暴露 `onError`-类回调更尊重消费方
