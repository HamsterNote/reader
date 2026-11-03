# Proposal

## Why

HAM-138 反馈 EPUB 选字后无法像 PDF 一样使用 Popover。虽然现有规格已要求 EPUB 高亮交互兼容，代码也有共用控件，但缺少针对 EPUB iframe 选区、范围切换及高亮更新的一组明确验收边界，需要补齐可执行的行为契约。

## What Changes

- EPUB 有效文字选区显示与 PDF 基线一致的默认 Popover，提供高亮及颜色选择；点击已有高亮显示其颜色及删除操作，继续支持自定义 Popover。
- 明确“范围切换”为新选区替换旧草稿、在高亮之间切换，以及通过既有端点操作扩展/缩小范围，覆盖同章跨段落、跨行内节点和反向选择。
- 新建、激活、改色、改范围和删除保持当前目标唯一；草稿不隐式改写已有高亮，端点更新不丢失另一端或创建副本，删除清理对应显示及活动态。
- 以 EPUB 旧逻辑页/规范化字符端点为权威，保持 ID、创建时间、评论关联、既有回调和撤销重做语义，重排与重开后定位一致。
- 沿用按钮翻页约束：选区越界不自动翻页。跨章节历史高亮保留并可编辑当前可见端点，不新增跨 iframe 连续拖选或全书范围模式。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `epub-web-reader`：补充选区 Popover、已有高亮激活、范围切换与编辑、删除及其数据一致性验收要求。

## Impact

- 主要涉及 `src/components/EngineDocumentViewer.tsx`、`EngineSelectionControls.tsx`、`DefaultPopover.tsx`、`Reader.tsx` 的 EPUB 路径，以及 `src/epub/foliateEpubEngine.ts`、`epubCompatIndex.ts`、`sectionTextIndex.ts`。
- 验证延伸至 `test/epub/`、`test/engine-selection-segments.test.ts`、`test/mobile-safe-highlight-button.test.tsx`、`scripts/check-engine-interactions.mjs`，并回归 PDF 共用控件。
- 不新增依赖或公开字段，不迁移存储格式。与进行中的 `replace-pdf-painting-core` 共享部分组件，但不接管其绘图或存储版本迁移；本 change 保持非绘图 range 契约，写入格式服从届时主线权威存储实现。
- 本次仅生成 Propose 文档，不修改产品代码。
