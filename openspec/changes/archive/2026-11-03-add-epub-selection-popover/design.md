# Design

## Context

动机见 `proposal.md`。本提案基于仓库静态阅读，未运行浏览器复现，故不将某个事件或组件认定为已验证根因。仓库 OpenSpec CLI 为 1.13.1，`openspec/config.yaml` 指定 `spec-driven`；未发现项目内另附 propose 命令或技能，使用运行时提供的 openspec-propose 技能及 CLI 产物指令。

已确认的实现与差异：

| 方面 | PDF 基线 | EPUB 现状 |
| --- | --- | --- |
| DOM 及选区来源 | `PdfDocumentViewer` 主文档 text layer；按 canonical 文本映射 | Foliate 章节 iframe；`foliateEpubEngine` 监听章节 selectionchange/click |
| 序列化 | `pdfSelectionSerializer` 输出 page-N、canonical offset、页内矩形 | `epubCompatIndex`/`sectionTextIndex` 输出旧逻辑 page-N、规范化字符偏移及文本，矩形可为空 |
| 文本规则 | 跨页保留起点页后缀与终点页前缀，无分隔符 | 沿用同一历史跨逻辑页拼接契约；章内另有空白折叠、虚拟空格与元素边界映射，不能直接使用 Range.toString() |
| 显示 | text layer 范围与页面 overlay | 按兼容端点恢复章节 Range 并交给 Foliate overlayer；不能把单个可见片段当成完整历史范围 |
| 控件 | 与 EPUB 共用 `EngineDocumentViewer`、`EngineSelectionControls` 和默认 Popover | 已有 iframe 坐标转换、命中、激活、`updateRangeEndpoint` 等能力，缺少此次完整边界验收 |

`Reader.tsx` 注入默认或自定义 Popover；默认新选区有高亮和颜色，已有高亮有删除和颜色，可选评论按钮保持现状。`EngineSelectionControls` 使用 Range 几何显示 Popover 和鼠标手柄，触摸手柄留给原生选择。现有端点更新已尝试保留历史另一端，应强化边界而非重写范围模型。

现有 `epub-web-reader` 已要求高亮重排稳定、禁止选区越界翻页；`reader-data-compatibility` 已要求既有公共回调与历史数据兼容。本 change 追加 EPUB 可检验细则，不替换这些要求。进行中的 `replace-pdf-painting-core` 修改绘图与存储版本，故本次不将“始终写 v4”写成新要求，不改其文档或迁移路径。

## Goals / Non-Goals

**Goals:** 在现有引擎接口上打通 EPUB 选区来源、目标身份与控件状态；让视觉反馈、回调负载和宿主权威数据一致；将浏览器真实 iframe 交互纳入验收。

**Non-Goals:** 不新增范围粒度菜单，不设计跨 iframe 连续选择，不恢复手势翻页，不替换 Foliate、不改 PDF 引擎、不更改存储 schema、绘图或评论删除策略。

范围解释为工作假设：需求中的“范围切换”按触发评论明确的跨段落/跨节点扩展，以及当前草稿和高亮目标的切换处理；不推定用户要求额外的词/句/段模式。跨章历史高亮仅编辑可见端点，保持既有按钮翻页方式。

## Decisions

### 1. 复用 PDF 的 Popover 外观与入口，以 EPUB 文档为选区来源

保留 `DefaultSelectionPopover`、`DefaultHighlightPopover` 及自定义内容扩展；EPUB 的有效 Range、Selection 必须来自当前 live iframe 的 ownerDocument，不依赖外层 window.getSelection。`EngineDocumentViewer` 负责当前活动目标；引擎负责定位和序列化。Popover 内指针操作保留有效选区，触摸 pointerdown/click 只确认一次。

几何使用 iframe 到外层视口转换后的可见 rect，过滤零尺寸及离屏片段后定位；根据实际 Popover 尺寸约束两轴位置，避免仅用固定宽度猜测。章节卸载、重排后重新获取 Range，不继续引用 disconnected 节点。

替代方案为独立 EPUB 菜单或改用 PDF 序列化器；前者复制 UI 契约，后者不理解 EPUB 的 iframe 与旧文本归一化，均不采用。

### 2. 用活动目标与编辑事务约束 selectionchange

沿用/整理现有 activeSelection、selectedRangeId、editing/activating 状态，明确转换：

