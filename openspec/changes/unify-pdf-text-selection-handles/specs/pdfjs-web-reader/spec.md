# Spec Delta

## MODIFIED Requirements

### Requirement: PDF text button-only reading controls

系统 MUST 在 PDF Text 的底部右下角提供右对齐的两个翻页按钮，可访问名称为“上一页”“下一页”，沿用 EPUB 底栏主题、焦点与底部对齐基准。系统 SHALL 为实际底栏及按钮占用留出正文区域。正文滚轮、触控板、触摸平移、滚动按键及选区越界 MUST 不引起正文或外层滚动、翻页；显式定位、页内选择、高亮工具和侧栏滚动 SHALL 保持可用。加载、翻页、恢复或重排时 MUST 防止重复导航。

#### Scenario: Inputs and selection

- **WHEN** 在正文及空白处使用滚轮、触控板、横纵滑动、方向键、空格、PageUp/PageDown、Home/End，或拖选至页边
- **THEN** 阅读位置及外层滚动不变，无自动翻页；仍可鼠标/长按选择页内文字和操作高亮，侧栏可独立滚动，按钮获焦时 Enter/Space 可激活，输入控件正常编辑

#### Scenario: PDF Text custom selection handles

- **WHEN** 在 iOS 或 Android WebView 的 PDF Text 长按选字并拖动可见端点
- **THEN** 显示与 PDF Layout 一致的自绘起点/终点手柄，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”；拖动可调整选区并操作高亮 Popover，不出现系统复制/查询/分享菜单，不触发滚动或自动翻页；离屏源端点不在当前列边缘生成替代手柄

#### Scenario: Responsive and busy controls

- **WHEN** 在宽屏、320px 窄屏及横竖屏阅读，底栏展开或工具面板变化，并在加载、翻页或重排时快速连点
- **THEN** 两按钮与底栏不重叠、不遮正文最后一行，正文和高亮叠层位置一致；忙碌时按钮禁用且不跳过内容，完成后边界禁用状态正确

#### Scenario: Explicit navigation

- **WHEN** 用户通过既有目录、页码、书签或高亮入口定位 PDF 原页或文字范围
- **THEN** 原页跳转打开该页首个可视页，文字锚点跳转打开包含该锚点的可视页，不把源页码当作临时可视页序号

### Requirement: PDF layout mobile custom selection handles

系统 MUST 在移动端 PDF Layout 的文字选择工具下，长按可选择文字后显示自绘圆形起止手柄，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”。用户 SHALL 能拖动任一可见手柄扩展或缩短未确认选区，以及调整已选中的高亮范围；交互期间 MUST 不出现系统选择手柄或复制/查询/分享菜单。手柄拖动 MUST 不误触页面平移、缩放、绘图或矩形创建。正常阅读的滚动、双指导航和链接操作 SHALL 保持可用。

#### Scenario: Long press and adjust an unconfirmed selection

- **WHEN** 用户在 iOS 或 Android WebView 的 PDF Layout 长按文字，分别拖动起点和终点，包含跨行选择，再确认高亮
- **THEN** 显示自定义手柄，预览文字与端点随拖动变化，无系统手柄和菜单；确认结果与最终选区一致，只创建一次高亮，不移动阅读位置

#### Scenario: Adjust an existing highlight

- **WHEN** 用户选中已有高亮，拖动可见自定义端点并释放
- **THEN** 高亮范围更新且原 ID、评论关联和颜色保留，只提交一次范围更新，不生成重复高亮

#### Scenario: Geometry and offscreen endpoints

- **WHEN** 用户在 50%、100%、200% 缩放、滚动后以及旋转/裁切页中选择文字并拖动，或选区一端离开安全可见区域
- **THEN** 可见手柄对应真实源文字端点、圆形视觉直径保持一致，离屏端点不在视口边缘生成替代手柄；命中与保存沿用原页字符锚点，重开恢复相同文字范围

#### Scenario: Cancel or invalidate a drag

- **WHEN** 拖动中发生 pointercancel、失焦、第二根手指加入、切工具/模式/文档、页面回收，或释放点无有效文字命中
- **THEN** 不提交本次范围变更；会话仍有效时恢复拖动前选区，会话已替换时清理旧预览和手柄；已保存标注不受影响，无遗留捕获或监听阻挡后续交互

#### Scenario: Empty content and normal navigation

- **WHEN** 用户在无可选择文字的扫描页或正文空白处长按，或未拖动手柄时滚动、双指导航及点击链接
- **THEN** 不生成伪造文字选区，阅读导航继续正常工作，非文字工具不启动文字选择

