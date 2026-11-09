# Optimize PDF Hidden Page Editing

## Why

PDF 的「页面隐藏 / 编辑」目前会在编辑态把隐藏页重新插回正文布局。隐藏页虽然只显示提示而没有正常阅读内容，仍占据完整页面尺寸并重新参与 PDF.js 的测量与渲染；连续隐藏大量页面时，仅打开编辑开关就会造成明显重排和渲染压力。需要让用户在不恢复这些正文页节点的前提下查看预览并批量恢复。

## Current Implementation Findings

- 本 change 的 owning repository 是 `reader`（基线 `5d2ed1f`）。公共数据 `src/types/readerData.ts` 的 `ReaderData.hiddenPages` 同时接受原页码和 `page-N`；`src/components/Reader.tsx` 通过 `onDataChange` 新增隐藏页，并管理受控/非受控 `edgeCropEditing`；`src/components/EngineDocumentViewer.tsx` 将二者传入 PDF 渲染层。
- `src/pdf/PdfDocumentViewer.tsx` 的 `filterHiddenPages` 在编辑态直接返回全部允许页，使隐藏页重新进入可导航集合；隐藏页 effect 又在 `edgeCropEditing` 时清除这些页的 `display:none`；overlay 渲染随后为每个隐藏页挂载「当前第 N 页已隐藏」覆盖层。因此打开编辑开关会让所有隐藏页的完整页面框重新进入文档流，触发几何计算及按需渲染，而不是只显示轻量入口。
- 早期协调曾将文档暂存于 `native-reader`；该仓库没有这套页面隐藏交互。本 change 已迁入 `reader`，不在 `native-reader` 另造实现。

## What Changes

- 编辑态不再显示任何隐藏页的正文页面框或逐页提示；隐藏页在阅读态和编辑态都保持退出正文布局及正文导航。
- 将当前编辑范围内连续的原 PDF 隐藏页合并成段，每段只显示一个紧凑折叠入口；单页也构成一段，并覆盖段首、段尾和整篇隐藏。
- 任一入口打开同一个隐藏页模态框，按段展示所有可恢复页的真实预览；支持逐页多选、跨段选择、全选当前可恢复集合和批量恢复。
- 选择只保存在模态框草稿中，取消不提交；确认后一次性更新既有 `ReaderData.hiddenPages`，并提供一次短时撤销。公共数据形状、原页号语义和其他阅读数据不变。
- 预览复用现有按可见项加载、失败重试及会话释放能力；不得为打开模态框预渲染整本 PDF，也不得让旧文档预览或撤销影响新文档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`: 增加隐藏页编辑态的折叠分组、无正文占位、模态框多选恢复、一次撤销及预览资源边界；保持既有页码和 `hiddenPages` 数据兼容。
- `reader-data-compatibility`: 明确历史数字 / `page-N` 隐藏数据、原子批量恢复及一次撤销对其他最新阅读数据和标注历史的隔离契约。

## Impact

- 实施代码影响 `src/components/Reader.tsx`、`src/components/EngineDocumentViewer.tsx`、`src/pdf/PdfDocumentViewer.tsx`，以及复用 `src/pdf/usePdfPreviews.ts` 的恢复预览 UI。
- 保持 `ReaderData.hiddenPages` 的数字 / `page-N` 兼容格式及 `onDataChange` 宿主所有权；无需存储迁移或新增依赖。
- 仅改变 PDF Layout 的页面隐藏编辑体验。EPUB 隐藏章节、PDF Text 分页、既有裁切编辑、标注历史和 `native-reader` 独立 PDF 渲染器不在本次实现范围内。
