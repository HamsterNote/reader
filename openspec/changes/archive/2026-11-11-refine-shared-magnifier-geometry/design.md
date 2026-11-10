# Design

## Context

动机见 `proposal.md`。项目 OpenSpec CLI 为 1.13.1，配置为 `spec-driven`，仓库无随附 propose 命令/技能文件，使用运行时提供的 openspec-propose 技能及 CLI 各 artifact 指令。创建前 `openspec list --json` 返回有效本地 root，且没有活动 change。

调研确认：

- `selectionInteraction.ts` 定义 `TEXT_LENS_SIZE_PX=60`、`TEXT_LENS_DISTANCE_PX=38`、`TEXT_LENS_MAGNIFICATION=2`；两个文字取景器及竖线投影已消费共享值。
- `rangeMagnifierGeometry.ts` 用 `TEXT_LENS_EDGE_PX=8` 作为翻转条件中的顶部余量；`RangeMagnifier.tsx` 的 `visibleRootBox` 仅与 `innerWidth/innerHeight` 相交，没有 safe area。文字镜片为 fixed portal，而矩形快照使用独立 120px/78px 参数。
- `engine-viewer.scss` 给 PDF 镜片额外 `translateY(-8px)`，会在共享几何之外改变最终中心距及安全边界；`reader.scss` 另有快照尺寸和默认文字 scale，需要区分文字实际 inline 值与非文字回退。
- 共享浏览器脚本仍断言直径 60、距离 38，插入线反投影也硬编码半径 30 和倍率 2；单测及 PDF 专项脚本包含旧几何期望。
- PDF 主规格的 Text 18px 布局及预览 8px 上移要求与共享规则冲突。本 change 提供这三组完整 requirement 的 delta；EPUB 已引用共享规范，无需重复一份尺寸规则。

## Goals / Non-Goals

**Goals:** 让三面的最终 DOM 外框、取景和竖线共同使用同一组参数；将 safe area 转换为可单测的边界输入；用实际外框和源字形尺寸作为浏览器独立判据。

**Non-Goals:** 不改选择事务、端点纠偏、原生 Selection 交接与高亮存储；不调矩形快照的尺寸/定位基线；不引入物理厘米标定或新的公开 API；不在本轮执行实现、同步主规格或归档。

## Decisions

### 1. 唯一参数来源和测量口径

在现有 `selectionInteraction.ts` 设置半径为 38、由半径派生直径 76，距离为 76，倍率继续使用现有 2；半径、直径不得成为可独立修改的两份事实。所有三面文字镜片的外框、取景半径、文字 scale、竖线投影均消费该来源。CSS 通过共享组件写入的值控制文字镜片，不另留文字专用尺寸或倍率副本。排查时沿 `RangeMagnifier` 的 text session 和 `EngineSelectionControls` / PDF Text 入口确认实际消费链路，不能只检索 `MAGNIFIER` 大写名称。

采用现有约 38 CSS px/cm 的产品近似；这是设计假设，不声称所有设备上物理长度正好为厘米。圆形边框计入 76px 外径，阴影不计入，DPR 只影响栅格分辨率。倍率比较镜内文字与该面当前屏幕正文，避免误把 PDF 自身缩放纳入三面差异。备选的每面独立调参无法满足唯一来源验收；按 DPR 推算厘米也缺少可靠物理尺寸信息。

### 2. 在一个坐标系中求安全交集

将当前 `visibleRootBox` 的读取扩展为共享边界解析：先读取阅读器 client rect 与当前可见视口矩形；有 `visualViewport` 时将其偏移/尺寸统一到 client 坐标，没有则使用普通视口。通过同一文档中的 CSS 探针读取 `env(safe-area-inset-top/right/bottom/left, 0px)` 的计算像素值，形成相对整个宿主 Web 视口的安全矩形，再与阅读器和可见视口相交。

safe area 不相对阅读器原点再次相加。例如宿主已将 root.top 放在 47px，安全上界同为 47px，最终上界仍为 47px，不能变成 94px。宿主本身限制 WebView 范围时，Web 视口已处安全区内且 env 为 0，是合法情况。现有代码未发现独立宿主 safe-area 桥接输入；本设计不新增桥接协议，宿主必须以安全 WebView 边界或有效 CSS env 表达遮挡。浏览器验证使用同一解析器的受控 inset 输入模拟，不靠测试绕过生产几何。

在开始拖动、位置更新和视口 resize/scroll、容器尺寸或方向变化后采用最新交集；结束/卸载清理新增探针和监听。缓存稳定的 inset/布局读数，每帧合并测量写入，避免在每次字形投影重复强制布局。备选的固定顶部阈值无法处理刘海和偏移容器；单纯从 root 高度减去 insets 会重复扣除宿主已有避让。

