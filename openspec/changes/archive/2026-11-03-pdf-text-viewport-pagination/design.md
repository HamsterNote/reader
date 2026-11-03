# Design

## Context

动机见 proposal.md。使用本机 OpenSpec 1.13.1、项目 `spec-driven` schema；配置只指定 schema，未发现项目内 propose 命令或技能副本，按本次安装技能与 CLI instructions 生成。创建前活动 change 列表为空。

观察到的路径：`Reader.tsx` 在 text 且非 EPUB 时路由至 `IntermediateDocumentTextViewer`，该组件使用原生滚动虚拟列表、`useLazyPageQueue`、原页范围过滤、选择适配和文字锚点恢复。EPUB 使用 `EngineDocumentViewer` 与 Foliate；按钮、ResizeObserver 测量仍位于 EPUB 分支，`src/epub/buttonOnlyInput.ts` 可抽成通用输入能力。

`createPdfTextModeDocument` 初始化时取各页尺寸、正文 getTextContent 则按需调用。`PdfTextContent` 按源几何重建段落，展示时补空格，但通过 data-text-id、data-selection-start-offset 及 `pdfSelectionOffsets` 保持源字符映射。CSS 分页不能用展示 textContent 的累计长度替换这些端点。`reader-data-compatibility` 继续作为兼容性约束，不改变其要求。

## Goals / Non-Goals

**Goals:** 共享可视分页的外壳与导航协议，格式适配器拥有排版及源锚点；Text 的可视页与 PDF 原页身份彻底分离，复用现有选择/进度契约。

**Non-Goals:** 不建立全书永久可视页表，不做所有格式统一引擎，不抽象全部标注业务，不把 PDF 转 EPUB，不新增公共分页 API；不新增跨可视页拖选自动翻页。非目标的产品范围见 proposal.md。

## Decisions

### 1. 共享外壳，适配器保留格式差异

以下路径是拟新增或提取的内部模块，当前尚不存在，不构成公开导出承诺。

| 层 | 共享或分叉 | 拟落点与责任 |
| --- | --- | --- |
| 双按钮及状态展示 | 共享 | `components/reading/ViewportPaginationControls.tsx` 从 EngineDocumentViewer 提取主题、aria、焦点、ready/busy/canPrevious/canNext 与回调；PDF/EPUB 使用同一组件 |
| 底栏与正文空间 | 共享 | `components/reading/useReadingViewport.ts` 统一测量根容器、按钮、实际底栏/展开面板；返回可用正文矩形，复用 Reader 已有 inset 接线，避免重复扣减 |
| 输入限制 | 共享 | 将 buttonOnlyInput 移至 `components/reading/`，所有调用点调整；按目标谓词排除侧栏、Popover、输入控件，保持选择手柄事件，不仅隐藏滚动条 |
| 导航协议 | 共享契约 | 内部 previous/next、capture/restore 稳定锚点、就绪/忙碌/边界状态；控件不接触页号、CFI 或具体排版 |
| EPUB 分页 | 分叉 | 继续 `foliateEpubEngine` 的 renderer next/prev、章节/固定版式、iframe 监听及 EpubCompatIndex；不迁移到 PDF 的 DOM 算法 |
| PDF Text 分页 | 分叉 | 新 `pdf/pdfTextPagination.ts` 适配器驱动 Text 页内容 DOM 分栏、原页相邻关系和 canonical 锚点；不加载 Foliate |
| 文本与标注 | 复用现有能力、映射分叉 | PDF 继续 facade、PdfTextContent、pdfSelectionOffsets、textAnchor 和 selectionAdapter；EPUB 保留自身字符索引和几何；仅传稳定公开锚点，不合并坐标系统 |
| 进度发布 | 共用既有契约、生命周期分叉 | PDF 沿用 Text viewer 的恢复请求/会话代际，EPUB 沿用引擎 relocate 门控；共享组件不自建持久化状态机 |

备选：直接复用 EngineDocumentViewer 会引入 Foliate/iframe 与 PDF 原页映射耦合；完全复制 EPUB 外壳则留下两套控件及空间计算，均不采用。不为形式统一提取未经验证的通用排版算法。

### 2. PDF 每个原页内部按真实 DOM 分页

仅 `isPdf` 的 Text 分支启用新适配器，其他文本格式保留现有滚动虚拟列表。复用页加载队列与既有 Text 页内容组件，在活动原页渲染完整可选择正文，以实际正文宽高建立固定高、单列可视窗口的 CSS 多栏排版；列间距纳入列步长，内部程序定位列，外部禁止用户滚动。通过 DOM 的实际片段边界确定非空列及目标锚点所在列，不按字符数估页，不依赖一次性计算全书总页数。

保留同一原页的一份源 DOM 与字符注册，不为每个可视页克隆文字或重编号；正文可能在一个源 span 中间换栏，捕获位置和高亮几何需用 Range.getClientRects 找到当前窗口内片段，而非 span 的包围盒。可视窗口裁切只影响展示与命中范围，不能删掉原字符。列变化后更新选择/高亮叠层，页外片段不响应命中。字体或段落重建后的显示补空格继续不计入源偏移。