#### Scenario: Native selection reactivates during a touch session

- **WHEN** PDF Layout 触摸选择、拖动、保持选区或复制期间，浏览器尝试重新激活正文/工具栏的原生 Selection
- **THEN** 原生可见选择被抑制，受管文字/端点保留，复制不向可见正文 addRange；评论编辑器和其他 reader 的原生选择不被清空，真机不存在蓝色系统手柄仍需设备验收

#### Scenario: Grab the larger hit square and release before another frame

- **WHEN** 在 49%、50%、100%、200% PDF 缩放下，从 20px 视觉圆外 9px 的热区角落抓取起点或终点并拖动，在下一 rAF 或父级更新前释放
- **THEN** 40×40 屏幕像素热区触发拖动且不跳变，视觉圆仍为 20px，最终手柄与保存的源端点一致；热区之外不拦截正文指针事件，Text 手柄外观及热区 SHALL 遵循两模式统一手柄契约，其他交互保持不变

### Requirement: PDF selection preview follows toolbar highlight color

系统 MUST 在 PDF Layout 和 PDF Text 使用底部栏当前选中的有效高亮色渲染未高亮选区、高亮母版预览及由其确认的新高亮，包括相同的透明度语义；不得退回系统蓝色或固定默认色。活动选区保持期间换色 SHALL 立即更新预览，保留文字与端点。受控颜色 SHALL 以调用方最新传入且底栏显示选中的值为准；PDF 场景独立 selectionColor 不得覆盖该规则。系统 MUST 保留未操作的历史高亮颜色；调整已有高亮范围 SHALL 保留其保存颜色，只有显式改色才改变保存颜色。

#### Scenario: Preview and confirm in both PDF modes

- **WHEN** 用户在底栏选颜色 A，分别在 Layout 和 Text 长按选字、调整范围，观察未高亮选区与高亮母版预览，再确认
- **THEN** 两种预览及新建高亮均使用颜色 A 及其透明度，手柄可见，不出现独立系统蓝色选区覆盖

#### Scenario: Change color while a draft is active

- **WHEN** 活动未确认选区颜色为 A，用户在底栏改选 B，或受控调用方更新为 B，即使此前传入不同的 selectionColor
- **THEN** 底栏、未高亮选区和高亮母版预览均显示 B，文字和端点不变，确认只创建一个 B 色高亮，不触发颜色回调循环

#### Scenario: Existing highlights keep their own colors

- **WHEN** 底栏颜色从 A 改为 B，用户调整一个原颜色为 C 的历史高亮范围并保存重开
- **THEN** 未操作高亮颜色不变，该历史高亮保存颜色仍为 C、ID 与评论关联不变，新建高亮才使用 B；显式改色继续按原有操作执行

#### Scenario: Text and desktop regression

- **WHEN** 用户在 PDF Text 拖动自定义端点，或在桌面 PDF Layout 使用鼠标选择、调整及确认高亮
- **THEN** 既有选择与保存操作保持可用，Text 不滚动或自动翻页，PDF 两模式预览颜色均遵循底栏规则；桌面 PDF Layout 同样显示统一圆点、白边、阴影、竖线及 40×40 热区，原生 Selection 的鼠标更新与确认流程不变

#### Scenario: Opaque host colors without blending

- **WHEN** 宿主传入不透明高亮色且 WebView 的混色无法生效，用户选择跨多 span 的紧密多行文字并确认高亮
- **THEN** 草稿和已确认高亮使用同一带 alpha 的填充（最大 0.35），文字可读；同行矩形无内部白缝且不越出文字行边界，源锚点与存储格式保持不变

#### Scenario: PDF handle contrast and line placement

- **WHEN** 用户在 PDF Layout 的 50%、100%、200% 缩放下选择文字并拖动起止圆柄
- **THEN** 20px 圆柄有恒定 2px 白边，圆点与竖线有整体阴影；起点圆点在行上缘外、终点在下缘外，命中按行内位置纠偏，PDF Text 圆柄 SHALL 使用同一外观及热区，仍保留 Text 页内选择与禁止滚动/自动翻页契约

## ADDED Requirements

### Requirement: PDF modes share selection handle appearance