### 3. 放置公式直接对应最终外框

令可用矩形为 `[L,T,R,B]`，触点为 `(x,y)`，半径 r=38，距离 d=76：

- 上方候选中心 `(x,y-d)`，外框纵向为 `[y-d-r,y-d+r]`。两端均在 `[T,B]` 内时必须选上方；常规视口的上边翻转阈值恰为 `y=T+114`。
- 上方不完整时选择下方候选 `(x,y+d)`，外框纵向 `[y+d-r,y+d+r]`。不得在判据中叠加旧 8px 留白，不加迟滞区。
- 完整候选横向中心夹取至 `[L+r,R-r]`；上方/下方均放不下时再纵向夹取，以安全范围和最大可见性为先。如果区域小于直径，相应轴中心对齐可用区域中心；区域为空则暂不显示镜片，区域恢复后随有效会话重算。极小区域无法同时保证完整外框、76px 中心距和38px间隙，故规格明确将其排除在标准间距样本之外。
- 文字 fixed portal 使用 client 结果；若复用返回局部坐标的函数，仅在写入 DOM 前做一次原点换算。夹取只操作镜片显示中心，源文字取景仍以真实物理触点为中心。

从文字镜片移除 PDF 专属 `translateY(-8px)`，必要时将旧规则限定到不在本 change 范围的矩形快照。用最终 `getBoundingClientRect()` 验收，不能只断言函数返回值而遗漏 CSS。保留 `pointer-events:none`、零滞后跟随和独立插入线。备选的保留 transform 再补偿 JS 会形成两套几何来源。

### 4. 可复现验证矩阵

模拟值是本提案选择的测试夹具，不是用户确认的设备物理 inset：

| 视口 | 上/下 inset | root 覆盖视口时 T | 触点临界 y | 逐点预期 |
| --- | --- | --- | --- | --- |
| 375×667 | 20 / 34 | 20 | 134 | y=135、134 上方，133 下方 |
| 390×844 | 47 / 34 | 47 | 161 | y=162、161 上方，160 下方 |

额外覆盖零 inset、左右 inset、root 非零偏移和已安全避让、上方恢复、下半屏、resize、极小视口、DPR 1/2/3。正常中心位置校验外框半径 38±1、欧氏中心距 76±2、轴向间隙约 38；字符宽度和行高以源屏幕几何的 2 倍为独立 oracle，允许 1px 舍入，不仅比较 transform 字符串。阈值误差不得超过 1px。

更新 `test/shared-selection-interaction.test.tsx`、相关 magnifier 单测及 `scripts/check-shared-selection-interaction.mjs` 的旧预期，扩展脚本的视口/safe-area矩阵。覆盖三面 × 起止柄 × 草稿/已有高亮，另跑 PDF preview / Text magnifier 专项、`check-pdf-text-release.mjs`、`check-webkit-selection-touch.mjs`。后者目前只有可信 tap 与合成拖动覆盖，不能作为真实首拖通过证据；iOS 模拟器或设备必须用系统长按→首次拖柄→释放，再确认/取消复验。宿主 WKWebView 与 Android 验证单独记录，不把 Safari 模拟器等同真机。

## Risks / Trade-offs

- [HAM-216 改动同一链路] → 等其落地后再实现本 change，按最新代码整合；保持高亮 ID、颜色、样式，回归拖后取消再选中，不把其缺陷修复复制到本提案。
- [安全区未由宿主暴露] → 使用安全 WebView 边界或 CSS env，记录实际 inset 与 root；若两者都未表达物理遮挡则报告宿主集成缺口，不把固定 20/47px 写进生产代码。
- [移除 CSS 上移改变旧测试] → 明确替换文字镜片旧几何断言，矩形快照另跑原回归；不得为通过旧断言恢复第二套偏移。
- [扩大镜片提高取景量] → 延续当前字形缓存和无选区重绘路径，观察拖动时重复截图/文字重建，不能以每帧复制选区换取一致性。
- [主规格旧要求仍在] → propose 仅提供 delta；后续同步时核对整份 PDF 与共享规范，移除旧中心距及独立布局条款，历史 archive 作为历史记录保留。

## Migration Plan

评审完成、HAM-216 落地后由实现阶段接手；集中修改共享参数、边界解析和文字样式，完成矩阵验证再按项目流程同步两份主规格。无数据迁移或新依赖。回退时整体回退本 change 的实现和同步规则，避免只退一面的参数；不回退 HAM-216。此处为交接计划，本轮不执行。
