# Design

## Context

动机见 proposal。按实际 OpenSpec 1.13.1、reader 的 `schema: spec-driven` 执行；仓库未附带 propose 命令/技能，使用运行环境的 openspec-propose 和 CLI instructions。reader 无活动 change，相关进度变更已归档。只读调查基于 reader `bc956da`、WebBase `aec5e60`，不是产品复现或测试结论。

| 仓库 / 代码 | 观察到的实现 | 本次责任 |
| --- | --- | --- |
| reader `src/pdf/PdfDocumentViewer.tsx:1534` | `captureReadingPosition` 先扫描文字，找不到才按 `viewportRect` / `pageRect` 计算比例 | 纯 PDF 进度直接走页面几何，不等待文字层 |
| reader 同文件 `:1599` | `captureTextAnchor` 最终委托 `captureReadingPosition` | 拆开后仍独立扫描安全视口文字，保留源字符定位 |
| reader 同文件 `:537`、`:583` | `viewportRect` 已消费 readingInsets；`alignTop` 已按 viewport.top 修正滚动，兼容比例和文字恢复 | 统一采集/恢复安全矩形；优先复用，不另加固定偏移 |
| reader `src/components/EngineDocumentViewer.tsx:702`、`:715` | `capturePdfPosition` / `publishPosition` 采集并发布位置；`onTextAnchorChange` 从该位置派生 | 比例发布和文字通知分开，不能把比例的“无 offset”当作无可见文字 |
| reader `src/components/Reader.tsx:1270` | `handoffReadingPosition` 在没有 VirtualPaper 且已存比例时提前走 `handoffPagePosition`；之后才查文字 | 模式互切独立采集当前安全首行，移除比例对文字路径的抢占 |
| reader `src/components/Reader/useLayoutReadingProgressSave.ts`、`webview/src/ReaderSurface.tsx` | 防抖、flush、完整 ReaderData 变更与宿主快照链路已存在 | 延续字段合并、文档代次和关闭确认 |
| reader `src/components/reading/readingViewport.ts`、`src/viewportPosition.ts` | 安全区约定是 root 内剩余遮挡；已有百分比公式及可见字符几何 | 共用坐标与边界约定 |
| reader `src/pdf/usePdfLayoutAnchor.ts` | 裁切/尺寸变化的临时布局锚点使用 PDF 空间点与可见文字，不是用户续读数据 | 保留专用职责；不把此临时锚点误当持久化进度 |
| WebBase `components/webview-shell.native.tsx:90`、`webview-shell-injection.ts` | 壳层注入 safe area 和 `max(headerHeight, safeAreaTop)` 的 editorTop | 提供真实宿主遮挡，不相加重复计数 |
| WebBase `webview/src/window-content/reader/use-reader-contain-margins.ts`、`ReaderEditorPane.tsx:288` | 已取 `max(editorTop, safeAreaTop)` 并传 containMarginTop/Bottom/X | 消费正式 reader 修复；用浏览器注入非零安全区验证现有接线 |
| WebBase `webview/src/window-content/reader/use-reading-position.ts`、`sidecar-storage.ts` | 合并模式数据，存到文档 `reading_position` | 保持原有存储责任；不在 sidecar 里重新推算 PDF 坐标 |
| WebBase 实验性 `NativePdfSurfaceImpl.tsx`、`hooks/use-native-pdf-text-progress.ts` | 独立原生路径，持久化已报比例，但互切通过字符数量与比例估算 | 范围假设：本次不修改该实验路径，不能将其描述成“已经按首行文字互切” |
| WebBase `modules/native-pdf-viewer/ios/HighlightingPdfView.swift:738` / Android 对应 View | iOS 用 adjustedContentInset.top + 1；Android 用 scrollY 和 page.height 采集比例 | 已识别，不以 WebView 修复宣称覆盖原生引擎 |
| painting `packages/painting/src` | 提供绘制及几何投影，未定位到阅读进度持久化或互切责任 | 无需改动 |

已有 `reader-data-compatibility` 的通用要求和 `pdfjs-web-reader` 的 Layout 要求均规定文字优先，与新纯 PDF 规则直接冲突。因此两个规格都修改；Text 互切的既有场景完整保留，增加与纯 PDF 比例隔离的验收。沿用历史 Requirement 名称以精确匹配 delta，正文规则是更新后的规范。

## Goals / Non-Goals

