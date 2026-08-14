# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.12.0-beta.1] - 2026-08-13

### Added
- Reader 新增受控 `loadingProgress` prop：宿主传入 `{ label, current, total }` 后，Reader 容器内展示加载阶段标签、整数百分比与原生 `<progress>` 进度条；加载期间临时隐藏上传区、文件信息、文档内容与底栏，根节点同步暴露 `aria-busy`。同时导出 `ReaderLoadingProgress` 类型。
- Demo 新增 PDF 两阶段加载流程：先将文件流式读入内存并显示读取进度，再以「待加载」卡片等待用户点击「加载文件」后解析渲染；刷新后恢复到同一待加载卡片。
- Demo 新增加载/解析/渲染三段计时面板，便于诊断长文档渲染瓶颈。
- Demo 新增文件流式读入内存加载器 `fileMemoryLoader`：支持进度回调、AbortSignal 取消与字节数完整性校验。
- 新增 PDF 解析器版本兼容封装层 `pdfParserForReader`：为 Reader 关闭 offscreen canvas 与 image decoder 回退。
- 新增 PDF 流式加载、内存加载器与解析器封装相关测试。

### Changed
- 移除过时的 `pdf-parser` ambient 类型声明。
- 更新 README 与 DESIGN 文档：补充 PDF 两阶段加载说明与 Reader Loading Progress 设计契约。

### Fixed
- 修复文档切换时 PDF 会话未释放，以及「Forget 已保存文件」与持久化队列的竞态。
- 稳定 Demo 测试的异步 teardown 与持久化队列时序。

## [0.11.1-beta.2] - 2026-08-12

### Added
- PDF 文本模式为每个可见页渲染 `第 n 页` 页码分隔标记，并注入 `--hamster-reader-theme-color` 主题色。
- 阅读进度在 Layout/Text 模式切换与文档替换时同步捕获并保存最新锚点：`Text` 阅读进度改为 `scrollend` 防抖后仅持久化最终位置；卸载前同步读取实时锚点避免丢失滚动中的进度。
- Demo 阅读偏好升级为 v2，为 Text/Layout 两种模式分别持久化字号，并持久化当前高亮色。

### Fixed
- 用 `@system-ui-js/multi-drag` 重构高亮拖拽，统一追踪移出 viewer 的指针，避免浏览器原生手势抢占导致高亮移动失败。
- native Layout 通过其可滚动视口承载平移，滚动到目标范围时将该范围中心与视口中心对齐。

## [0.11.1-beta.1] - 2026-08-12

### Added
- 原生 Layout 缩放模式新增可恢复的阅读进度（`data.layoutReadingProgress`）：优先记录视口顶部文字锚点，页面无文字时回退到页内垂直百分比；Demo 侧边栏展示最后保存的进度并持久化到 localStorage。

### Fixed
- 修复触摸长按高亮时浏览器原生选词抢占拖动手势的问题：命中既有高亮后，候选期与拖动期均抑制原生选区，普通文本仍可长按进行文字选择。

## [0.11.0] - 2026-08-11

### Changed
- 重构原生视口导航逻辑，降低 `navigateToPage` 认知复杂度以通过 lint 检查。

### Fixed
- 修复拖拽高亮时浏览器原生手势抢占的问题。
- 改进阅读进度指示器的平滑性。

## [0.10.0] - 2026-08-09

### Added
- Edge-crop hide page feature
- Page-position bookmark support
- Multi-touch cancel gesture
- Text-mode color palette

### Fixed
- Disabled page+percentage bookmarks in Text Mode

## [0.9.0] - 2026-08-06

### Added
- VirtualPaper beta toggle with native pinch-zoom and bottom bar zoom menu for non-VP mode.
- Persist `renderMode` and `selectedTool` across sessions.
- Text reading progress tracking and precise bookmark support with text-anchor anchoring.

### Changed
- Upgraded `@hamster-note/selection` from `0.1.2` to `0.3.0`.
- CI workflows upgraded to GitHub Actions v5 for Node.js 24 runtime; Prettier import formatting fixed.
- Expanded test coverage for intermediate document viewer, page browser, text anchors, and native layout zoom.

### Fixed
- Ensured Selection custom UI works correctly on iPad by following suppress class state.

## [0.8.0-beta.1] - 2026-08-02

### Added
- Shared reading progress rail for both Layout and Text modes, mounted outside VirtualPaper.
- EPUB flow images rendering as flow figures in both Layout and Text modes.
- Layout zoom feedback indicator (transient percentage badge).
- OCR retry support and sequential page processing with stale rejection handling.
- PDF flow content ordering by polygon position for correct reading order.
- Giant TXT span splitting for improved text rendering.
- `ReaderIntermediateImage` type exports for public consumption.
- PDF parser configuration for Reader (disable offscreen canvas/image decoder fallbacks).
- EPUB content order and image metadata utilities in demo.

### Changed
- Improved PDF text highlight adapter to handle visual reordering and duplicate glyph IDs.
- Replaced `TextReadingProgress` with shared `ReadingProgress` rail.
- Updated demo: EPUB image metadata extraction, OCR mode persistence (v2 storage).
- Measured default bottom bar inset and added it to Text Mode content padding.

### Fixed
- Fixed SSR hydration mismatches.
- Fixed PDF text selection offset canonicalization.
- Fixed TXT page splitting edge cases for giant spans.

## [0.7.0-beta.1] - 2026-07-30

### Fixed
- Fixed CI workflow to use Node 22 for PR checks.
- Fixed comment parent cycles, duplicate IDs, dynamic portal containers, and deferred crop updates in Reader component.

## [0.7.0-beta.0] - 2026-07-30

