# Design

## Context

动机见 proposal.md。项目为 OpenSpec 1.13.1、`spec-driven`，配置仅指定 schema；未发现仓库自带的 propose 命令或技能副本，遵循本次已安装的 openspec-propose 技能及 CLI 产物指令。现有进行中 change 列表为空，相关基线为 `epub-web-reader` 和 `reader-data-compatibility`，无须创建新能力。

`EngineDocumentViewer.tsx` 显式传入 scrolled；`foliateEpubEngine.ts` 默认亦为 scrolled，内部已有 renderer.next/prev 的章节边界手势逻辑，尚未向组件暴露可视页翻页接口。onRelocate 已把 DOM Range 经 EpubCompatIndex 转为 ReaderTextAnchor（旧逻辑 pageNumber、textId、offset）；组件 publishPosition 按 restored/progressEnabled 门控发布进度。

Foliate paginator 不仅有分页和尺寸处理，还在自身及 iframe 文档绑定触摸事件，并在选区越界时 next/prev。仅修改 flow 或外层 overflow 无法实现“仅按钮”。现有底栏 Popover 使用 bottom edge、edgeOffset=32；绘图堆叠样式高度 128px，普通堆叠 64px。因此布局必须按实际控件占用计算，不能把工具栏浮在整页正文上。

## Goals / Non-Goals

**Goals:** 用既有引擎能力实现可视分页，同时让导航、测量和进度共享一个稳定锚点；浏览器与 Expo 共用 Web 阅读层获得相同行为。

**Non-Goals:** 不生成全书永久可视页号或重新定义旧 page-N，不重写 EPUB 解析器、不新增滚动模式开关、不改变 PDF/其他格式/独立 native-reader，也不进行实现或部署。

## Decisions

### 1. 单视口分页与双层位置模型

在引擎适配层把 EPUB 默认与组件入口设为 paginated，并把重排版式的 max-column-count 限为 1：每个可视页高度来自扣除底部控件安全区域后的实际正文视口，宽度来自容器，不能沿用宽屏默认双栏。分页由 Foliate 排版而非按字符数估算。固定版式走其现有固定页面渲染，单页适配可用区域。

增加适配层相邻可视页操作和导航状态（canPrevious、canNext、busy），使用 renderer.next/prev；禁止用 goToPage(pageNumber±1)，该接口是旧逻辑页跳转。边界结合实际分页位置、spine 可读顺序、隐藏页/可读范围及补封面计算，封面与正文连续且不重复。上一章末页与下一章首页通过实际排版边界连接，全书端点不循环。翻页串行化，忙碌期间禁用两个按钮，导航完成后更新状态；失败保留最后成功锚点并沿现有错误提示恢复控件，切书后旧回调不得更新新书。

备选：章节级 goToPage 简单但不满足逐页；自行切割 HTML 会破坏样式、图片、选区与兼容映射，均不采用。

### 2. 在引擎层禁用隐式翻页，在文档层限制滚动

删除适配层 turnAtBoundary 的滚轮/短滑触发链；为 vendored paginator 增加可配置的手势及选区自动翻页禁用能力，由 EPUB 适配器启用，默认不改变其他消费者。同步 `vendor/foliate-js/view.d.ts` 的实际 renderer 类型及 `paginator.d.ts`，在 PIN/MANIFEST 记录最小差异，避免与未来上游同步混淆。

在正文 iframe、Foliate 容器及阅读区空白区域绑定可清理的输入限制：阻止滚轮/触控板的默认滚动、单指平移和滚动按键；保留按钮 Enter/Space、输入控件编辑、页内选字/手柄、绘图及侧栏交互。样式限制 overflow/overscroll，不能只用全局 touch-action:none 破坏长按选择。iframe 复用或切书时按既有 releaseLiveDocuments/destroy 生命周期移除监听。

备选：仅父容器 preventDefault 接收不到 iframe 事件，且阻止不了 paginator 自行翻页；仅隐藏滚动条仍能滚动，均不满足要求。

### 3. 右侧按钮与正文空间采用同一测量结果

在 EngineDocumentViewer 的 EPUB 分支渲染两个图标按钮，沿用现有 Button/Popover 主题、底部 32px 基准及边距规范，按钮 aria-label 分别为上一页/下一页。通过底栏布局接线/测量为右侧组保留独立区域；窄屏时既有工具栏可换行或堆叠在按钮上方，按钮保持右对齐。绘图面板显示时也参与占用测量。

以 ResizeObserver 观测阅读容器和控件实际边界，正文底边止于控件安全区域上方；引擎与高亮/选区叠层共享调整后的视口坐标，不仅缩小 iframe 留下错位叠层。合并同帧测量并忽略零尺寸，避免观察回路。PDF 分支不使用这组样式与占用量。

备选：固定 bottom 覆盖正文会遮最后一行；固定预留 64px 无法覆盖绘图堆叠和窄屏，故采用实测。

### 4. 成功导航后按稳定字符锚点保存

按钮触发前显式打开 progressEnabled；等待成功 relocate 后调用既有 publishPosition，即使逻辑 pageNumber 未变也必须发出新 offset。保存仍走 ReaderTextAnchor/既有 text/layout 进度回调及宿主存储，不新增 CFI 公共字段。CFI 只能作为引擎内部瞬时位置；封面及无文字图片页用旧逻辑页回退。

窗口/字号/底栏测量变化前冻结最后成功锚点，暂停中间进度发布；排版稳定后 goToAnchor 定位包含锚点的可视页，再刷新边界并解除门控。恢复同样先装载数据、后定位、再允许发布，避免初始零偏移覆盖已有记录。不是要求可视页起始字符在重排前后相同，而是原锚点仍在当前页中。

备选：存可视页序号/百分比在字号或窗口改变后失真；改为公共 CFI 与现有兼容契约冲突，均不采用。

## Risks / Trade-offs

- [jsdom 无真实布局] → 假视图只验证导航、状态和回调；单章多页、重排与遮挡必须在真实浏览器及移动 WebView 验收。
- [图片和字体异步完成导致二次排版] → 监听稳定排版/尺寸变化，按原锚点恢复，覆盖混排与超高图片样本；图片适配可用页框，不靠正文滚动看全。
- [禁用触摸影响选字、叠层坐标偏移] → 浏览器鼠标与 iOS/Android 长按、高亮、绘图分别验证，限制仅作用于正文滚动路径。
- [既有工具可隐藏逻辑页/限定范围] → 只在可读集合内翻页并重新计算首末边界；不把可视页状态写入旧工具的逻辑页字段。
- [vendor 修改维护成本] → 将禁用能力限制为显式配置，记录补丁并更新资产测试，不替换整份上游代码。

## Migration Plan

无需数据迁移。实施阶段先补引擎导航与输入控制，再接线布局和进度，最后验证 Web 与移动宿主。回退时还原实现变更即可，持久化结构始终保持原样；本阶段仅交付文档。

## Open Questions

无阻塞问题。合理假设：目录/书签/高亮显式定位不属于被禁用的顺序翻页；固定版式按原始单页适配。这些是本提案的范围解释，尚非用户额外确认。