**Goals:** 在真实责任层拆分采集用途，使用同一安全正文矩形完成纯 PDF 续读与文字互切；格式兼容、同页更新、异步恢复保护可验证。

**Non-Goals:** 不重做文字分页、不新增 OCR、不重构绘图库、不改变 EPUB/其他格式进度；本次按已确认范围覆盖默认 Web/WebView 链路，实验性原生 PDF 引擎不包含在内；本轮执行 apply 与自查，不发布或部署。

## Decisions

### 1. 定义一条安全阅读线，避免双重扣除

统一有效正文矩形 V，使用滚动容器 client 内容边界及该容器内**剩余**遮挡，L = V.top，即 safe area / 顶部栏下方可阅读内容的上边界，无新增 1px 或固定经验偏移。safe area、标题栏若空间重合，取实际遮挡并集，而不是累加；宿主已将容器整体移到安全区域时，内部传剩余遮挡 0。底栏和左右安全区用于判断真实可见区域，底部既有留白不计入页面高度。

复用 readingViewport 与已有 containMargin 参数。WebBase 的 max(editorTop, safeAreaTop) 已表达重叠关系，先验证现有接线；若特定宿主布局已经预留同一空间，应在宿主责任层传递剩余遮挡，而不是 reader 猜测原生环境或给每个恢复回调补常数。旋转、分屏及 inset 变化后重新测量 V，恢复期间不发布中间位置。

备选“只在恢复末尾 scrollBy safeArea”无法修复首行判定，还会重复扣除，不采用。

### 2. 纯 PDF 续读只依赖页面几何

采集从允许且与 V 有正面积交集的显示页面中，按阅读顺序选择穿过 L 的页；如果 L 在页间隙，选择 V 内下一允许页，比例夹至 0。没有允许可见页时 pending，不保存页首。页号使用原始一基页号，隐藏页和范围外页不参与。

P 继续使用当前旋转/裁切后的显示页框，不含页间距；L、P 必须在同一 CSS 坐标系。复用 pagePercentage：`r = clamp((L - P.top) / P.height * 100, 0, 100)`，保留小数，不额外乘缩放或 DPR。Geometry 就绪即可返回比例，即使正文可见或文字层迟到；页面几何未就绪、恢复中、加载失败不覆盖稳定进度。

恢复先等待目标页几何，再令 `P.top + P.height * r / 100` 对齐新的 V.top，沿用 alignTop 的实际滚动边界夹取和横向位置语义。可达位置误差 ≤ 2 CSS px；不可达比较夹取后的期望 scrollTop。不同裁切/旋转后比例以新显示框解释，与现有无字比例规则一致，不承诺原图物理点不变。

备选“有字仍记文字，只给图片记比例”不能满足纯 PDF 统一比例要求；“全书 scrollTop 比例”会受页间距、懒加载及隐藏页影响，均不采用。

### 3. 互切采集与续读保存分离

保留完整 ReadingPosition 的 ready/pending/failed 表达，同时在 PDF 内部将“几何位置”和“首行源文字”分成独立采集路径。文字采集沿用字符 Range / canonical 源偏移映射，按 V 与页面裁切框求交，完全被顶部遮挡、左右离屏或底栏遮挡的文字不参与；部分露出的首行继续算首行，同一行按既有阅读顺序。文字层未就绪不能被 null 冒充成“无文字”。可维持公共 captureTextAnchor 返回类型，通过内部状态或伴随结果承载 pending，避免强迫消费者修改公共 API。

EngineDocumentViewer 发布 Layout 比例时，文字通知必须来自独立采集，不能再通过比例有没有 offset 决定。Reader 模式交接顺序为：冻结/冲刷来源稳定进度 → 单独采集当前安全首行 → 有字使用源字符交接 → 已确认无字才取页内比例回退。删除 handoffReadingPosition 中持久化比例的提前优先分支；完成交接前不切到目标旧进度。pending 时等待/保留当前模式，失败沿既有提示和重试，不将就绪几何伪装成就绪文字。

Layout → Text 打开包含源字符的可视页；遵守现有按钮分页，不强迫目标字符成为 Text 首行。Text → Layout 用 Text 当前实际首行对应源字符，行顶对齐目标安全正文顶部。返回后的新 Layout 续读快照最终是对齐结果的几何比例，文字锚点用于此次导航；对齐完成之前不发布临时比例。无字互切保留现有同页比例回退和重返比例语义。