### Added
- Flow-text rendering with PDF text extraction, OCR diagnostics, and unified `ReaderData` support.
- Configurable edge cropping for document pages.

### Changed
- Updated `@hamster-note/virtual-paper` to the published `1.1.0` package.

### Fixed
- Positioned the bottom toolbar within the Reader container and corrected zoom-aware thumbnail resolution.
- Restored rectangle selection, coordinate mapping, popover controls, and range-handle dragging after synchronized content replacement.
- Kept the public selection ref available while lazily evicted pages reload for programmatic navigation.
- Stabilized demo annotation-history and lazy-page regression coverage and resolved the release lint violations.

## [0.6.1-beta.0] - 2026-07-23

### Added
- Direct TXT rendering mode with automatic pagination and page splitting.
- Comment system with M:N highlight-to-comment binding and reply tree support.
- Image preview support in TXT render mode with click-to-open overlay.
- Export `comments.ts` helpers: `getCommentsByHighlightId`, `getCommentCountByHighlightId`, `buildReaderCommentTree`.

### Changed
- `IntermediateDocumentViewer` refactored for shared layout/text renderer architecture.
- `caretResolver` updated to handle cross-page text selection for TXT content.
- README documentation expanded with comments API section.

## [0.6.0] - 2026-07-19

### Added
- 在 `ReaderInteractiveProps` 中新增 `bookmarkedPageNumbers` 和 `onTogglePageBookmark` 属性导出。

### Fixed
- 修复 `pointercancel` 导致页面浏览器被意外关闭的问题：通过追踪主指针并忽略非主指针的取消事件来解决。
- 修复手动上传文件与自动恢复最近文件之间的竞态条件：手动选择的文件不会再被延迟完成的自动文件恢复覆盖。

## [0.5.1-beta.0] - 2026-07-19

### Added
- Page browser bookmarks tab with controlled bookmark state.
- Page browser drag-to-dismiss with CSS-cropped rect preview and drawing overlay.
- Magnifier when dragging text range handles for fine-grained boundary adjustment.
- Page browser highlights tab with comment display.

## [0.5.0] - 2026-07-18

### Added
- 新增选区手柄（RangeHandle）组件，支持反向缩放圆形和触摸点击取消选中。
- 新增手柄放大镜（RangeMagnifier）组件，提升选区边界微调精度。
- 新增 `selectionPointerGuard` 选区指针守卫。
- 新增 `drawingStrokeColor` prop，支持绘图工具描边颜色。
- 新增 page-browser 选中状态样式和 `themeColor` prop。
- 新增 drawing persistence（绘图持久化）支持。

### Fixed
- 修复 popover 选区颜色和拖拽手柄清理问题。
- 修复 lint 错误，降低 ViewerContent 认知复杂度。

## [0.4.0] - 2026-07-16

### Added
- 新增 annotation history（撤销/重做）支持，提供受控和非受控模式。
- 新增 `DefaultPopover` 组件，支持初始化 fit scale。
- 新增独立的垂直边距 props（`containMarginTop`/`containMarginBottom`）和高亮专属颜色。
- 新增 `onCommentHighlight` 异步注释生命周期回调。
- 新增 prop 控制的页面浏览器，支持懒加载缩略图。

### Fixed
- 修复工具切换时 viewer 特性的保持问题。
- Demo 中正确接入默认 popover。

## [0.3.0] - 2026-07-13

### Added
- 新增纯文本阅读模式（`renderMode='text'`），支持虚拟滚动。
- 新增矩形选区模式和绘图工具，与已有文本选择共存。
- 新增 `scrollToRect` API，支持程序化矩形定位导航。
- 离屏页面支持缩放感知的懒加载缩略图。
- 矩形选区模式新增选择弹窗。
- 支持在文本选择、矩形选区、绘图模式间切换。

### Fixed
- 修复选择生命周期中 managed timeout 未清理导致的跨实例内存/资源泄漏。
- 修复 HTML 解析器页面解码兼容性问题。
- 将本地 `html-parser` 依赖替换为已发布的 npm 版本。
- 处理 PR #4 审查意见，解决源码、演示和测试文件的 lint 问题。

## [0.2.0-beta.1] - 2026-07-03

### Added
- `DocumentViewer` component for intermediate-document rendering.
- Render timing infrastructure with optional stage-by-stage diagnostics.
- Lazy page loading queue with concurrency control, visibility debounce, and offscreen release.
- Intermediate document page content rendering pipeline.
- Selection and OCR integration for intermediate documents.
- Cross-page text selection protection for offscreen pages.
- Programmatic highlight jumps centered via `VirtualPaper` transform.

### Changed
- Enabled `VirtualPaper` `contain` fit mode by default.
- Migrated all `@hamster-note/*` yalc-linked dependencies to published npm versions:
  - `@hamster-note/pdf-parser` `^1.0.0`
  - `@hamster-note/virtual-paper` `0.1.0-beta.2`
  - `@hamster-note/html-parser` `0.9.0-beta`
  - `@hamster-note/selection` `0.0.2-beta.1`

### Fixed
- Final-wave OCR reload and loading ref leak.
- Reset `imagesByPageNumber` on document switch.
- Geometry casts and lint issues.

### Removed
- Legacy render modes; the renderer now uses intermediate-document only.

## [0.1.0]

### Added
- Initial release of `@hamster-note/reader` React component library
- Reader component with document rendering support
- TypeScript type definitions for ReaderProps
- SCSS styles for Reader component
- Vitest unit tests with React Testing Library
- Vite build configuration for library bundling
- ESLint and Prettier code linting setup
- Demo application for local development
- GitHub Actions CI/CD workflow
