# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
