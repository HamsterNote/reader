# AGENTS.md

## 仓库性质：reader 是渲染在 WebView 内的 Web 组件库

**reader 是渲染在 WebView 内的 Web 组件库**，不是原生组件库（`@hamster-note/reader` 是它的 npm 包名）。

本仓的所有交互——选区（selection）、选区 Popover、高亮、拖拽 handoff、分栏（workspace）、工具栏、翻页、PDF / 文字模式渲染——在真机 App 里**同样是 DOM**，最终都跑在 WebView 的 Chromium 引擎里。凡是能在 Chromium 里断言的，在真机上也同样能断言，反之亦然。

**不要因为「这是仓鼠笔记的 App、要跑在 iOS 上」就把验收推到真机或模拟器上。** 本仓自带 Chromium（Playwright）自动化能力，绝大多数交互可以直接在浏览器里验证完毕。

典型例子：选区 Popover 的实现是 `src/components/DefaultPopover.tsx`（`role='toolbar'`、`aria-label='选区操作'`），是纯 Web DOM 组件；配套的 `scripts/check-selection-popover.mjs` 用 Playwright 的 `chromium` + Vite dev server 驱动，用 `page.mouse.down()` / `page.mouse.up()` 序列就能断言 Popover 的出现时机——**不需要真机**。

## 验收手段的判定顺序

开发期验收按下面顺序判定，**自上而下，先命中先用**：

1. **纯逻辑** → `yarn test:run`（vitest）+ `yarn typecheck`
2. **交互 / DOM / 时序** → 浏览器脚本（见下一节的脚本清单）；需要人工过一遍时用 `yarn dev` 起本地浏览器 demo
3. **前两者覆盖不到** → 才考虑模拟器 / 真机，且必须落在下面的白名单内

只有第 3 条成立时才允许排设备，并且必须同时满足白名单与纪律条款的要求。

## 真机 / 模拟器白名单

只有以下四类才允许排模拟器或真机：

1. **原生视图自身**：状态栏与安全区、原生导航栏、原生键盘与输入法、Apple Pencil 与手写、原生权限与分享弹窗、原生文件选择器
2. **宿主与原生模块的桥接**：React Native 原生模块、WebView ↔ 原生通信、跨进程、dev client 安装与 bundle 加载（对应本仓 `app/` 下的 Expo 宿主流程，例如 `yarn host:ios` / `yarn host:android`）
3. **硬件相关**：相机、麦克风、蓝牙、陀螺仪、生物识别
4. **发布前**：上架前回归、提审前检查

白名单之外的一切，都属于 Web 侧可覆盖范围，一律按上面的三级顺序处理。

## 本仓已有的 web-only 验证手段

`package.json` 的 `scripts` 里现成的命令（实现见 `scripts/`）：

| 命令 | 实现 | 用途 |
| --- | --- | --- |
| `yarn typecheck` | `tsc --project tsconfig.json --noEmit` | 类型检查 |
| `yarn lint` | `eslint .` | 代码风格与静态规则 |
| `yarn test:run` | `vitest run` | 单元测试 |
| `yarn check:web-selection` | `scripts/check-web-selection.mjs` | Web 选区行为 |
| `yarn check:highlight-handoff` | `scripts/check-highlight-handoff.mjs` | 高亮与拖拽 handoff |
| `yarn check:workspace` | `scripts/check-workspace-browser.mjs` | 分栏与工作区交互 |
| `yarn check:session-replacement` | `scripts/check-session-replacement-browser.mjs` | 会话替换（换书）流程 |
| `yarn check:pdf-text-readiness` | `scripts/check-session-replacement-browser.mjs --text` | 文字模式就绪与替换 |
| `yarn check:pagination-input` | `scripts/check-pagination-input-browser.mjs` | 翻页与输入交互 |
| `yarn check:pdf-inset` | `scripts/check-pdf-page-inset.mjs` | PDF 页面内嵌几何 |
| `yarn check:browser` | `scripts/check-reader-browser.mjs` | 阅读器整体浏览器回归 |
| `yarn check:painting` | `scripts/check-painting-browser.mjs` | 绘画 / 手写层 |
| `yarn build:lib` | `vite build --config vite.lib.config.ts` + `tsc --project tsconfig.build.json` + `node scripts/build-styles.mjs` | 产出库产物（JS / 类型 / 样式） |
| `yarn build:webview` | `scripts/build-webview.mjs` | 产出打进宿主的 webview bundle |
| `yarn verify:webview` | `scripts/verify-webview-assets.mjs` | 校验 webview 产物资源 |

宿主侧还有 `yarn host:check`（即 `yarn build:webview` + `yarn verify:webview` + `yarn typecheck:host`），是不碰设备的宿主 Web 侧校验。

### 选区 Popover 的专项脚本

`scripts/check-selection-popover.mjs` 是选区 Popover 的 Playwright + Chromium + Vite 自动化脚本。**它在 `package.json` 里没有对应的 script 入口**，要用 `node scripts/check-selection-popover.mjs` 直接跑。

它能做的事：用 `page.mouse.down()` / `page.mouse.up()` 模拟选区手势序列，断言 Popover **出现的时机**（例如「松手之后才出现」）、Popover 的 `role='toolbar'` / `aria-label='选区操作'` 属性，以及选中片段的内容。涉及选区 Popover 出现时机、拖拽 handoff 的改动，优先用它取证，不要排真机。

> `scripts/` 下还有更多同类的独立 Playwright 脚本（多数同样没有 `package.json` 入口），需要时用 `node scripts/<文件名>.mjs` 直接跑。

## 纪律条款

1. **不得因为「以前只能真机」就写真机要求。** 提真机验收前，先查本仓的 web 脚本能不能做（见上一节清单）；能覆盖的一律用 web 覆盖。
2. **真机条目必须写明理由。** 每一条真机 / 模拟器验收要求，都必须写明「是哪一条具体断言」以及「为什么浏览器覆盖不了」，否则不得列入。
3. **不得因为取不到设备就把任务置为 blocked。** 先用 web 把能做的部分做完并交付结论；个别断言确实需要设备时，把其余结论交付完，只把那一挂起并写明原因。
4. **真机取证是补充证据，不是前置条件。** 真机通过与否不阻塞开发完成的判断；开发是否完成，以 Web 侧验收结果为准。

## 原生路径的保留范围

原生测试脚本、构建与发布流程仍保留在仓库中（`app/` 下的 Expo 宿主、`scripts/apply-ios-webview-patch.mjs`，以及 `package.json` 里的 `host:*` 脚本），并未废弃。它们仅适用于：发布、专项原生验证，或用户明确请求时。

原生路径的成败不阻塞开发阶段的完成判断。

## 与 WebBase 仓的关系

`HamsterNote/WebBase` 仓已有一份同类的「开发时自动验收边界（Web-only）」规定（写在该仓自己的 `AGENTS.md` 里），本文件是它在 `HamsterNote/reader` 仓的对应版本。两边口径一致：开发期自动验收走 Web 侧，原生路径保留但不作为开发完成依据。修改本文件时不要让两边的表述互相矛盾。

## 适用范围

本规则约束的是开发阶段的自动验收。它不禁止保留或维护原生测试脚本与发布流程，也不改变 CI 的既有职责。
