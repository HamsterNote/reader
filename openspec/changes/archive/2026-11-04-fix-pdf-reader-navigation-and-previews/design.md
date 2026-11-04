# Design

## Context

动机见 proposal.md。项目使用 OpenSpec 1.13.1、`spec-driven`，config 只指定 schema；项目内未发现随附 propose 命令或技能副本，遵循本次安装技能和 CLI instructions。无活动 change，相关既有变更已归档；本 change 延续官方 PDF viewer 和 Text 可视分页，不推翻已有能力。

已观察到的源码事实：
- `EngineDocumentViewer.tsx` 给 PageBrowser 传入空的 `pageSizesByPageNumber`、`baseImagesByPageNumber` 和空操作的 `onPageVisibilityChange`。`PageBrowser.tsx` 依赖这些数据设置比例和图片；截图中首项细骨架、其余空白与此链路缺失一致。尚未运行复现，不把其他推断称为已确认根因。
- `PdfDocumentViewer.scrollToRange` 仅将高亮起始页赋给 `currentPageNumber`，没有范围内定位。`restoreAnchor` 依赖选择上下文，文字使用 span.scrollIntoView，比例恢复也等待文本上下文；扫描页可能无法完成。
- Layout 捕获只检查当前页 span 的 bottom 是否超过容器 top，没有完整裁剪、底边、字符片段和 SafeArea 判定。Engine 的书签和进度在捕获失败时回退到 0%，而不是实际页内位置。
- `Reader.tsx` 已有 readingPositionHandle、模式交接和持久化门控。`pdfTextPagination.ts` 已能用字符 Range 找到源锚点所在可视列；`useReadingViewport.ts` 已按 max 合并底栏与调用方边距并留出 8px，不应另建模式同步链路。
- `ReaderBookmark` 已支持文字锚点或页内百分比；`ReaderTextReadingProgress` 仅有 currentPageNumber/anchor，不能表达无文字视口的非零比例。现有测试的官方 viewer 是 fake，不足以证明真实几何与缩略图可用。

## Goals / Non-Goals

**Goals:** 预览与正文共享 PDF 会话；以原页+canonical 字符或页内比例作为统一定位输入；复用现有模式交接，恢复成功后才发布进度；几何统一消费实际安全正文矩形。

**Non-Goals:** 不接入另一 PDF 引擎、不自建坐标变换矩阵或全书文字索引、不用可视列号取代原页身份、不把 OCR/绘图或复杂 PDF 阅读顺序重建纳入本次。

## Decisions

### 1. 缩略图消费现有 PDF 会话并按侧栏可见范围渲染

在 PDF viewer 会话旁提供内部预览适配，复用已加载的 PDFDocumentProxy，通过 getPage/getViewport 获取正确尺寸，通过 PDFPageProxy.render 生成限尺寸缩略图，填回 PageBrowser 的现有映射和可见性回调。该方案优先使用已导出的官方 core API；`pdfViewerLib.ts` 当前只导出 PDFViewer/PDFLinkService/EventBus，不假定 PDFThumbnailViewer 是可直接导入的公开导出。

仅渲染侧栏可见项和小预取窗口，优先正文任务；离屏缓存有容量上限，按文档会话+页号+预览尺寸/旋转标识。关闭侧栏取消待执行预览；切书、卸载释放 renderTask、canvas 和对象 URL，过期结果不得覆盖新文档。真实空白页也保留正确比例和已完成状态；失败显示失败/重试，不无限骨架。

备选：从正文 DOM 截图会遗漏未访问页且与正文回收耦合；重新解析一本 PDF 或全书同时渲染浪费资源，均不采用。缩略图覆盖源页内容，不要求叠加高亮/笔迹。

### 2. 同一安全正文矩形用于捕获与恢复

从 Reader 的 containMargin、安全区及实际工具栏测量传递有效正文矩形；能复用 `useReadingViewport` 的测量协议就扩展复用，PDF Layout 与 Text 均消费同一口径。宿主已让出的 SafeArea 不再扣减；重叠占用按边界合并/max 而非逐项相加。沿用现有 8 CSS px 内容与控件间距作为本提案默认安全距离，非用户额外确认值。

安全视口定义为阅读容器的可见部分，扣除未由宿主布局让出的安全区、控件占用和调用方边距，并加入上述间距。捕获时只考虑与该矩形实际相交且未被裁切/隐藏的文字片段，跨 PDF 页时选安全视口中最靠上的可定位行；同高采用既有阅读顺序。首行部分露出时取相交片段的第一个源字符，不取离屏 span 起点。多栏和旋转沿用既有源文字映射，不新增版面分析。

通过 canonicalRangeToDomRange、Range.getClientRects 和现有 canonical 索引定位字符；不能以整个 span 包围盒或全页第一段代替。文字层尚未就绪与“已就绪但无可见文字”分开处理，前者等待或报错，不当成无文字回退。零尺寸/重排中冻结最后稳定进度。

备选仅增加固定 scroll offset 无法覆盖 SafeArea 与变动工具栏；直接依赖 currentPageNumber 或 DOM 顺序无法捕获跨页视口首行，均不采用。

### 3. 优先复用官方目的地与坐标 API，reader 仅适配业务锚点

