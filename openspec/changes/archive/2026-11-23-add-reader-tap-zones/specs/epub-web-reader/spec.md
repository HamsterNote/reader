# Spec Delta

## MODIFIED Requirements

### Requirement: EPUB content and navigation
系统 SHALL 在 Web 阅读层展示 EPUB 的章节、样式、封面及图片，支持目录导航、既有适用阅读模式和字体调整，并保留 reader 的工具栏及交互 UI。EPUB 正文 MUST 按渲染后的可用视口宽度和高度重排为单个可视页，通过正文分区点击和符合门槛的横向滑动逐页阅读；旧逻辑页号和章节号不得作为可视分页单位。

#### Scenario: Open and navigate a publication
- **WHEN** 用户打开含封面、多章节、图片和目录的有效 EPUB 并跳转章节
- **THEN** 显示正确内容顺序和目标章节所在可视页，字体调整后内容可读且包含原阅读锚点

#### Scenario: Turn within a long chapter
- **WHEN** 当前章节正文超过两个可视区域，用户在其非末页通过正文操作前进一步再返回一步
- **THEN** 每次只移动一个可视页，下一页继续显示同章后续内容，上一页返回原可视页，不跳过正文

#### Scenario: Cross chapter and book boundaries
- **WHEN** 用户在章节末页向前翻页，或在下一章节首页向后翻页
- **THEN** 分别进入相邻可读章节的首页或末页；全书首页或末页向外操作保持原位置，不循环、不越界、不出现空白尾页

#### Scenario: Fixed layout publication
- **WHEN** 用户打开既有支持的固定版式 EPUB
- **THEN** 每次显示一张适配可用区域的原始页面并通过正文操作切换相邻页，不强制重排固定版式文字或裁掉正文

### Requirement: EPUB explicit sequential navigation
系统 MUST 禁止 EPUB 分页正文的滚轮、触控板传统滚动和键盘滚动，不得用它们、未达门槛的滑动或选区越界触发翻页、切章或外层阅读容器滚动。顺序翻页 SHALL 由符合规则的正文分区点击或横滑触发。目录、书签、高亮定位和进度恢复 SHALL 保持可用，目标显示在其所在可视页。正文选择、已有工具操作和侧栏自身滚动 SHALL 保持可用。

#### Scenario: Scroll and gesture inputs
- **WHEN** 用户在正文或其空白区域使用滚轮、触控板、未达门槛的单指横纵滑动，或正文获焦时使用方向键、空格、PageUp/PageDown、Home/End
- **THEN** 当前正文、章节、可视页及外层阅读位置保持不变，不触发自动翻页

#### Scenario: Selection and explicit navigation
- **WHEN** 用户在页边选字或使用高亮工具，然后通过目录、书签或高亮跳转
- **THEN** 选区越界不自动翻页，页内工具仍可用，显式跳转能打开目标所在可视页，侧栏滚动不翻动正文

### Requirement: EPUB pagination progress and reflow
系统 MUST 在每次成功翻页后沿用既有进度契约保存稳定逻辑页及当前可视页首行首个可见源字符偏移，不把临时可视页号或引擎专有 CFI 写入公开持久化数据。重新打开、窗口尺寸变化、横竖屏或字体变化后 SHALL 重新计算可视页并显示包含原锚点的页面；相同排版 SHALL 恢复同一可视页，重排和恢复过程中不得用临时首屏覆盖原进度。文字判定 MUST 以当前可视页实际可见内容为准，不能以整章是否有字替代。视口无可定位文字的封面、图片或空白区域 SHALL 保存既有逻辑页及视口顶端在该显示页内的纵向百分比，重开后显示包含其投影位置的可视页；历史仅有逻辑页时 SHALL 按比例 0 恢复。固定版式无内部滚动单页 SHALL 恢复同一页，系统不得为精确对齐增加正文滚动或改变可视页导航契约。

#### Scenario: Persist movement within one chapter
- **WHEN** 用户在同一长章节连续向前翻两页后关闭并重新打开同一 EPUB
- **THEN** 保存的字符偏移随实际阅读位置前进，重新打开显示包含最后成功翻页首行源字符的可视页，而非章节首页；同排版回到原可视页

#### Scenario: Resize and change font
- **WHEN** 用户在长章节中途调整窗口、旋转设备、或改变字号
- **THEN** 依新可用尺寸重新分页，原锚点仍在当前可视页内，继续翻页使用新边界，恢复及重排的临时事件不覆盖既有进度

