# Spec Delta

## MODIFIED Requirements

### Requirement: EPUB bottom-right pagination controls
系统 SHALL 在 EPUB 提供底部右下角右对齐的上一页/下一页按钮组，组内只有左右两个按键，使用可访问名称“上一页”“下一页”，沿用现有底栏主题、控件风格及底部对齐基准。该按钮交互 SHALL 同时适用于 PDF Text，且不得因此在 PDF Layout 或其他格式新增此组控件或正文滚动限制。系统 MUST 为底栏及按钮占用空间预留正文区域，窄屏及绘图工具展开时也不得遮挡正文或重叠控件。加载、翻页或重新分页期间 SHALL 防止重复导航。

#### Scenario: Responsive toolbar clearance
- **WHEN** 在宽屏、320 像素窄屏和横竖屏布局阅读 EPUB，并展开现有绘图工具栏
- **THEN** 两个按钮在底部右侧可见、可点击并与现有底栏底部基准一致，正文最后一行及图片在内容区域内可见，控件之间不重叠

#### Scenario: Busy and accessible controls
- **WHEN** EPUB 尚未就绪、翻页或重排处理中，或用户用键盘聚焦按钮
- **THEN** 忙碌时不重复发起导航；就绪后按钮有正确名称、焦点提示及边界禁用状态，键盘激活与点击效果一致

#### Scenario: Format isolation
- **WHEN** 用户依次打开 EPUB、PDF Text、PDF Layout 和 TXT
- **THEN** EPUB 与 PDF Text 显示各自正确状态的双按钮，PDF Layout 和 TXT 不新增该按钮或正文滚动限制；EPUB 的章节、固定版式、锚点与标注行为保持原契约
