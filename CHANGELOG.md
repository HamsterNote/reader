# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
