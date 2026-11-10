# Tasks

## 1. 接续实现基线

- [ ] 1.1 确认 HAM-216 已落地，以包含该修复的最新 reader 基线接续本 change，记录 SHA；用「已有高亮→拖柄→点空白取消→重新选中」验证其范围、手柄和 ID/颜色/样式基线，避免覆盖并行修复。

## 2. 共享尺寸与最终显示

- [ ] 2.1 在 `selectionInteraction.ts` 建立半径 38、派生直径 76、中心距 76、倍率 2 的唯一参数来源，使三面文字外框、文字取景和插入线投影共同消费；通过相关 magnifier/marker 单测及 `rg -n 'TEXT_LENS|MAGNIFIER|scale\(2\)' src/` 配合消费链路检查，确认纯文字没有独立副本、DPR 不改变 CSS 尺寸。
- [ ] 2.2 清理 `engine-viewer.scss` 对文字镜片的 `translateY(-8px)`，同步 `reader.scss` 的文字尺寸/倍率回退与边框口径；以实际 DOM 外框验证三面无额外变换，运行 `test/range-magnifier-rect-handle.test.tsx` 等矩形快照回归证明非文字镜片基线保留。

## 3. 安全区与上下放置

- [ ] 3.1 扩展共享可见区域解析，读取 CSS env safe-area inset，与阅读器及当前可见视口在 client 坐标系求交；为零 inset、非零/已安全偏移容器、左右 inset、visual viewport 和空交集补定向用例，验证不重复扣除、空区域不显示及恢复后可重算。
- [ ] 3.2 更新文字放置计算，完整上方候选可放下即选上方，移除额外顶部 8px 阈值；覆盖两视口的 T+115/T+114/T+113、向下恢复、下半屏、横向夹取和极小视口用例，断言阈值 1px 内可预测且命中/采样未变，矩形工具维持原规则。
- [ ] 3.3 在 `RangeMagnifier.tsx` 接入安全矩形和单次 client/portal 坐标转换，合并视口/容器变化的测量更新并清理监听及探针；通过 resize、失焦、取消、模式/文档切换及卸载测试验证无旧镜片、旧回调和多余每帧布局读取。

## 4. 三面集成与设备回归

- [ ] 4.1 更新共享单测、PDF 专项和 `scripts/check-shared-selection-interaction.mjs` 的旧 60/38/半径30预期，加入 design 中两视口及 safe-area 矩阵；运行 `node scripts/check-shared-selection-interaction.mjs`，交付三面 × 起止柄 × 草稿/已有高亮的最终外框、触点、上下位置及源/镜内字符几何记录，验证半径 38±1、中心距 76±2、间隙约38、真实文字倍率2倍和翻转误差≤1px，覆盖 DPR1/2/3 与 PDF 50%/100%/200% 缩放。
- [ ] 4.2 运行 `node scripts/check-pdf-preview-drag.mjs`、`node scripts/check-pdf-text-magnifier.mjs`、`node scripts/check-pdf-text-release.mjs` 和 `node scripts/check-webkit-selection-touch.mjs`；交付拖动/释放/取消/确认结果，验证范围不回退、结束镜片关闭、mouse/pen 无镜片、竖线对齐且镜内无选区同步，并保持 HAM-216 回归通过。
- [ ] 4.3 在 iOS 模拟器或真机用系统长按选字后完成 EPUB 首次拖柄/重拖/释放/取消/确认，三面逐一实测最终外框和安全区；保存设备、浏览器、root/inset、坐标和截图证据，明确区分合成事件、Safari 模拟器、宿主 WKWebView 与 Android 的已验及未验项目，不将脚本合成拖动视为原生首拖验收。
- [ ] 4.4 执行 `yarn typecheck`、`yarn lint`、`yarn test:run`、`yarn build:all`，记录命令和结果；确认字形缓存和无选区重绘约束未退化，且未引入公开数据格式或依赖变更。

## 5. 规格同步与交付校验

- [ ] 5.1 实现验证完成后按项目后续阶段流程同步本 change 的两份 delta 到主规格；检查共享规范中无旧「约1cm中心距」，PDF 相关条款无旧18px布局、预览专属8px视觉上移或 Text 旧镜片基线要求，EPUB 继续引用同一共享标准，历史 archive 不改写。
- [ ] 5.2 执行 `openspec validate refine-shared-magnifier-geometry --strict`，并对同步后的 `reader-text-selection-interaction`、`pdfjs-web-reader` 主规格执行 `openspec validate <spec-id> --type spec --strict`；逐项对照 HAM-217 六项验收，交付验证记录、剩余设备验证边界及实现评审材料，不以 propose 状态代替实现通过。
