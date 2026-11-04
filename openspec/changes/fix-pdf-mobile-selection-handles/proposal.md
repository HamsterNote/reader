# Proposal

## Why

移动端 PDF Layout 模式长按后的原生选区手柄无法拖动，用户无法准确调整范围；临时选区与底栏高亮色不一致也使确认前后的反馈割裂。PDF Text 已有自定义圆形手柄，本次使 PDF 两种模式的选择体验及颜色来源一致。

## What Changes

- PDF Layout 在移动端长按后显示可拖动的自定义起止手柄，支持未确认选区及已选中高亮范围的调整。
- 在 reader Web 层适配 PDF.js textLayer 的命中、Range 更新与手势生命周期，抑制原生手柄和系统选择菜单；保留 PDF 原页/字符序列化。
- 复用文字模式 `RangeHandle` 的圆形视觉、可访问命名与放大镜能力，通过适配器接入 Layout，不直接套用依赖分页列的 `PdfTextHandle`。
- PDF Layout/Text 的未高亮选区、高亮母版预览与新建高亮使用底部栏当前解析的高亮色，活动预览在换色时同步。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`: 增补移动端 Layout 自定义选区手柄、手势取消、坐标一致性及 PDF 两模式临时选区颜色契约。

## Impact

- 主要涉及 `src/components/EngineDocumentViewer.tsx`、`EngineSelectionControls.tsx`、`src/pdf/PdfDocumentViewer.tsx`、PDF 选择几何/序列化与相关样式；`Reader.tsx` 统一 PDF 颜色传递，Text 分支复用既有选择组件。
- `RangeHandle` 与 `useRangeHandleDrag` 如需解耦，限于支持新的渲染适配；不升级 PDF.js、selection 库，不改 Expo 原生代码、EPUB 交互或持久化格式。
- PDF 的 `selectionColor` 不再产生独立于底栏的临时选区颜色：PDF 场景以底栏解析色为准。这是既有可选颜色属性的行为调整，调用方需知悉；非 PDF 行为保留。
- 本次仅交付 Propose 文档，自动化回归及 iOS/Android WebView 实测由后续实现阶段执行。
