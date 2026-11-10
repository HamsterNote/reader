# Proposal

## Why

HAM-182 验收后的 PDF 预览、EPUB、PDF 纯文字仍有手柄显隐、端点命中及放大镜反馈不一致的问题。HAM-201 要把三个渲染面的体验收敛为同一份可验证交互契约，避免实现与审核各用一套标准。

## What Changes

- 三个渲染面共用 `reader-text-selection-interaction` 的唯一交互描述与验收场景；现有 PDF、EPUB 规格通过引用接入。
- 拖动可见文字端点时手柄常显；仅触摸显示放大镜，鼠标与笔不显示；按真实指针位置命中文字，不加手柄抓取或避让位移。
- 镜片连续跟随手指，镜心距触摸点约 1cm，上方放不下才翻到下方。
- 镜内独立插入竖线锚定字符间隙，字符端点变化时离散切换，颜色跟随当前操作目标的高亮色。
- 镜内不渲染或同步更新选区填充，正文选区继续实时反馈；把输入类型、零位移、离散竖线与无选区刷新写成可判定验收项。
- 替换 PDF 原有“固定在手柄上方”“命中按行内位置纠偏”描述，EPUB 端点调整采用共享受管交互；保留各格式导航、持久化和取消语义。

## Capabilities

### New Capabilities

- `reader-text-selection-interaction`: PDF 预览 / EPUB / PDF 纯文字共同遵守的文字手柄与放大镜契约及参数化验收。

### Modified Capabilities

- `pdfjs-web-reader`: 接入共享规范，修改 PDF 放大镜位置及手柄命中规则，保留 Layout 连续选择、自动滚动和原数据契约。
- `epub-web-reader`: 接入共享规范，明确受管端点调整的入口与原生初始选择的关系，保留范围提交和按钮分页约束。

## Impact

主要涉及 `EngineSelectionControls.tsx`、`IntermediateDocumentViewer/RangeMagnifier.tsx`、`rangeMagnifierGeometry.ts`、`TextSelectionMagnifier.tsx`、`useRangeHandleDrag.ts`、`pdfMagnifierText.ts` 及 `src/styles/reader.scss`。复用现有选区测试、`demo/selectionHarness.tsx` 和 `scripts/check-web-selection.mjs`；需补充三渲染面输入矩阵及 iOS/Android 真机验收。可能需要适配现有 `@hamster-note/selection` 手柄生命周期，是否升级依赖由 apply 按现有公开能力确认；不预设必须修改其他仓库。无公开数据格式、宿主协议或标注迁移变更。本 change 仅产出规划文档。