系统 MUST 在 PDF Text 与 PDF Layout 的自定义文字选择中显示一致的起止手柄，包括未确认选区与已选中的历史高亮。圆点屏幕外径 SHALL 为 20 CSS px，具有不透明的对应选区/高亮色、2 CSS px 白边，以及覆盖圆点和连接竖线的同一阴影；起点圆点 SHALL 位于文字行上缘外，终点圆点 SHALL 位于文字行下缘外，竖线在圆点后方且白圈完整，连接竖线长度 MUST 分别等于当前端点字符矩形的实际高度，跨行两端不得共用固定值。每端 MUST 提供以圆心居中的 40×40 CSS px 透明热区，视觉与热区均不随内容缩放改变。Text MUST 保留现有源字符端点、可见列判定、可访问名称与放大镜开关，不出现系统手柄或系统菜单；手柄统一 MUST 不改变 EPUB、矩形选择及其他格式的交互。

#### Scenario: Compare draft and saved highlight handles

- **WHEN** 在 iOS 或 Android WebView 中对同一 PDF 文字分别于 Layout 和 Text 创建选区，并选中已有高亮，在相同工具栏颜色及明暗背景下观察两端
- **THEN** 两种模式均呈现相同的圆点尺寸、白边、整体阴影、竖线和起上终下位置；草稿使用当前选择色，已有高亮端点使用该高亮颜色，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”，无原生手柄或复制/查询/分享菜单

#### Scenario: Grab the enlarged Text handle target

- **WHEN** 从 PDF Text 的圆点中心、白边以及圆外 9px 的热区角落分别抓取任一端点，跨行扩展或缩短选区并释放，包括快速拖动在下一动画帧前释放
- **THEN** 热区均能启动拖动，首次抓取不跳选，手指移动对应正确文字端点；放大镜保留原镜片位置与避让，镜内采样和标记使用物理指针；最终预览与确认范围一致，草稿只确认一次，已有高亮只更新一次且保留 ID、颜色和评论关联，热区外不截获正文操作

#### Scenario: Text pagination and geometry remain stable

- **WHEN** 在 320px 窄屏、不同字号、横竖屏或窗口重排后选择多行文字，或源端点位于其他可视列，并将可见手柄拖向页边
- **THEN** 圆点与热区屏幕尺寸稳定，可见手柄对应真实源端点；离屏源端点保持隐藏，不在当前列边缘补柄；正文不滚动或自动翻页，使用按钮翻页后不遗留错误位置手柄，保存并重开仍映射相同源字符

#### Scenario: Restore a single saved highlight after reflow

- **WHEN** PDF Text 的普通单条高亮或分组高亮被选中、保存重开，且源字符顺序与视觉顺序不同或重排插入了展示空白，并切换到大字号
- **THEN** 所有已保存端点在进入 selection runtime 前转换成当前 DOM offset，背景和手柄对应同一组源字符；草稿不重复转换，触摸调整后仍保存 canonical 源范围及原 ID/颜色，分页/书签/高亮导航保留源锚点语义

#### Scenario: End a Text handle session safely

- **WHEN** Text 手柄拖动发生 pointercancel、失焦、模式/工具/文档切换或组件卸载
- **THEN** 本次手势不产生额外的高亮或范围提交，已保存数据不受影响，无遗留手柄、指针监听或放大镜阻挡下一次选择

#### Scenario: Preserve other selection surfaces

- **WHEN** 使用桌面 PDF Text 或 PDF Layout 鼠标调整范围、PDF Layout 现有移动选择，或 EPUB、其他格式及矩形选择
- **THEN** 桌面 PDF 两模式均可操作并共享统一手柄外观与热区，鼠标沿用各自原有选择引擎；Layout 触摸选择保持原行为，EPUB、其他格式及矩形选择的手柄外观与逻辑不受本次变更影响

### Requirement: PDF Text magnifier insertion caret

PDF Text 拖动手柄时，放大镜 MUST 在镜像文字的当前插入位置显示 2 CSS px 竖线，指示将插入到哪两个字符之间。镜片位置 MUST 保留原有布局锚点、18px 间距、上下避让及边缘约束，不将镜心移到指针。鼠标、笔和触摸的镜内采样与标记 SHALL 使用同一物理指针 clientX/clientY，选择层转发的纠偏事件不得覆盖该采样点。标记 MUST 经过与快照内容相同的缩放、偏移和边缘裁剪换算，并按白边内实际画布比例定位；不得直接复用主视图的 fixed/absolute 坐标。选区命中及保存继续使用既有纠偏协议。竖线高度 SHALL 跟随放大后的文字行高，放大镜开关、pointercancel、失焦、模式/文档切换及卸载 MUST 清理标记和监听，且不得同时显示 selection 库的另一份放大镜。

