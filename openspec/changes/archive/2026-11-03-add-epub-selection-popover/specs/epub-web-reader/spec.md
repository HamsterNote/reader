# Spec Delta

## ADDED Requirements

### Requirement: EPUB selection Popover matches PDF controls
在文字选择工具、未启用自动高亮时，系统 SHALL 在 EPUB 有效非空文字选区形成后显示与 PDF 默认基线一致的选区 Popover，提供“高亮”和颜色选择；鼠标选择及触摸原生选择均 MUST 可用。Popover MUST 锚定当前可见选区且其按钮在阅读视口内可操作，操作控件不得丢失选区或重复提交。既有自定义选区及高亮 Popover SHALL 继续获得相同语义的当前目标。

#### Scenario: Select and confirm using mouse or touch
- **WHEN** 用户通过鼠标拖选或触摸长按形成有效选区，选择颜色并确认高亮
- **THEN** Popover 显示且可操作，确认前不创建持久标注，确认后只新增一个对应当前端点、规范化文本及所选颜色的高亮，并按既有契约通知宿主；触摸产生的后续 click 不再新增一条

#### Scenario: Position within constrained viewport
- **WHEN** 选区位于 EPUB iframe 的顶部、底部或右侧，阅读窗口为 320 像素窄屏或在非零页面偏移处
- **THEN** Popover 靠近当前可见选区，按钮及颜色控件可见可操作，不因 iframe 局部坐标而显示到视口外

#### Scenario: No valid text or custom content
- **WHEN** 选区折叠、只含无可映射文字的图片、不可定位或已失效，或消费者提供自定义 Popover
- **THEN** 无效选区不显示可提交的文字高亮操作且不写入数据；有效选区使用消费者提供的内容，既有确认接口仍作用于当前选区

### Requirement: EPUB selection switching is isolated from saved highlights
系统 SHALL 将未确认草稿、已有高亮激活态和已有高亮端点编辑区分。新选区替换草稿或从已激活高亮切换到另一选区时，MUST 只操作最新目标，不隐式更新旧高亮；跨段落、跨行内节点、元素边界及反向选择 SHALL 映射为按文档顺序排列的稳定逻辑端点和一致的规范化文本。

#### Scenario: Replace a draft across paragraphs and nodes
- **WHEN** 用户先选 A，再反向选择跨两个段落及 strong、em、span 节点的 B，并确认高亮
- **THEN** Popover 及后续高亮仅对应 B，只有 B 被新增；端点不使用元素子节点下标作为字符偏移，空白折叠及文本拼接服从已有 EPUB 字符契约

#### Scenario: Select new text while a saved highlight is active
- **WHEN** 高亮 H 已激活，用户在其他文字重新选出不同范围并改变草稿颜色
- **THEN** 活动目标转为新草稿，H 的端点、文本和样式保持原值；确认仅新增新范围，取消草稿不改变 H

### Requirement: EPUB saved highlight activation targets one annotation
系统 SHALL 允许点击 EPUB 已有高亮的可见文字片段激活该高亮，并显示对应的高亮 Popover、已有颜色及可见端点操作。切换高亮 MUST 更新唯一活动 ID；激活本身不得新增或更新持久范围，改色 MUST 仅更新目标高亮并保留其余样式字段及标识。

#### Scenario: Switch between existing highlights
- **WHEN** 用户点击 H1，再点击 H2 的可见片段并改色
- **THEN** Popover 的删除、改色及范围操作均指向 H2，H1 不变，H2 的 ID、创建时间、端点、文本及评论关联不变；既有全局颜色偏好同步规则继续适用

#### Scenario: Activate a visible fragment of a historic range
- **WHEN** 历史高亮跨越两个逻辑页或章节，用户点击当前可见的其中一个片段
- **THEN** 激活完整高亮的原 ID，Popover 不把可见片段另存为新高亮，不丢弃不可见端点

### Requirement: EPUB range editing commits consistent endpoints and text
系统 SHALL 使用既有鼠标端点手柄及触摸原生选择交互对活动范围扩展或缩小，支持当前章节可选正文内跨段落、跨节点编辑。草稿调整 MUST 仅更新草稿；已有高亮有效编辑完成后 MUST 按原 ID 提交端点和对应规范化文本的一次完整更新，保留 createdAt、样式、评论关联及未编辑端点。空范围、端点交叉导致的无效范围或无法映射的编辑 MUST 不提交且恢复最后有效范围。中途取消 MUST 不保留部分更新。

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
- **WHEN** 用户将选区或端点拖至可视页边缘，或编辑中通过按钮翻页、目录跳转导致原选区文档失效
- **THEN** 越界不自动翻页或滚动；显式导航先取消未完成编辑，再按新视口恢复已有高亮片段或关闭草稿，不把旧文档回调提交为新范围

### Requirement: EPUB deletion clears only the targeted highlight
用户通过高亮 Popover 删除时，系统 MUST 按当前活动 ID 删除对应高亮，清除其所有可见片段、选区、手柄及 Popover，并按既有删除契约通知宿主。删除 MUST 不影响其他高亮；受控模式遵循宿主回传的数据，未受控模式更新内部数据，均不得在没有新激活目标时继续向被删 ID 写入。

#### Scenario: Delete after activation or editing
- **WHEN** 用户点击高亮或完成其范围编辑后点击“删除”，宿主接受并回传删除结果
- **THEN** 对应 ID 从权威数据及所有显示片段移除，活动态关闭，其他标注及评论数据遵循既有删除关联策略，不产生无关删除或悬空活动目标

#### Scenario: Delayed event after deletion
- **WHEN** 删除被接受后，先前颜色选择、选区或范围编辑的延迟事件到达
- **THEN** 事件不重建或更新已删除高亮，切章返回及重新打开均不使其复活

### Requirement: EPUB Popover operations preserve annotation compatibility
Popover 操作 MUST 沿用公开逻辑页 ID、字符端点和既有非绘图范围数据、回调、存储及历史契约，不输出 iframe 节点标识、引擎 CFI 或临时可视页号作为持久端点。重排仅重算显示几何；定位失败 MUST 保留原数据并沿用不可定位状态，不允许将其静默绑定到相似文字。已支持的新增、更新及删除撤销重做行为 SHALL 保持一致。

#### Scenario: Round trip through reflow and history
- **WHEN** 用户依次新增、改色、改范围、删除高亮，对既有支持的操作撤销重做，并在保存后重新打开或调整字体、窗口
- **THEN** 每个历史状态与相应权威快照一致，同一高亮的标识及关联不漂移，端点和文本可恢复，重排不触发持久范围修改

#### Scenario: Ambiguous or stale mapping
- **WHEN** 章节兼容映射降级、重复段落无法唯一定位，或切换书籍后旧异步操作返回
- **THEN** 保留不可定位历史高亮原数据，拒绝错误范围写入，旧书籍操作不修改当前书籍
