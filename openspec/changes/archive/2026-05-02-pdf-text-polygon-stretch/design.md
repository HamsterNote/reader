# Design: PDF Text Polygon Stretch

## Context

当前渲染点位于 `src/components/IntermediateDocumentViewer.tsx`：
- `lines 75-86` - `getTextBoundingBox()` - 目前从 polygon 计算 min/max bbox
- `lines 88-100` - `getTextTransform()` - 应用 rotate() 和 skewX() 变换
- `lines 976-1016` - JSX 渲染块，为文本 span 应用样式

### Current Behavior
- 如果 `text.polygon` 存在：使用 `getTextBoundingBox()` 返回 minX/minY/width/height（轴对齐 bbox）
- 如果没有 polygon：回退到 `text.x/y/width/height`
- Transform 通过 `getTextTransform()` 单独应用（rotate + skewX）

### Target Behavior
- 有效 4 点 polygon：使用 p0 作为锚点，p0→p1 定宽+角度，p1→p2 定高
- 畸形/缺失 polygon：保留现有回退
- transform-origin 保持 'left top'（已设置）
- 保留现有 skew 行为

## Goals

- Polygon 文本现在对有效 `polygon` 输入使用四点几何而非 bbox width
- 现有非 polygon 文本和选择行为保持不变
- 针对性渲染测试同时证明 happy path 和 fallback path
- CI 命令保持通过

## Non-Goals

- 不改 PDF 解析器数据模型
- 不改页面/图片渲染逻辑
- 不引入新的浏览器 E2E 工具
- 不把文字选择、OCR、分页虚改成无关重构

## Decisions

### 1. 四点语义约定
- **决策内容**：固定 `polygon` 4 点语义：`0=左上, 1=右上, 2=右下, 3=左下`
- **选择原因**：与 PDF 页面坐标系一致，方便后续维护
- **备选方案**：动态检测边缘方向
- **不采用原因**：增加复杂度和不确定性

### 2. 畸形 Polygon 回退策略
- **决策内容**：当 polygon 缺失、点数不足、或包含无效数值时，回退到现有 `getTextBoundingBox()` 或 `x/y/width/height`
- **选择原因**：保证向后兼容，避免渲染失败
- **备选方案**：抛出错误或静默跳过
- **不采用原因**：抛出错误会破坏现有文档渲染，跳过会导致文字丢失

### 3. 旋转原点固定左上角
- **决策内容**：`transform-origin` 固定在左上角（p0 位置）
- **选择原因**：简化 transform 组合计算，与现有样式一致
- **备选方案**：以中心点旋转
- **不采用原因**：需要额外偏移计算，增加复杂度

## Risks / Trade-offs

- **双旋转风险**：当 polygon 几何生效时，`text.rotate` 不应再单独应用（p0→p1 已确定角度）。已通过 `skipRotate` 参数在 `getTextTransform()` 中处理。
- **测试覆盖风险**：polygon 路径和 fallback 路径都需要充分测试，已在 Task 2 中补充 4 个专项测试用例。

## Migration Plan

无需迁移。此变更仅影响渲染逻辑，不改变任何数据模型或 API。

## Implementation Notes

### Changes Made

1. **新增 `getPolygonTextGeometry()` 辅助函数** (lines 88-129)：
   - 验证 polygon 是否有恰好 4 个有效的 `[number, number]` 点
   - 返回 `{ x, y, width, height, rotation }`，其中：
     - x = p0[0], y = p0[1]
     - width = distance(p0, p1)
     - height = distance(p1, p2)
     - rotation = atan2(p1-p0) 的度数
   - 对无效/畸形/退化 polygon 返回 `null`

2. **修改文本渲染块** (lines 1029-1096)：
   - 首先尝试 `getPolygonTextGeometry(text.polygon)`
   - 如果非 null：使用几何值设置 x/y/width/height，并将旋转纳入 transform
   - 如果 null：回退到现有行为（polygon 用 getTextBoundingBox，无 polygon 用 x/y/width/height）
   - 保留 text.skew 通过追加到 transform

3. **双旋转修复**：
   - 当 polygon 几何生效时，`text.rotate` 不应单独应用（p0→p1 已确定角度）
   - 添加 `skipRotate` 参数到 `getTextTransform()`；当 `usePolygonGeometry` 为 true 时跳过 text.rotate，仅应用 skew
   - Polygon 模式：`rotate(polygonRotation) skewX(skew)`
   - Fallback 模式：`rotate(text.rotate) skewX(skew)`

4. **测试补充** (Task 2)：
   - 在 `test/intermediate-document-viewer.test.tsx:1397-1562` 添加 `describe('polygon geometry rendering', ...)` 测试块，包含 4 个测试：
     - 有效 4 点水平 polygon
     - 畸形 2 点 polygon fallback
     - 旋转垂直 polygon（90度）
     - 无 polygon fallback

### Key Helpers
- `makePolygonText()` 辅助函数 (lines 1398-1421)：创建带 polygon 的 IntermediateText
- `makePolygonDocument()` 辅助函数 (lines 1423-1444)：创建包含给定文本的 mock 文档

### Test Results
- 43 项测试通过（39 原有 + 4 新增）
