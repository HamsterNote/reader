# Proposal

## Why

PDF Text 当前已有自绘手柄，但仍使用旧圆柄，和 PDF Layout 的白边、阴影、连接竖线及外置端点视觉不同。用户希望纯文字模式与 PDF 模式的选区两端拖拽点保持一致，降低辨识和调整选区的成本。

## What Changes

- 以当前 PDF Layout 自绘手柄为基准，统一 PDF Text 起止手柄的 20 CSS px 不透明圆点、2px 白边、整体阴影、连接竖线及上下端点位置，并提供相同的 40×40 CSS px 透明热区。
- 保留 PDF Text 的 selection 库、源字符锚点、当前可视列端点过滤与放大镜；适配视觉位移到文字命中的坐标纠偏，避免从热区边缘抓取时跳选。
- 更新既有规格中“PDF Text 圆柄视觉不随之改变”的旧约束，明确本次统一视觉及热区，但不迁移 Layout 的自动滚动、跨页拖选或镜片实现。
- 范围仅 reader 项目的 PDF 文字选择；保留 Layout 基准行为、Text 按钮分页及禁止滚动/自动翻页契约，不改 EPUB、矩形选择、其他格式或外部 selection 包。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`：明确两种 PDF 模式的手柄外观及热区一致；修改 Text 选择场景和历史颜色 requirement 中限制 Text 视觉变化的场景，保留其他交互与存储契约。

## Impact

- 主要入口：`src/pdf/PdfTextHandle.tsx`；视觉复用基准：`src/components/PdfTouchSelectionHandle.tsx`；Text 手势适配参考 `RangeHandle.tsx` / `useRangeHandleDrag.ts`。共享逻辑如需扩展必须 PDF 显式启用，默认行为不变。
- 回归覆盖 PDF Text 草稿和已存高亮端点、分页列边界、文字映射与保存、Layout 基准，以及共享组件的非 PDF 使用方。
- 不新增依赖，不改变公开 API、数据格式或宿主代码。本次仅生成规划文档，不实施代码或声称设备验证通过。
