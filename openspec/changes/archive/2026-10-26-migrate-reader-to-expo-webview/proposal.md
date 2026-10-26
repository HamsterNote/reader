# Proposal

## Why

reader 当前基于 Web 解析后的中间文档自行展示 EPUB/PDF，维护排版与选区成本高，且缺少 Expo 应用入口。本次将成熟 Web 阅读引擎置于 Expo WebView 内，同时保留现有 UI、交互和持久化契约。

## What Changes

- EPUB 参考 native-reader 的 Foliate 库与使用方式，替换当前 EPUB 主阅读链路；不依赖待归档仓库的运行或发布。
- PDF 改为 pdfjs-dist 官方 viewer 组件负责页面、文本层和加载生命周期，叠加 reader 现有标注交互。
- **BREAKING**：仓库由纯 Web 项目转为 Expo 项目，新增 iOS/Android dev client 入口与 WebView 资源构建；保留现有 Web 库导出作为本期兼容约束。
- 保留高亮、矩形、绘图、评论关联、书签和阅读进度的已有数据格式，以及适用于对应文档的现有交互和 UI。新增引擎定位仅存于内部适配层。
- 三条实现主线共享兼容基线和 WebView 桥接协议，最终共同验收。
- 非目标：实现原生 EPUB/PDF 引擎、归档 native-reader、部署、重做阅读器视觉、引入新的存储格式。

## Capabilities

### New Capabilities

- `epub-web-reader`: Foliate EPUB 展示、重排和旧标注定位兼容。
- `pdfjs-web-reader`: PDF.js viewer 展示及 reader 交互叠加。
- `expo-reader-host`: Expo dev client、WebView 资源及宿主生命周期。
- `reader-data-compatibility`: 公共数据、持久化与历史交互回归约束。

### Modified Capabilities

无。当前 `openspec list --specs --json` 返回空目录，历史 archive 不能替代主规格。

## Impact

目标为 `HamsterNote/reader`，基线提交 `237c0d51a4fc76d8c6f233bd2598ac7a14d12500`。涉及 `demo/App.tsx`、`demo/epubForReader.ts`、`demo/pdfParserForReader.ts`、`src/components/Reader*`、`src/components/IntermediateDocumentViewer/`、`src/types/selection.ts`、`src/types/readerData.ts`、存储适配及构建脚本。

新增 Expo、dev client、react-native-webview、Foliate 与 pdfjs-dist 依赖；具体兼容版本在实现时锁定。其他文档类型保持现状。旧公开类型和 Web 库入口不因 Expo 迁移被删除。只生成本 change 文档，不执行实现或派工。
