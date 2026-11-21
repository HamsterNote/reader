# AGENTS.md

## 仓库性质：reader 是渲染在 WebView 内的 Web 组件库

**reader 是渲染在 WebView 内的 Web 组件库**，不是原生组件库（`@hamster-note/reader` 是它的 npm 包名）。

选区（selection）、选区 Popover、高亮、拖拽 handoff、分栏（workspace）、工具栏、翻页、PDF / 文字模式渲染等 Web 组件行为在真机 App 里**同样基于 DOM**。按具体断言判断覆盖范围：用 Playwright Chromium 验证组件的 DOM 行为，另行识别依赖宿主 WebView 引擎、系统输入或原生菜单的断言。例如，iOS 的 WKWebView 基于 WebKit，选区工具栏在 Chromium 中可见只证明该环境中的 DOM 行为。iOS 系统编辑菜单是否被抑制需要单独验证。

**不要因为「这是仓鼠笔记的 App、要跑在 iOS 上」就把验收推到真机或模拟器上。** 本仓自带 Chromium（Playwright）自动化能力，绝大多数交互可以直接在浏览器里验证完毕。

选区 Popover 是由 `src/components/DefaultPopover.tsx` 渲染的 DOM 工具栏（`role='toolbar'`、`aria-label='选区操作'`）。配套的 `scripts/check-selection-popover.mjs` 在 Playwright Chromium 中验证松手后能观察到工具栏。

## 验收手段的判定顺序

常规开发和 PR 验收仅走 Web，使用以下第 1、2 项。第 3 项仅适用于发布、专项原生验证或用户明确请求的验证。

1. **纯逻辑** → `yarn test:run`（vitest）+ `yarn typecheck`
2. **交互 / DOM / 时序** → 浏览器脚本（见下一节的脚本清单）；需要人工过一遍时用 `yarn dev` 起本地浏览器 demo
3. **发布、专项原生验证或用户明确请求的验证** → 先用前两项覆盖可验证的断言。仅对存在 Web 覆盖缺口、符合下方白名单并按纪律条款记录的断言安排模拟器或真机。

## 真机 / 模拟器白名单

以下四类白名单仅适用于第 3 项的设备验证范围：

1. **原生视图自身**：状态栏与安全区、原生导航栏、原生键盘与输入法、系统编辑菜单、Apple Pencil 与手写、原生权限与分享弹窗、原生文件选择器
2. **宿主与原生模块的桥接**：React Native 原生模块、WebView ↔ 原生通信、依赖宿主 WebView 配置的引擎行为、跨进程、dev client 安装与 bundle 加载（对应本仓 `app/` 下的 Expo 宿主流程，例如 `yarn host:ios` / `yarn host:android`）
3. **硬件相关**：相机、麦克风、蓝牙、陀螺仪、生物识别
4. **发布前**：上架前回归、提审前检查

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

脚本模拟按下、拖动和松手，随后按角色和名称查找选区工具栏，并检查选中片段的内容。现有可见性检查覆盖「松手后能观察到工具栏」。要验证「松手后才出现」，需要在 `page.mouse.down()` 后及拖动期间断言工具栏不可见，再在 `page.mouse.up()` 后断言可见。拖拽 handoff 使用 `yarn check:highlight-handoff` 验证。

> `scripts/` 下还有更多同类的独立 Playwright 脚本（多数同样没有 `package.json` 入口），需要时用 `node scripts/<文件名>.mjs` 直接跑。

## 纪律条款

1. **先查 Web 验证入口。** 对拟安排真机或模拟器的每条断言，先检查相关的 `package.json` 命令与 `scripts/` 独立脚本。能在 Web 验证的断言一律走 Web，即使过去依赖设备。
2. **真机和模拟器采用同一记录要求。** 逐条记录具体验证断言、已查过的 Web 入口（含相关独立脚本）、Web 覆盖缺口及原因，以及所属的白名单项。记录齐全才可安排设备。
3. **设备不可用时先交付 Web 结论。** 将确实需要设备的专项断言标为待验证并注明原因。常规开发和 PR 验收继续依据 Web 结果。
4. **开发完成以 Web 验收结果为准。** 专项设备结果可补充开发证据，发布前的必验项按发布流程判断。

## 原生路径的保留范围

仓库保留原生测试脚本、构建与发布流程（`app/` 下的 Expo 宿主、`scripts/apply-ios-webview-patch.mjs`，以及 `package.json` 里的 `host:*` 脚本）。其中涉及真机或模拟器的验证遵循第 3 项的适用范围、白名单和纪律条款。

## 与 WebBase 仓的关系

`HamsterNote/WebBase` 的 `AGENTS.md` 同样规定常规开发和 PR 验收仅走 Web。发布、专项原生验证或用户明确请求的设备验证单独按上述范围和条件执行。

## 适用范围

本规则约束的是开发阶段的自动验收。它不禁止保留或维护原生测试脚本与发布流程，也不改变 CI 的既有职责。
