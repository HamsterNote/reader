# Proposal

## Why

HAM-130 要求 PDF 文字阅读模式对齐 EPUB 最近完成的可视分页交互。当前 PDF Text 仍使用原生滚动虚拟列表，分页、输入和进度行为与 EPUB 不一致；应共享通用阅读外壳，同时保留 PDF 原页号、文字端点及 Layout/Text 切换契约。

## What Changes

- PDF Text 按实际可用宽高重排为单个可视页，右下角两个按钮逐页阅读；同一 PDF 原页可包含多个可视页，原页末尾再进入下一可读原页。
- 对齐 EPUB 的仅按钮顺序阅读规则：正文滚轮、触控板、滑动、滚动按键和选区越界不滚动或翻页；目录、书签、高亮定位和进度恢复仍可用，侧栏与选字保持可用。
- 共用翻页按钮、底栏避让测量、正文输入限制与导航状态契约；分页算法、内容加载、文本映射和标注几何保持格式适配分支，不让 PDF 接入 Foliate 或 EPUB CFI。
- 翻页按 PDF 原页号及稳定字符锚点保存进度；字号、窗口和底栏变化后恢复包含原锚点的可视页。保留懒加载、错误重试和切书隔离。
- 明确空白/无文本页的可识别状态及原页回退，不做 OCR；保留现有文字重建质量，不承诺重建任意多栏、表格或阅读顺序。
- 非目标：PDF Layout 的翻页/缩放/链接/矩形/绘图重构，其他格式改为分页，EPUB 排版算法重写，公开数据迁移，native-reader 修改，以及本阶段编码实现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`: 增加 PDF Text 可视分页、按钮交互、空间避让、锚点恢复及模式切换验收。
- `epub-web-reader`: 将现有“仅在 EPUB 提供”按钮的排他范围调整为 EPUB 与 PDF Text；EPUB 既有交互保持不变。

## Impact

- 目标仓库为 `HamsterNote/reader`。基线为 `openspec/changes/archive/2026-11-03-epub-viewport-pagination`，其 tasks 尚有设备/集成验证未勾选；归档不等于所有交互已在设备验证，实施须回归。
- `src/components/Reader.tsx` 的 Text 分支、`IntermediateDocumentTextViewer.tsx` 及其页内容/选择/进度接线；PDF 文本仍由 `src/pdf/pdfTextModeDocument.ts` 与 canonical 映射提供。
- `EngineDocumentViewer.tsx` 的 EPUB 按钮与测量、`src/epub/buttonOnlyInput.ts`、相关底栏样式提取为内部共享能力，两个格式分别实现分页适配器；不变更公开 Reader props/回调或 v2/v3/v4 数据契约，不新增运行依赖。
- 需要组件/映射/进度测试及真实浏览器、iOS/Android WebView 验证；WebView 宿主数据链路仅回归，不另建宿主实现。
