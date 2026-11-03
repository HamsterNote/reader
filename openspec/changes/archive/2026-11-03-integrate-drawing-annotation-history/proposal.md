# Proposal

## Why

reader 的绘图通过独立页控制器提交，但统一撤销快照只有文字范围、矩形及选中 ID，导致底栏撤销无法恢复绘图，也无法按用户操作顺序混合撤销标注。需要将已提交的绘图编辑纳入同文件的统一历史，避免保存结果与撤销后的界面不一致。

## What Changes

- 在已有 annotationHistory 开关下，将完整 pagePaintings 纳入统一历史；绘图与高亮、矩形按提交顺序撤销／重做，沿用底栏及 selectionRef 命令。
- 一次完成的 stroke 是新增手绘的最小历史单元；一次已提交的对象编辑（含整笔重绘）、擦除手势、删除或当前页绘图清空分别是一个原子操作。只接入既有编辑入口，不新增擦除／重绘／清空工具。
- 撤销后发生任何有效的新标注编辑均清空整个重做分支；取消、空操作、显示重绘、工具设置和历史回放不创建历史。
- 扩展历史回调及受控数据回填，保证回放只保存一次逻辑变更；明确翻页、卸载、外部替换和文件切换行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reader-data-compatibility`: 增加绘图统一历史的粒度、时序、状态、受控回填及保存恢复契约。

## Impact

- 目标仓库已 checkout 并确认是 `HamsterNote/reader`，不是 native-reader。当前 package.json 使用 painting 0.8.3；`PageDrawingLayer.tsx` 已使用分层 EditorDocument。
- 涉及 `src/types/selection.ts`、`Reader.tsx`、`Reader/useAnnotationHistory.ts`、`EngineDocumentViewer.tsx`、`IntermediateDocumentViewer/IntermediateDocumentViewer.tsx`、`PageDrawingLayer.tsx` 及 `webview/src/ReaderSurface.tsx`；补充历史、绘图、Reader 和保存链测试。
- 历史值建议增加可选 pagePaintings 字段以兼容旧调用方；新的绘图受控消费者必须回填完整历史目标。现有绘图回调继续保留，避免双重提交。
- 与进行中的 `replace-pdf-painting-core` 衔接：沿用其 EditorDocument、页面锚定和 V5 保存链，不重复迁移或发布绘图库，不修改其文档。主规格仍描述 v4 写入，与该 change／当前实现有过渡差异，本 change 不触碰其存储 requirement。
- 本次仅生成 propose 产物；历史不跨应用重启持久化，不改变 PDF Text 等无绘图视图的能力，不进入实现、发布或部署。