#### Scenario: Sample the physical pointer without moving the lens

- **WHEN** 使用鼠标、笔或触摸从 PDF Text 起/止手柄的中心或热区边缘拖动，选择层同时转发纠偏后的 pointermove，或指针移至视口边缘
- **THEN** 镜片仍在原有避让位置，快照采样与标记对应物理指针；仅源快照边缘裁剪可影响实际采样中心，布局间距不得混入采样偏移；与 PDF 预览镜片对照时，同一有效采样点无额外向上偏移

#### Scenario: Follow the scaled and clamped insertion point

- **WHEN** 用户从 PDF Text 手柄中心或热区角落拖动，命中文字中心、另一行或快照边缘
- **THEN** 插入线与镜像中的实际字符间隙一致，坐标随缩放和裁剪变化，释放或取消后不遗留标记

### Requirement: PDF preview magnifier vertical clearance

PDF Layout 的放大镜采样与标记 MUST 使用物理指针 clientX/clientY，不混入抓取纠偏或选区端点。8 CSS px 的垂直避让 SHALL 仅作为预览镜片元素自身的 CSS transform，不进入采样或共享定位几何计算。抓取纠偏仅用于选区命中和原有布局锚点，保留左右钳制和上下翻转规则；Text 生产代码及其六点布局与采样基线 MUST 不变。源快照边缘沿用既有裁剪规则。

#### Scenario: Compare preview and Text pointer clearance

- **WHEN** 在 Chromium 鼠标回归中，从终点热区圆心外各 9px 抓取，再向下拖动 200/220px，使镜片位于指针上方，预览使用 50% 缩放
- **THEN** Text 镜片底边到指针约 50.52px，预览由 43px 增至 51px，差值小于 1px；Text 原六点的镜片、采样及标记结果不变，预览对照采样没有新增纵向偏移

#### Scenario: Retain preview edge placement

- **WHEN** PDF Layout 的布局锚点靠近左右或上方边缘，鼠标或触摸仍在拖动手柄
- **THEN** 原有布局锚点不加 8px，定位算法仍左右钳制、上方空间不足时翻到下方，之后仅镜片元素作视觉上移；采样和选区坐标不含此视觉位移

#### Scenario: Sample from different preview grab positions

- **WHEN** 鼠标或触摸从预览起止手柄的中心、±9px 角落或 18px 热区边缘抓取并拖动
- **THEN** start/move 和触摸 publish 的采样坐标均等于物理指针，常规快照区域的采样中心相对指针为 `(0,0)`；选择层纠偏转发不得覆盖原始采样点，镜片和内容不接受 pointer 命中

### Requirement: PDF preview handles remain responsive across long drags

PDF 桌面手柄 MUST 通过本 reader 的可见 PDF 字符命中并允许越过另一端点，固定的源锚点保持不变。行间空白、移动手柄覆盖文字或暂时未命中 MUST 不使最后有效范围在释放时回退；pointerup MUST 处理最终坐标，正常完成只提交一次。其他 pointerId 与选择层转发不得打断当前会话，匹配的取消、失焦、替换或丢失捕获仍清理且不提交；不得改变 Text、EPUB 或其他格式契约。

#### Scenario: Repeat real mouse drags through gaps and across the anchor

- **WHEN** 在真实 Chromium 鼠标回归中从首末热区抓取，单步或逐步拖动超过 200px，目标包括文字、行间空白及越过另一端点，重复至少 20 次
- **THEN** 范围跟随并在释放后保持，固定锚点未改变；记录失败次数、pointer capture、pointerId、镜片命中及采样偏移，修复后失败次数为 0，镜片 pointer-events 为 none

### Requirement: PDF selection overlays track scrolling in the same frame

PDF Layout 滚动正文时，页内高亮和自绘手柄 SHALL 与对应文字保持同步，不出现固定手柄比高亮晚一帧的可见错位。实现可以保留 body fixed portal，但滚动捕获和每帧重测 MUST 在绘制前提交最新坐标；不得因此改变正常阅读滚动、拖选事务或其他格式布局。

#### Scenario: Measure a continuous scroll

- **WHEN** 已选中高亮所在的 PDF 页面以每帧固定位移连续滚动，并逐帧比较文字、高亮和手柄位置
- **THEN** 高亮相对文字无新增偏差，手柄相对静止基线的新增错位帧数为 0；端点离屏后的隐藏规则保持有效