#### Scenario: Image-only position
- **WHEN** 用户翻至封面或无文字图片页并重新打开
- **THEN** 按逻辑页及已存页内比例投影到对应可视页，不生成虚构字符偏移或另存引擎标识；旧记录无比例时仍定位该逻辑页起始位置

#### Scenario: Image viewport inside a text chapter
- **WHEN** 同一章包含文字与多屏图片，当前可视页仅显示图片并完成保存重开
- **THEN** 使用当前逻辑页和非零页内比例恢复原图片位置，不因章节其他位置有文字而保存章节首字

### Requirement: EPUB range editing commits consistent endpoints and text
系统 SHALL 对活动范围使用遵循 `reader-text-selection-interaction` 的受管文字端点手柄扩展或缩小，支持当前章节可选正文内跨段落、跨节点编辑。PDF 预览、EPUB、PDF 纯文字三者 MUST 共用该规格的同一份交互描述与全部验收场景；触摸原生选择仍可用于初始选区形成，随后端点调整由受管手柄承担，不得同时出现另一套原生端点拖动或放大镜反馈。草稿调整 MUST 仅更新草稿；已有高亮有效编辑完成后 MUST 按原 ID 提交端点和对应规范化文本的一次完整更新，保留 createdAt、样式、评论关联及未编辑端点。空范围、端点交叉导致的无效范围或无法映射的编辑 MUST 不提交且恢复最后有效范围。中途取消 MUST 不保留部分更新。

#### Scenario: Expand and shrink a saved range
- **WHEN** 用户将高亮终点扩展至下一段并结束，再将起点缩回同段
- **THEN** 每次完成各更新原高亮一次，文本与新端点一致，无重复高亮、残留旧片段或无关高亮更新；取消其中一次编辑时保留该次编辑前的数据

#### Scenario: Edit a historic range with an offscreen endpoint
- **WHEN** 用户调整历史跨章高亮的当前可见终点，起点在未显示章节
- **THEN** 起点保持原值，按既有跨逻辑页文本契约重算文本，保存及重新打开后仍是同一完整高亮，不截断为当前章节片段

#### Scenario: Reject invalid or cancelled edit
- **WHEN** 拖动端点越过另一端形成无效范围、落在不可映射内容、触发 pointercancel 或编辑中失焦
- **THEN** 不产生更新回调或历史记录，恢复编辑前有效端点、文本及显示；后续改色、删除仍作用于原高亮

#### Scenario: Respect explicit pagination
- **WHEN** 用户将选区或端点拖至可视页边缘，或编辑中通过正文翻页、目录跳转导致原选区文档失效
- **THEN** 越界不自动翻页或滚动；显式导航先取消未完成编辑，再按新视口恢复已有高亮片段或关闭草稿，不把旧文档回调提交为新范围

#### Scenario: Use the shared interaction after initial touch selection
- **WHEN** 通过鼠标或触摸形成 EPUB 初始选区，再执行 `reader-text-selection-interaction` 的共享手柄验收矩阵
- **THEN** 端点调整完整遵循共享标准，正文与 iframe 坐标换算不增加命中位移；保持本规格的有效范围提交、取消和显式分页规则

## RENAMED Requirements

- FROM: `### Requirement: EPUB button-only sequential navigation`
- TO: `### Requirement: EPUB explicit sequential navigation`

## REMOVED Requirements

### Requirement: EPUB bottom-right pagination controls
**Reason**: 分页导航由正文分区点击和滑动触发，释放底部按钮占位。
**Migration**: 使用正文中段左右区域或横向滑动翻相邻页。目录、书签、高亮导航以及恢复入口继续可用，加载和重排期间沿用重复导航保护。

## ADDED Requirements

### Requirement: EPUB paginated reading tap and swipe zones
EPUB 分页 MUST 移除底部翻页按钮。连续滚动模式保持现有输入范围。

系统 MUST 以所属栏真实正文视口与可见裁剪范围的交集为基础，从有效阅读区域排除当前标题栏和底栏的覆盖带、侧栏及分栏分隔线。指针按下时记录该栏有效阅读区坐标与尺寸，分屏各栏独立。手势只能作用于起始栏，释放落到该区域外、取消、多指、非主键或已消费的手势不触发分区动作。

