# Proposal

## Why

纯 PDF 阅读进度目前优先记录最上方文字，遇到图片、段间空白会把恢复位置吸附到文字；正文安全区也必须同时约束文字采集和恢复对齐。需要把纯 PDF 的几何进度与 PDF 预览 / 纯文字互切的文字锚点分开，落实 HAM-228。

## What Changes

- 纯 PDF（Layout）新进度统一记录原页号及安全正文上边界线在该显示页内的纵向百分比，有字、无字使用同一规则；重开将该比例位置对齐当前安全正文上边界。
- PDF 预览 ↔ 纯文字互切继续取来源模式安全正文区域内最上方可见文字；采集与目标对齐均考虑 safe area。Text 保持现有按钮分页，进入包含目标字符的可视页；返回 PDF 时将目标文字行对齐安全区下沿。无文字才使用既有页内比例回退。
- 在 reader 内拆分几何进度采集和文字锚点采集，消除模式互切被持久化比例提前截断的耦合。保持旧文字进度读取、源字符偏移、关闭冲刷和其他格式行为。
- 复用 WebBase 已有 safe area / 标题栏注入和 reader 参数；宿主仅承担真实遮挡传递、持久化与正式 reader 依赖接入，不复制 reader 算法，不修改 node_modules，不增加 monkey patch。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`：纯 Layout 续读改为安全线页内比例，明确其与安全首行文字互切相互独立。
- `reader-data-compatibility`：为 PDF Layout 记录规则增加例外，保留 EPUB、Text 和历史数据规则。

## Impact

- 主要改动仓库为 **HamsterNote/reader**：`src/pdf/PdfDocumentViewer.tsx` 的采集/恢复、`src/components/EngineDocumentViewer.tsx` 的进度发布、`src/components/Reader.tsx` 的模式交接；共用 `src/components/reading/readingViewport.ts`、`src/viewportPosition.ts`。详见 design 的代码证据表。
- **HamsterNote/WebBase** 已在 `webview/src/window-content/reader/use-reader-contain-margins.ts` 与 `ReaderEditorPane.tsx` 传递安全区；最终集成在该仓库接入正式 reader 版本并回归真实壳层遮挡。只有验证发现传参/坐标契约不符时才在宿主源文件修正，不在宿主强行补偿 reader 的错误。
- **HamsterNote/painting** 负责绘制与坐标投影，不拥有阅读进度，本次无改动落点。
- 已发现 WebBase 实验性 NativePdfSurface 的独立实现：iOS/Android 已报比例，互切却用字符数比例估算。当前提案按默认 Web/WebView 链路规划，**假设实验性原生 PDF 路径不在本次范围**；这是范围假设，不是用户已确认要求。其差异不宣称已修复。
- 延续 `layoutReadingProgress: { pageNumber, verticalPercentage }`，不新增存储格式、不批量迁移，不改变文字书签/高亮的定位语义。WebBase 当前 reader 依赖为 `2.0.0`，接入须使用包含修复的正式版本。
- 开发时验收为 Web-only：类型检查、单元测试、Web 构建、浏览器 E2E。原生构建、Maestro、模拟器和真机仅适用于发布、专项验证或用户明确请求，其成败不作为开发完成判据。本次只交付提案文档与 OpenSpec 校验，不执行实现或产品测试。
