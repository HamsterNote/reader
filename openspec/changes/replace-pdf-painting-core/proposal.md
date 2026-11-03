# Proposal

## Why

reader 当前依赖 painting 0.4.0，PDF 虽已使用旧版 PaintingBoard，但升级到分层文档 API 会同时影响工具栏、页面坐标和历史标注。此次将历史绘图迁移及 PDF 页面锚定能力收口到 painting，避免 reader 长期维护第二套数据映射与绘制实现。

## What Changes

- painting 以增量 minor 发布提供旧绘图数据到 EditorDocument 的迁移能力及 PDF 页面锚定能力，保持其现有新版消费者可用；具体 API 名称和参数以工程师交付的正式版本为准。
- reader 依赖具备上述能力的正式发布版本，整合新版绘图控制器、绘图表面和工具栏，删除旧组件路径；所有共享绘图层调用点在同一 change 中迁移。
- 绘制颜色以 reader 工具栏当前颜色为准；笔迹在缩放、滚动、分页、页面回收和重开后保持页面锚定，reader 只传几何及当前变换，不自行变换绘图坐标。
- **BREAKING**：reader 的绘图公开类型及绘图回调负载统一为新版 EditorDocument，移除旧 DrawingValue/旧控制器绑定；既有调用方需要迁移。非绘图 API 保持既有语义。
- **BREAKING**：新增版本化标注存储键，只写新格式。首次恢复旧 v2/v3/v4 数据时由 painting 迁移绘图并写入新键，原始旧 blob 原样保留。取消继续写 v4、向旧模型投影及双写的要求；旧版 App 只能看到升级前状态，无法看到升级后新增或修改的标注。
- 以可重复验收的规格约束一次性迁移幂等性、新键优先、清空不复活、落盘确认、错误恢复和文件隔离。

## Capabilities

### New Capabilities

无；复用已有能力目录。

### Modified Capabilities

- `pdfjs-web-reader`：补充工具栏颜色、页面锚定精度及输入/分页验收，明确通过 painting 的页面锚定能力提供绘图。
- `reader-data-compatibility`：更新旧格式只读迁移、新格式权威存储、reader 无旧绘图兼容分支及新版公开绘图类型契约；保留非绘图数据语义。
- `expo-reader-host`：补充新存储键落盘确认、迁移恢复与旧 blob 保留的宿主行为。

## Impact

- reader：`src/components/PageDrawingLayer.tsx`、`Reader.tsx`、`Reader/DefaultBottomBarControls.tsx`、`Page.tsx`、`IntermediateDocumentViewer/`、`EngineEpubLayoutLayer.tsx`、`src/pdf/`、`src/types/readerData.ts`、`src/index.ts`，以及 demo、WebView 和页面预览调用点。
- 存储及桥接：`src/storage/highlightStorage.ts`、`src/host/readerSnapshot.ts`、`readerDataStore.ts`、`webview/src/ReaderSurface.tsx`、`bridgeClient.ts`、`app/src/components/ReaderWebView.tsx`。现有所有写 v4 的入口需退出写路径，包括高亮/矩形更新、导入导出和重置入口。
- 外部前置依赖：painting 工程师负责迁移/页面锚定增量 API、兼容测试及正式 minor 发布。本提案不声称 npm 0.7.0 已具备这些能力，也不预定尚未发布的版本号。
- 本次仅交付 propose 文档；painting 和 reader 的实现、发布均属于后续执行工作。