栏位隐藏时，单击上区（y < 1/4）、下区（y ≥ 3/4）或中区的中间三分之一（1/3 ≤ x < 2/3）SHALL 展开标题栏和底栏。中区为 1/4 ≤ y < 3/4，其中 x < 1/3 翻上一可视页，x ≥ 2/3 翻下一可视页。x、y 为正文区归一化坐标。

滑动在释放时按起止位移决定。|dx| > |dy| 且 |dx| ≥ 有效宽度的 1/3 时，左滑 SHALL 翻下一可视页，右滑 SHALL 翻上一可视页。|dy| > |dx| 且 |dy| ≥ 有效高度的 1/3 时，上滑和下滑均 SHALL 切换栏位。等轴拖动、未达对应门槛的拖动及尾随 click 不触发分区动作。一次指针序列最多产生一次正文动作。

栏位展开时，正文内任意一次点击或达门槛滑动 MUST 只收起两处栏位，拦截正文链接、标注、控件和翻页。栏位自身的控件及其弹层保持可操作，未达门槛的拖动保持展开。栏位隐藏时，正文控件使用自身行为。链接与高亮同坐标时 MUST 只处理链接，独立高亮只打开对应菜单，两者均不触发分区动作。始于链接、高亮、控件及其子节点的拖动，或者被选择、标注编辑、绘制等交互接管的拖动，MUST 不触发位置导航或栏位切换，也不得被分区逻辑合成为激活动作。

标题栏（宿主提供时）与底栏 SHALL 悬浮覆盖正文，同步显隐。显隐前后 MUST 保持正文尺寸、位置、排版、分页和稳定阅读位置。新文档会话默认隐藏。成功翻页和显式定位保持显隐，切换活动栏保留各栏状态，公共标题栏跟随活动栏。切换渲染模式时重置分区显隐，进入适用模式时始终隐藏。翻页 MUST 沿用当前可视页语义，加载、恢复、重排、导航进行中或到达对应首尾边界时，不得重复发起导航或越界。

#### Scenario: Tap and swipe thresholds
- **WHEN** 栏位隐藏时，点击中段左、中、右三区或上下区，或沿任一轴拖动至 1/3 门槛两侧及门槛本身
- **THEN** 每次仅执行规定的相邻翻页、显隐切换或保持原状。双栏使用本栏实际尺寸，门槛等值触发

#### Scenario: Dismiss floating chrome over the same text
- **WHEN** 栏位展开后，在正文的导航区、链接或高亮位置点击，或从正文发起达门槛横向或竖向滑动
- **THEN** 只关闭栏位，正文、页码和同一文字的位置保持，无链接跳转或高亮菜单。栏位控件本身仍可执行已有动作

#### Scenario: Preserve interactive targets while chrome is hidden
- **WHEN** 点击链接和已保存高亮的重叠区域、单独的高亮或正文控件，或者从其中一个交互目标起手拖动过门槛
- **THEN** 点击只触发对应的既有动作，链接优先于重叠高亮，拖动不触发分区翻页或显隐

#### Scenario: Preserve independent pane state
- **WHEN** 两栏分别处于显示、隐藏状态，切换活动栏，再更换其中一栏的文档
- **THEN** 切栏后两栏状态独立，公共标题栏匹配活动栏，新文档栏位重新初始化为隐藏

### Requirement: EPUB section page indicator
EPUB 分页正文右下角 SHALL 显示灰色 `当前/总数`，两处栏位显隐时始终可见。可重排章节的分子 MUST 为当前稳定可视页在所在章节内的 1 起始序号，分母 MUST 为该章节以当前本栏稳定正文尺寸与字号重排后的实际可视页数，排除引擎前后占位页。章节变化后使用目标章及其页序。进入下一章首页显示 `1/目标章总数`，反向进入上一章末页显示 `上一章总数/上一章总数`。独立封面及每个固定版式单页以独立一页计，显示 `1/1`。无稳定位置或计数时省略页码。单纯显隐不改变数字。

#### Scenario: Count the current section and update after reflow
- **WHEN** 同章从第一个可视页向前一页，再跨章，并在目标章改变字号或正文视口宽度
- **THEN** 同章页序递增且分母不变，换章后从 1 开始且分母匹配目标章。真实重排后页序和总数与包含原锚点的稳定可视页一致

#### Scenario: Preserve the indicator with floating chrome
- **WHEN** 在章节中间、独立封面或固定版式单页显示和收起栏位
- **THEN** 灰色页码始终可见，显隐不改变数字，独立封面和固定版式为 `1/1`
