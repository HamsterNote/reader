# Proposal

## Why

当前阅读进度重进时会偏离离开位置，尤其是同页滚动、图片区域和关闭前最后一次移动。需要以用户实际可见内容作为恢复依据，并保证最后进度经过完整保存链路。

## What Changes

- 固定判定优先级：阅读视口内有可定位文字时，保存最上方可见文字行的首个可见字符；重开后使该字符所在行成为视口首行。无文字时保存“视口顶端在目标页面中的百分比”，不使用全书滚动比例，也不固定回到页首。
- PDF Layout 与既有可滚动路径使用准确的字符几何和页内比例；EPUB、PDF Text 保留按钮分页，恢复至包含该字符或比例目标的可视页，不为满足顶部对齐破坏分页边界。
- 保留滚动保存的 100ms 尾部防抖、1000ms 最大等待；成功翻页/显式导航也触发保存。离开前重新采集并立即冲刷 Reader 待保存进度，再等待桥接确认和宿主落盘；后台切换触发尽力冲刷。
- 兼容现有 `layoutReadingProgress`、`textReadingProgress` 和 `virtualPaper.anchor`；Text 进度仅增补可选 `verticalPercentage`，旧页码进度仍按页首恢复。保留存储键、旧原件及其他阅读/标注数据，无强制批量迁移。
- 初始化、加载、重排、恢复及过期会话不得以临时页首/空进度覆盖已确认位置。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reader-data-compatibility`: 首行文字/无文字比例的统一进度语义、旧进度读取优先级及增量兼容。
- `pdfjs-web-reader`: PDF Layout 可见字符与页内比例定位；Text 保留源字符和可视页恢复约束。
- `epub-web-reader`: 明确分页首行锚点，无文字从逻辑页回退细化为逻辑页内比例。
- `expo-reader-host`: 关闭前完整冲刷与落盘确认、后台冲刷及会话隔离。

## Impact

已定位 `src/types/readerData.ts`、`src/components/Reader/useLayoutReadingProgressSave.ts`、`Reader.tsx`、`EngineDocumentViewer.tsx`、`src/pdf/PdfDocumentViewer.tsx`、`src/epub/foliateEpubEngine.ts`，以及既有 `IntermediateDocumentViewer` 的比例/锚点实现。宿主链路是 `webview/src/ReaderSurface.tsx` → `serializeReaderSnapshot` → `bridgeClient` → `hostSession` → `ReaderDataStore.saveSnapshot` → Expo 文件系统存储；目前实际 WebView 走完整 `change` 快照，而非单独 `progress` 事件。

不新增依赖、不修改标注格式或手势规则；共享保存逻辑需要回归 TXT/Markdown/DOCX/图片。验收覆盖同页移动、无文字、分页、重排、短时关闭、旧快照和切书隔离。当前阶段仅交付规划文档。
