# Proposal

## Why

HAM-217 要求解决三个渲染面放大镜观感不一致、间距过近与顶部提前翻转问题。HAM-201 的共享规格仍规定约 1cm 中心距，PDF 规格还残留独立 8px 上移及 Text 旧布局条款，需要统一更新为可测量、包含 safe area 的标准。

## What Changes

- PDF 预览 / EPUB / PDF 纯文字共用唯一交互描述及同一组尺寸、中心距和放大系数常量：半径 38 CSS px、直径 76 CSS px、中心距 76 CSS px；放大系数沿用当前共享值 2 倍。
- 放置改为「能上则上」：按阅读器可见区域与屏幕安全区域交集判断完整镜片能否放在上方，恰好贴边仍在上方，不预留导致提前翻转的额外顶部阈值。
- 统一最终显示几何，移除文字放大镜的 PDF 预览专属 8px 上移；统一采样、文字取景与竖线使用的尺寸和倍率。
- 在共享规格给出两种视口、safe area、1px 翻转边界、实测尺寸/间距和三面回归验收；PDF 的旧放置条款改为引用共享标准，不建立第二套参数。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `reader-text-selection-interaction`: 更新连续跟随、safe area 上下放置规则，补充共享尺寸、倍率与三面一致性的可验证要求。
- `pdfjs-web-reader`: 清理 PDF Text 旧布局锚点/18px 间距、预览专属 8px 上移及旧采样基线的冲突表述，改为遵循共享文字选择规范。

## Impact

- 目标仓库：`HamsterNote/reader`；调研基线 `a38728dbe66e0f3c0e358ffee93b863322835ed3`。`selectionInteraction.ts` 已有 60px 直径、38px 距离、2 倍共享参数；不预设用户观察到的差异一定来自三份常量。
- 实现涉及 `src/components/IntermediateDocumentViewer/{selectionInteraction,rangeMagnifierGeometry,RangeMagnifier,flowMagnifierText,pdfMagnifierText}`、`src/styles/{reader,engine-viewer}.scss` 和相关单测、浏览器回归脚本。
- 只处理三面的文字放大镜；矩形工具快照镜片、其他格式、高亮持久化、导航和手柄命中契约不在变更范围内。无需新增依赖或修改公开数据格式。
- HAM-216 正在修改相同选择链路；实现阶段必须等其落地后基于最新代码整合，保留其已有高亮修复。本轮只产出提案，不修改主规格、实现代码，不启动服务或执行归档。主规格旧描述的移除属于后续同步 delta 的验收。
