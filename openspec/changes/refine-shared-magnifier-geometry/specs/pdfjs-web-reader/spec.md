# Spec Delta

## MODIFIED Requirements

### Requirement: PDF modes share selection handle appearance

系统 MUST 在 PDF Text 与 PDF Layout 的自定义文字选择中显示一致的起止手柄，包括未确认选区与已选中的历史高亮。圆点屏幕外径 SHALL 为 20 CSS px，具有不透明的对应选区/高亮色、2 CSS px 白边，以及覆盖圆点和连接竖线的同一阴影；起点圆点 SHALL 位于文字行上缘外，终点圆点 SHALL 位于文字行下缘外，竖线在圆点后方且白圈完整，连接竖线长度 MUST 分别等于当前端点字符矩形的实际高度，跨行两端不得共用固定值。每端 MUST 提供以圆心居中的 40×40 CSS px 透明热区，视觉与热区均不随内容缩放改变。Text MUST 保留现有源字符端点、可见列判定、可访问名称与放大镜开关，不出现系统手柄或系统菜单；手柄统一 MUST 不改变 EPUB、矩形选择及其他格式的交互。

#### Scenario: Compare draft and saved highlight handles

- **WHEN** 在 iOS 或 Android WebView 中对同一 PDF 文字分别于 Layout 和 Text 创建选区，并选中已有高亮，在相同工具栏颜色及明暗背景下观察两端
- **THEN** 两种模式均呈现相同的圆点尺寸、白边、整体阴影、竖线和起上终下位置；草稿使用当前选择色，已有高亮端点使用该高亮颜色，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”，无原生手柄或复制/查询/分享菜单

#### Scenario: Grab the enlarged Text handle target

- **WHEN** 从 PDF Text 的圆点中心、白边以及圆外 9px 的热区角落分别抓取任一端点，跨行扩展或缩短选区并释放，包括快速拖动在下一动画帧前释放
- **THEN** 热区均能启动拖动，首次抓取不跳选，手指移动对应正确文字端点；文字放大镜按 `reader-text-selection-interaction` 的共享尺寸、倍率及安全区放置规则显示，镜内采样和标记使用物理指针；最终预览与确认范围一致，草稿只确认一次，已有高亮只更新一次且保留 ID、颜色和评论关联，热区外不截获正文操作

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

PDF Text 文字手柄拖动的镜片及插入竖线 MUST 遵循 `reader-text-selection-interaction`，与 PDF 预览 / EPUB 共用同一份尺寸、倍率、中心距、safe area 放置和仅触摸显示规则，MUST NOT 继续使用独立布局锚点、旧间距或纠偏命中协议覆盖共享规范。镜内 MUST 在当前有效字符间隙显示 2 CSS px 竖线，高度随放大后的文字行高变化，颜色及离散跳变遵循共享规范。镜内取景 SHALL 使用当前物理触点 clientX/clientY，经必要坐标换算后采样；镜片显示避让不得混入取景或真实文字命中。标记 MUST 经过与文字取景相同的缩放、偏移和裁剪换算，不得直接复用主视图的 fixed/absolute 坐标。放大镜开关、pointercancel、失焦、模式/文档切换及卸载 MUST 清理标记和监听，且不得同时显示 selection 库的另一份放大镜。

#### Scenario: Sample the physical pointer without moving the lens
- **WHEN** 使用触摸从 PDF Text 起/止手柄的中心或热区边缘拖动，选择层同时转发其他坐标事件，或触点移至视口边缘
- **THEN** 镜片依共享安全区规则显示，文字取景与标记对应真实物理触点，不被转发的纠偏坐标覆盖，显示间距不混入采样；mouse/pen 仍可调整端点，但不显示镜片

#### Scenario: Follow the scaled and clamped insertion point
- **WHEN** 用户触摸从 PDF Text 手柄中心或热区角落拖动，命中文字中心、另一行或取景边缘
- **THEN** 插入线与镜像中的实际字符间隙一致，坐标随共享倍率和裁剪变化，释放或取消后不遗留标记

### Requirement: PDF preview magnifier vertical clearance

PDF Layout 文字放大镜的最终显示位置、尺寸与倍率 MUST 完整遵循 `reader-text-selection-interaction`，与 EPUB / PDF Text 共用同一交互描述，MUST NOT 叠加预览专属垂直平移或要求 PDF Text 保持旧镜片布局基线。取景及标记 MUST 使用当前物理触点 clientX/clientY，经必要坐标换算后采样，不混入抓取纠偏、选区端点或显示避让。镜片及内容 MUST 不接受 pointer 命中。矩形快照工具继续沿用其既有契约，不因文字镜片统一而改变。

#### Scenario: Compare preview and Text pointer clearance
- **WHEN** 在共享矩阵的标准视口下，分别触摸拖动 PDF Layout 与 PDF Text 的起止手柄，包含不同抓取位置和 PDF 内容缩放，镜片未受边缘夹取
- **THEN** 最终外框半径、中心距、靠触点间隙和实际文字倍率均满足共享规范，无 PDF 预览专属平移，放置变化不改变源文字采样

#### Scenario: Retain preview edge placement
- **WHEN** PDF Layout 的触点靠近左右边缘或安全区上边界，并继续触摸拖动手柄
- **THEN** 镜片按共享安全区规则横向夹取或上下翻转，实际外框不因额外 transform 越过安全边界；mouse/pen 调整端点时不显示镜片

#### Scenario: Sample from different preview grab positions
- **WHEN** 触摸从预览起止手柄的中心、±9px 角落或 18px 热区边缘抓取并拖动
- **THEN** start/move 和触摸 publish 的采样坐标均等于物理触点，正常文字取景以该触点为中心；选择层纠偏转发不得覆盖原始采样点，镜片和内容不接受 pointer 命中
