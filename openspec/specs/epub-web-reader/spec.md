# epub-web-reader Specification

## Purpose

使 EPUB 在 Web 阅读层中保留文档自身排版、目录与图片，并在内容重排和跨端恢复时维持 reader 既有高亮、操作界面及历史数据的可用性，避免更换阅读引擎导致定位丢失。

## Requirements

### Requirement: EPUB content and navigation
系统 SHALL 在 Web 阅读层展示 EPUB 的章节、样式、封面及图片，支持目录导航、既有适用阅读模式和字体调整，并保留 reader 的工具栏及交互 UI。EPUB 正文 MUST 按渲染后的可用视口宽度和高度重排为单个可视页，通过上一页/下一页按钮逐页阅读；旧逻辑页号和章节号不得作为可视分页单位。

#### Scenario: Open and navigate a publication
- **WHEN** 用户打开含封面、多章节、图片和目录的有效 EPUB 并跳转章节
- **THEN** 显示正确内容顺序和目标章节所在可视页，字体调整后内容可读且包含原阅读锚点

#### Scenario: Turn within a long chapter
- **WHEN** 当前章节正文超过两个可视区域，用户在其非末页点击下一页再点击上一页
- **THEN** 每次只移动一个可视页，下一页继续显示同章后续内容，上一页返回原可视页，不跳过正文

#### Scenario: Cross chapter and book boundaries
- **WHEN** 用户在章节末页点击下一页，或在下一章节首页点击上一页
- **THEN** 分别进入相邻可读章节的首页或末页；全书首页的上一页和末页的下一页禁用，重复操作不循环、不越界、不出现空白尾页

#### Scenario: Fixed layout publication
- **WHEN** 用户打开既有支持的固定版式 EPUB
- **THEN** 每次显示一张适配可用区域的原始页面并由按钮切换相邻页，不强制重排固定版式文字或裁掉正文

### Requirement: EPUB annotations survive reflow
系统 MUST 使用兼容的逻辑页与字符位置恢复和保存高亮；分页、字体和窗口变化 SHALL 仅改变显示几何，不改变持久化端点、标注 ID 或评论关联。

#### Scenario: Restore legacy annotations and resize
- **WHEN** 同一 EPUB 导入历史高亮并调整字体或横竖屏
- **THEN** 高亮仍对应原文，点击、调整、删除及跳转保持已有交互，保存后原标识及格式不变

#### Scenario: Ambiguous historic position
- **WHEN** 某历史位置不能唯一还原
- **THEN** 保留原数据并呈现可识别的不可定位状态，不把标注绑定到另一个相似段落

### Requirement: EPUB failure does not corrupt data
系统 SHALL 对损坏或不支持的文件给出错误和重试入口，切换文档后不显示上一个文档的异步结果。

#### Scenario: Replace a loading book
- **WHEN** EPUB A 加载中用户打开 EPUB B，A 随后返回结果或错误
- **THEN** 仅 B 可更新当前阅读界面及持久化状态

### Requirement: EPUB button-only sequential navigation
系统 MUST 禁止 EPUB 正文的滚轮、触控板、触摸滑动及键盘滚动，不得用它们或选区越界触发翻页、切章或外层阅读容器滚动。顺序阅读 SHALL 仅由两个翻页按钮触发；目录、书签、高亮定位和进度恢复 SHALL 保持可用，目标显示在其所在可视页。正文选择、已有工具操作和侧栏自身滚动 SHALL 保持可用。

#### Scenario: Scroll and gesture inputs
- **WHEN** 用户在正文或其空白区域使用滚轮、触控板、单指横纵滑动，或正文获焦时使用方向键、空格、PageUp/PageDown、Home/End
- **THEN** 当前正文、章节、可视页及外层阅读位置保持不变，不触发自动翻页；按钮获焦时仍可用 Enter/Space 正常激活按钮

#### Scenario: Selection and explicit navigation
- **WHEN** 用户在页边选字或使用高亮工具，然后通过目录、书签或高亮跳转
- **THEN** 选区越界不自动翻页，页内工具仍可用，显式跳转能打开目标所在可视页，侧栏滚动不翻动正文

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

### Requirement: EPUB pagination progress and reflow
系统 MUST 在每次成功翻页后沿用既有进度契约保存稳定逻辑页及字符偏移，不把临时可视页号或引擎专有 CFI 写入公开持久化数据。重新打开、窗口尺寸变化、横竖屏、字体变化或底栏占用变化后 SHALL 重新计算可视页并显示包含原锚点的页面；重排和恢复过程中不得用临时首屏覆盖原进度。无文字封面或图片页 SHALL 使用既有逻辑页回退定位。

#### Scenario: Persist movement within one chapter
- **WHEN** 用户在同一长章节连续点击下一页两次后关闭并重新打开同一 EPUB
- **THEN** 保存的字符偏移随实际阅读位置前进，重新打开显示包含最后成功翻页锚点的可视页，而非章节首页

#### Scenario: Resize and change font
- **WHEN** 用户在长章节中途调整窗口、旋转设备、改变字号或展开底栏
- **THEN** 依新可用尺寸重新分页，原锚点仍在当前可视页内，继续翻页使用新边界，恢复及重排的临时事件不覆盖既有进度

#### Scenario: Image-only position
- **WHEN** 用户翻至封面或无文字图片页并重新打开
- **THEN** 依既有逻辑页定位回该页，不生成虚构字符偏移或另存引擎标识