不将页高比例乘文本长度，不使用目标模式陈旧位置，不通过相似字符串查找替代源字符偏移。

### 4. 数据和生命周期保持兼容

新 Layout 位置沿用 ReaderBookmark 中的 `{pageNumber, verticalPercentage}` 分支，不增加新键、不双写第二份进度。历史文字 Layout 进度继续读取并按安全文字对齐；读取不触发新格式回写，用户下一次有效阅读移动/导航才保存比例。文字书签和高亮导航仍用文字目标，不全局把 normalizeBookmark 转成比例。

已确认的模式导航完成后，允许记录其最终几何位置；历史恢复、纯重排、受控回显和迟到文字层不主动覆盖最后稳定记录。沿用现有保存节流、flush 和文档代次防串写，保存时合并最新 ReaderData，保留高亮、绘图及另一模式进度。

### 5. 依赖接入与验证责任

reader 修复须在 reader 源码完成，并通过其类型、单元和真实浏览器几何回归。WebBase 使用正式发布的 reader 版本及对应锁文件做产品接入；不得在 WebBase 复制 PDF 定位算法、修改 node_modules、引入 pnpm patch 或运行时 monkey patch。若未发布可用版本，则集成待该依赖就绪，不标记产品已交付。

Apply 只读复核补充：当前 WebBase `ReaderEditorPane.tsx` 未传 `engineSource`，其 document-only 渲染器不会仅因 reader 发版自动转入 PDF.js。本轮不扩大为该渲染器重构；下游正式依赖接入还必须接通原 PDF 引擎源，并验证实际走到本次修复路径。具体变量、文件和验收条件见 `docs/ham228-webbase-integration.md`，不得宣称 WebBase 产品已经修复。

该 reader change 的落盘范围仅 reader，WebBase 集成要求是下游交接契约；后续若需要修改 WebBase，使用该仓库自己的 OpenSpec 根和配置承接，不从此 change 越界修改其源文件。本轮不创建第二个独立 change。

开发时验收为 Web-only。reader 可用 `yarn typecheck`、`yarn test:run`、`yarn build:demo`；浏览器几何回归基于现有 `scripts/check-reading-progress.mjs` 的 Playwright 模式扩展，脚本使用前核对参数。WebBase 仅用 `pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web`。禁止把 native 构建、Maestro 或模拟器/真机作为开发完成门槛。浏览器注入安全区能验证 Web 坐标和宿主参数链路，不能证明原生实验引擎行为。

## Risks / Trade-offs

- [改采比例使 captureTextAnchor 永远返回空] → 独立文字采集，并覆盖“存比例但互切必须找文字”的反例。
- [同一 safe area 在宿主与 reader 扣两次] → 覆盖容器覆盖屏幕与已由宿主预留两种布局，比较实际 V.top。
- [几何已就绪但文字 pending] → 纯续读可保存；互切等待文字，二者使用不同就绪条件。
- [恢复事件误保存临时 0 或回显反复导航] → 延续恢复抑制、文档代次及位置去重，覆盖连续切换和关闭冲刷。
- [阅读中的裁切锚点与持久化比例用途不同] → 保留 usePdfLayoutAnchor 的临时布局职责，验证与新续读采集互不抢占。
- [旧规格要求文字优先] → 同时更新通用进度规则和 PDF Layout 规则，保留 Text/EPUB 及历史数据场景。
- [实验原生路径存在不同算法] → 显式记录范围假设及实际差异，不用默认链路的验收结论覆盖它。

## Migration Plan

实现阶段先加入独立采集及针对性回归，接通 Layout 发布和模式交接，再验证旧进度与 flush。reader 正式版本可用后由 WebBase 集成阶段接入并验证宿主安全区与 sidecar 往返。本提案不执行发布、依赖升级或迁移。

无需批量迁移：旧文字进度原样可读，新进度使用已支持的百分比分支；回滚后旧代码仍能读取该分支。不得通过删除进度或标注数据回滚。

## Open Questions

无阻塞技术问题。2026-11-11 apply 交接评论已确认实验性原生 PDF 路径暂不纳入；如用户要求覆盖，应先扩充相应原生能力的规格和任务，不能由实施者默默用 reader 修复冒充覆盖。2 CSS px 沿用已有规格；页间隙取下一允许页、Text 保持分页、旋转/裁切使用当前显示页框均沿用已有契约。
