# Spec Delta

## MODIFIED Requirements

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
- **WHEN** 用户将选区或端点拖至可视页边缘，或编辑中通过按钮翻页、目录跳转导致原选区文档失效
- **THEN** 越界不自动翻页或滚动；显式导航先取消未完成编辑，再按新视口恢复已有高亮片段或关闭草稿，不把旧文档回调提交为新范围

#### Scenario: Use the shared interaction after initial touch selection
- **WHEN** 通过鼠标或触摸形成 EPUB 初始选区，再执行 `reader-text-selection-interaction` 的共享手柄验收矩阵
- **THEN** 端点调整完整遵循共享标准，正文与 iframe 坐标换算不增加命中位移；保持本规格的有效范围提交、取消和显式分页规则