页定位继续使用 PDFViewer/PDFLinkService；精确目标优先调用该版本 PDFViewer.scrollPageIntoView 的 XYZ 目的地，并通过页面 viewport 的 convertToPdfPoint/convertToViewportPoint 转换目标，保持当前缩放。使用官方 EventBus 的 pagesinit/pagerendered/textlayerrendered 等既有事件确认所需几何就绪。实施时以固定版本类型/源码核对参数，不引入私有字段依赖。

pdfjs 不负责 reader 的 canonical 字符端点、Text CSS 分栏及双模式进度交接。将现有 canonical 字符范围/必要的历史矩形解析成页面目标，然后交给官方坐标和导航能力；只有官方 API 不能表达安全区偏移时才在内部滚动容器做一次实测差值校正，禁止外层 scrollIntoView 和手写旋转矩阵。书签和高亮共用此定位执行路径。无文字比例定位依赖页几何，不等待文本选择上下文。

高亮以稳定 range ID 解析起始字符，等待目标页/文字层后让对应范围出现在安全视口，保留激活与评论行为。历史数据映射失败时明确提示不能定位并保留原数据，不静默跳到同文其他位置。历史纯页书签仍到页首；精确书签添加时即时捕获安全首行，确无文字则存实际比例，不写固定 0%。同一定位点去重沿用现有 key 规则。

备选仅设置页号不能解决同页长文和跨可视页定位；文本字符串搜索会误命中重复内容，均不采用。

### 4. 双向切换保持源锚点；比例是无文字时的回退

Layout → Text 捕获安全视口首行源字符，使用现有 pdfTextAnchorColumn 打开包含该字符的可视页。Text 是固定可视分页，锚点可位于该屏中途，不要求强制重排使其成为第一行；Text → Layout 则捕获 Text 实际可见首行字符，将对应 PDF 行对齐安全视口顶部。两方向优先当前位置，不能用目标模式上次的旧进度覆盖本次交接。

比例定义：安全视口上边缘在当前可见源页显示范围中的纵向位置 / 该页显示高度，限制到 0..100；裁切按可见页范围计算，几何转换使用 viewport。安全视口跨页且无文字时取与安全视口交集面积最大的允许页，同面积取前页。含文字但当前窗口仅见图片/空白也适用比例回退，不能拿屏外文字冒充首行。

Text 的对应原页有 N 个可视页时，比例 r 映射到 round(r/100 × (N-1))，N=1 时进入唯一屏；无文本原页维持现有无文字状态。返回 Layout 时重新判定 Text 当前安全视口：有文字始终使用实际首行，即使此前通过比例进入；只有仍无文字且未改变原页时沿用交接比例，从而恢复扫描页位置。若 Text 显式翻到另一无文字原页，该页缺少既存比例时用 0%。这样避免简单回页首，也不让保留比例压过实际文字锚点。

兼容表示：在 `ReaderTextReadingProgress` 中增加可选 `verticalPercentage?: number`（0..100，仅无 anchor 时使用），沿用 layoutReadingProgress 的 ReaderBookmark 联合类型。缺字段旧数据仍按页首回退；有 anchor 时始终优先 anchor。新字段在 Reader 数据序列化/受控回调中原样保留；不修改高亮 schema、不保存临时列号。书签类型无需改变。这是提案中的向后兼容增量，不是现有已实现字段。

扩展 Reader 已有模式交接和请求代际，提交顺序为捕获→冻结进度→加载/排版/定位→确认目标可见→提交稳定位置；切书/切模式/后发导航使旧请求失效，所有挂起操作须成功、失败或取消收敛。失败可重试且保留原位置，不把异步首屏写入持久化。备选按整本书页数比例跳转会丢页内精度；运行时只保留比例则重开丢位置，均不采用。

## Risks / Trade-offs

- [pdfjs 文字 item 与视觉行不是一一对应] → 用实际字符片段映射，覆盖同一 span 多行、双栏、连字及旋转 fixture；不把 jsdom fake 结果作为几何验收。
- [Text 分页无法将任意源字符固定为首行] → Layout → Text 验收为包含首行锚点的可视页，反向按 Text 当前真实首行对齐，文档明确此非对称性。
- [SafeArea 重复扣减或页尾无法精确贴顶] → 统一测量口径；末页滚动上限时采用最近可达位置并保证目标可见，不增加整屏无意义尾空白。
- [预览与正文争抢渲染资源] → 可见窗口、有限并发和缓存、正文优先，浏览大文档后检查取消与释放。
- [新增可选比例字段被宿主过滤] → 覆盖 ReaderData 读写和受控回调往返；老数据无字段不变，旧消费者忽略字段只退回原页，不能损坏原标注。

## Migration Plan

先接入预览并形成精确导航共用路径，再打通安全视口和双向交接，最后验证旧数据及真实浏览器/移动 WebView。无需批量数据迁移或改写旧高亮。可回滚运行代码及可选字段支持，原有记录保持可读；已写比例被旧版忽略时仅失去页内精度。当前阶段只写提案文档。

## Open Questions

无阻塞问题。合理假设为沿用 8px 安全间距、缩略图不含标注、Text 比例按可视页序列映射；均为提案选择，待评审，不描述为用户已确认。截图所用原 PDF 未提供，实施验收可先使用仓库及可构造样本；若取得该原文件再补同文件复测。