到原页边界才按已过滤可读原页集合加载相邻页；后退先完成前页排版再进入其最后非空列。原页不足一屏保留单屏，不跨原页拼接；这是保持原页定位和边界可预测的合理假设。无文本原页显示单屏空状态并提供现有 Layout 切换入口，保留其原页进度，不静默跳过扫描页。过滤后无可读页显示空范围状态、双按钮禁用，不产生虚构 page-1 进度。

缓存只保存活动页与现有加载窗口，受 maxLoadedPages 限制；分页状态按原页、尺寸、字号及内容版本失效。原有 facade 预取页尺寸不改成整册正文提取。备选：scrollTop += height 会截断行且无法可靠覆盖最后一页；把完整 PDF 渲染为全书列会破坏按需提取，均不采用。

### 3. 同一个矩形驱动空间与重排

复用 Reader 已有底栏占用信息，补齐按钮及展开面板实测值，将最高占用上缘到根底部作为一次性安全 inset，合并调用方 containMargin，避免 Reader 和子 viewer 各扣一遍。共享 hook 提供实际正文矩形，分页窗口与工具叠层使用同一原点及尺寸。宽屏工具栏左、按钮右，窄屏堆叠但按钮仍右对齐；沿用现有底部基准。

ResizeObserver 监听根与控件，合并同帧变化并忽略零尺寸；字号、字体就绪及页内容变化均触发按稳定锚点重排。不同格式只消费测量结果，不改全局 PDF Layout 样式。备选固定预留高度无法覆盖窄屏面板，纯浮层会遮挡正文，故不采用。

### 4. 稳定锚点与会话生命周期

PDF 内部位置为原 pageNumber + 当前列的稳定 ReaderTextAnchor，临时列索引只用于本次尺寸。按钮按串行导航执行：就绪→忙碌→加载/排版/定位→提交新锚点→更新边界；无成功定位不发布新进度。显式原页定位到首列，字符定位到含目标片段的列。每次翻页即使原页未变也更新现有 Text 进度。

重排前捕获最后成功锚点，冻结进度发布，排版后恢复包含锚点的列再解冻；恢复期间不以临时首列覆盖已存进度。无字符时仅沿用原页回退；历史锚点无法唯一映射时保留原数据和既有不可定位提示，不绑定同文其他位置。Layout/Text 切换继续使用 Reader 现有模式进度与 readingPositionRef 桥接，不创建第二套同步逻辑。

利用 Text viewer 现有请求 token/documentGeneration 扩展到分页异步操作；切书、切模式、卸载后失效旧结果，清理 observer、输入监听与待执行帧。加载失败保留最后成功状态，展示可重试错误；恢复成功前不允许重复翻页。备选保存列号或展示文本偏移在重排及补空格后失真，不采用。

### 5. 按格式启用输入限制与工具回归

共享限制器只拦截正文滚动路径，按钮/输入编辑/侧栏独立滚动不受影响；PDF 在普通 DOM 上绑定，EPUB 仍须在 iframe 及引擎层阻止手势与选区自动翻页。禁止以全局 touch-action:none 替代完整选择验证。翻页后清理未提交的临时 DOM 选区及 Popover，已保存高亮继续存在；页内新增、调整、删除、跳转和关联评论保持原契约。既存跨页高亮需按源范围恢复，不新增跨可视页拖选手势。

## Risks / Trade-offs

- [分栏 Range 几何与选择库对多片段支持不足] → 在活动可视窗口过滤/裁切 Range 片段，添加源 span 跨列与高亮端点回归；真实浏览器是验收依据，jsdom 只测状态和映射。
- [源原页文字极多仍需单页完整 DOM] → 保持原页级懒加载与卸载上限；不预排全书，在大页样本记录耗时/DOM 数及内存释放，不承诺本次解决任意病态单页性能。
- [多栏或复杂 PDF 既有重建顺序有限] → 使用既有 pdfTextLayout/Spacing；对两栏、连字、旋转样本验证不新增遗漏或端点漂移，不扩大为 OCR/版面分析项目。
- [共用外壳使 EPUB 行为回退] → 先提取再回归既有 EPUB 控件、固定版式、重排和进度；归档方案中未完成设备验证不能视为已通过。
- [触摸拦截影响原生长按] → iOS/Android WebView 实机覆盖长按、手柄、页边拖选和侧栏；设备未验证须如实记录，不以桌面模拟替代。

## Migration Plan

无数据迁移、无新运行依赖。实施先提取共享外壳，再接 PDF 分页与选择/进度，最后运行跨格式及宿主回归；回退恢复渲染路径即可，持久化数据始终使用原格式。本 change 当前只生成文档，不执行 apply。

## Open Questions

无阻塞问题。范围解释/合理假设：单原页独立分页、仅按钮顺序阅读完全对齐 EPUB、无文本原页保留空状态而非跳过，均为提案选择，未作为用户额外确认的要求。具体内部文件命名可由实施者按仓库约定调整，不改变规格和复用边界。
