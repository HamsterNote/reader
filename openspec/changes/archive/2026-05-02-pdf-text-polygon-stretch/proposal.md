# PDF Text Polygon Stretch

## Why

在渲染 PDF 的文字时，`Text` 实例的 `polygon` 属性应该计算文字实际渲染宽度，然后根据 `polygon` 来拉伸 DOM，而不是直接给简单的 `width`/`bbox`。现有实现使用 `getTextBoundingBox()` 从 polygon 计算轴对齐 bbox，无法正确反映带旋转的文本几何形状。

## What Changes

- 让带 `polygon` 的 `Text` 直接按四点几何关系渲染：`p0` 定位、`p0→p1` 定宽和角度、`p1→p2` 定高
- 替换 `src/components/IntermediateDocumentViewer.tsx` 中的 `polygon -> bbox` 文本布局分支
- 保留现有 fallback 路径（polygon 缺失/畸形/退化时使用旧路径）
- 扩展测试套件以覆盖 polygon 正常路径和异常路径

## Capabilities

- `polygon` 4 点语义固定：`0=左上, 1=右上, 2=右下, 3=左下`
- `p0→p1` 决定角度和宽度，`p1→p2` 决定高度
- `transform-origin` 锚定左上角
- malformed polygon 保持旧路径回退

## Impact

- 修改范围：仅 `src/components/IntermediateDocumentViewer.tsx` 的文本渲染逻辑和测试文件
- 不改动 PDF 解析器数据模型
- 不改页面/图片渲染逻辑
- 不引入新的浏览器 E2E 工具
- 现有非 polygon 文本和选择行为保持不变

## Original Plan

来源于 `.sisyphus/plans/pdf-text-polygon-stretch.md`

### Key Deliverables
- polygon 几何计算与样式映射
- 文本渲染 DOM 更新
- polygon 正常/异常路径测试
- CI 级验证命令（`yarn test:run`, `yarn lint`, `yarn typecheck`）

### Definition of Done
- `yarn test:run test/intermediate-document-viewer.test.tsx` 通过
- `yarn lint` 通过
- `yarn typecheck` 通过