| 起点与输入 | 结果 | 数据操作 |
| --- | --- | --- |
| 无目标/草稿 + 新有效选区 | 替换草稿 | 无 |
| 草稿 + 确认 | 激活新增 ID | 一次新增 |
| 激活 H + 点击 J | 激活 J | 只通知选择 |
| 激活 H + 正文新拖选 | 新草稿，取消 H 活动态 | 不修改 H |
| 激活 H + 明确端点调整 | 编辑 H 的快照 | 移动只预览，完成后一次更新 |
| 编辑 H + cancel/失焦/文档卸载 | 恢复快照或关闭失效显示 | 无提交 |
| 激活 H + 已接受删除 | 无活动目标 | 一次既有删除意图，权威快照移除 H |

鼠标通过已有手柄明确进入端点编辑；触摸仅在已激活 H 且从其原生选择端点开始调整时进入编辑，正文新长按/新选区走草稿。记录编辑前原 ID、完整端点和书籍/章节会话标识，不能只凭“当前存在 selectedRangeId”就把所有 selectionchange 当作修改。原生端点操作以章节触摸选择事件与选择生命周期识别，并在真实 iOS/Android WebView 验证；无可靠有效映射时取消编辑，不猜测持久范围。

程序化激活、恢复、提交期间抑制中间 selectionchange；异步序列化/激活结果携带会话与事务版本，仅最新目标可生效。草稿颜色选择先解除旧高亮目标，防止默认颜色选择器误改旧范围。

替代方案是根据每次选区端点与已保存范围是否相等来决定“新建/编辑”；原生手柄第一次移动就会不相等，不能识别编辑意图，因此不单独采用。

### 3. 端点、文本与标识共同提交

复用 `sectionTextIndex` 的 DOM ↔ 旧字符流双向映射，兼容元素端点、虚拟空格及行内节点。新范围按文档顺序归一化；已保存范围仅替换被编辑的端点，先校验顺序、非空、边界及文本契约，再将 start/end/text 作为一个更新提交。跨章范围沿用起点后缀+终点前缀，不额外纳入中间章节文本或更改历史格式。

将候选结果合并到原始完整 range，保留 ID、createdAt、markerStyle 其他字段及关联字段；几何仅供显示，不能用 iframe 像素反推持久 offset。改色同样采用字段合并。无效范围恢复编辑前快照；跨越另一端导致塌缩不提交。当前不可见端点保留原值，只显示确实在当前可视页内的手柄。

不采用字符串搜索重新锚定：重复段落会误命中；索引不健康时沿用不可定位报告且原样保留历史标注。

### 4. 服从受控数据与既有历史/删除契约

新建/更新沿用 `emitRange`、既有 onSelect/onHighlight/onUpdateRange 及 linked 回调分工；“一次”指每种既有回调不因重复 DOM 事件重复触发，不取消原本并存的不同回调。预览不写历史，完成编辑按既有 update-range 路径记录。单纯激活不作为持久内容修改。

删除继续使用既有 onRemoveRange 宿主契约；受控 ranges 等待宿主回传，未受控范围走内部更新，清理整个 ID 对应的 overlay、活动 Range 与编辑事务。宿主尚未回传时不伪造已持久删除；回传后防止旧操作复活该 ID。评论关联与撤销重做遵守现有路径，不新增删除级联策略或历史类型。

替代方案为菜单直接操作 storage 或局部删一个 overlay；两者会绕过权威数据和历史，不采用。

## Risks / Trade-offs

- [静态代码已有功能，但用户反馈仍不可用，根因未复现] → 实现阶段第一项是用同一 Reader 配置跑 PDF/EPUB 对照样例，记录具体失效阶段；后续任务已有明确改动边界，不把整个设计留待探索。
- [触摸原生端点事件因平台不同而异] → 浏览器模拟只覆盖有限部分，iOS/Android WebView 必须实机验证新长按与已有端点调整的区分、取消与合成 click。
- [按钮翻页和 iframe 生命周期导致失效 Range] → 导航先取消未完成编辑，会话版本拒绝迟到结果；不新增拖选自动翻页。
- [共用组件调整影响 PDF，或与绘图 change 并行] → EPUB 定位逻辑保留在 adapter，公共组件按格式回归；接入时使用主线存储版本，不迁移或覆盖绘图代码。
- [历史跨章 text 只包含两端章节] → 明确沿用已有契约，覆盖固定历史样本，不在此次扩充全书文字模型。

## Migration Plan

无需数据迁移或新依赖。后续 apply 先补行为回归，再在现有入口修复；同一 EPUB 保存重开及历史样本回归通过后交付。若回退实现，保留所有原始范围数据与主线存储格式；回退 UI 改动不运行存储降级。此计划不授权本次执行实现或部署。

## Open Questions

无阻塞问题。上述范围解释为已记录的提案假设，等待评审；未宣称用户已逐项确认。具体失效浏览器与设备信息尚未提供，不作为编造复现结论的依据。
