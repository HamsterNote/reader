# Spec Delta

## ADDED Requirements

### Requirement: PDF page browser previews
系统 SHALL 在 PDF 页面浏览中显示各允许页面对应的缩略图和正确宽高比，包括尚未在正文中访问的页。加载占位 SHALL 在成功后替换为真实预览，失败 SHALL 显示可识别错误和重试入口；页面浏览不得要求整本预渲染完成后才能使用正文。切书后旧预览 MUST 不混入新文档。

#### Scenario: Open and browse previews
- **WHEN** 用户打开多页 PDF 的页面浏览侧栏，向下滚动到正文尚未访问的页，再关闭重开侧栏
- **THEN** 可见缩略图加载后显示对应源页内容，尺寸比例正确，不持续停留为细骨架或空白占位，正文仍可阅读

#### Scenario: Navigate using a preview
- **WHEN** 用户点击第 N 页缩略图，包括隐藏页和页范围过滤启用时
- **THEN** 正文进入对应允许的原 PDF 页，页码和选中状态一致，隐藏页及范围外页不成为可导航项

#### Scenario: Preview failure and document replacement
- **WHEN** 某页预览失败后用户重试，或文档 A 预览未完成时打开 B
- **THEN** 失败有明确提示且不妨碍其他预览和正文，重试成功显示正确图片；B 不出现 A 的内容或错误

### Requirement: PDF precise highlight and bookmark navigation
系统 SHALL 使高亮列表及现有高亮跳转入口定位到该高亮的原页文字范围，使范围起点出现在安全正文视口内；文字模式 SHALL 打开包含该源字符的可视页。新增精确书签 MUST 记录操作时安全视口内首行源文字位置，仅无可定位文字时记录当前原页内实际纵向比例。点击书签 SHALL 恢复对应文字位置或比例，不得只更新页号或固定回页首。历史纯页书签 SHALL 继续定位对应原页首部，同一定位点不重复添加。

#### Scenario: Navigate to highlights on loaded and unloaded pages
- **WHEN** 用户点击当前长页下半部、尚未加载页、已回收页或跨页高亮的列表条目，包含同页重复文字的样本
- **THEN** 加载完成后定位该高亮起始源字符所在位置，范围起点可见且不被控件遮挡；Text 中显示包含该起点的可视页，不误跳到相同文字的其他位置

#### Scenario: Add and restore text bookmarks
- **WHEN** 用户在长页中部添加书签，重复添加同一位置，离开后点击该书签，并保存重开
- **THEN** 只保留一个同定位点书签，条目与实际首行一致，点击和重开恢复到该原页文字位置；在 Text 中打开包含该字符的可视页，既有标注与评论关联不变

#### Scenario: Add and restore a no-text position
- **WHEN** 用户在扫描页或仅图片/空白的安全视口中部添加书签，离开后点击
- **THEN** 恢复到该原页的对应纵向比例，不固定回 0%；没有文字层也能完成导航，历史纯页书签仍可用

#### Scenario: Missing and excluded targets
- **WHEN** 历史定位点无法映射，或目标页被隐藏/位于允许范围之外
- **THEN** 显示可识别的无法定位状态或禁用该跳转，保留现有位置和原数据，不静默跳到错误页面或同文其他位置

### Requirement: PDF safe reading viewport
系统 MUST 以扣除 SafeArea、实际可见控件占用和调用方边距后的正文可见区域捕获与恢复位置，已由宿主让出的区域不得重复扣减，并保留正文与控件间安全距离。首行 SHALL 是与该安全区域相交的最靠上可定位文字行，同高沿用既有阅读顺序；跨源页视口亦如此，不得使用屏外、被裁切、被控件遮挡的文字或整页第一段代替。恢复 Layout 文字目标 SHALL 对齐安全正文视口顶部，受文档滚动边界限制时使用最近可达位置并保证目标可见。

#### Scenario: Safe area and changing controls
- **WHEN** 在具有顶部/底部安全区的移动视口切换模式、点击书签/高亮，再改变横竖屏、底栏展开状态或窗口大小
- **THEN** 目标文字出现在实际可读正文区域，顶部目标不被安全区/工具栏遮挡，正文与底部控件之间保留间距，不因重复扣减形成额外整块留白

#### Scenario: A clipped line or two visible source pages
- **WHEN** 视口顶部行部分可见，或同时显示前一页末部和后一页顶部，而页码指示与最靠上文字所属页不一致
- **THEN** 使用安全视口首个可见行片段的源字符及所属原页定位，不使用离屏 span 起点或仅按页码指示选择

#### Scenario: End-of-document clamping
- **WHEN** 目标文字靠近文档末尾，剩余内容不足以让该行贴到安全视口顶部
- **THEN** 停在最近可达滚动位置且目标文字可见，不越界或跳到其他字符，不为贴顶增加整屏空白尾页

## MODIFIED Requirements

### Requirement: PDF text stable progress and compatibility
系统 MUST 在成功翻页后使用既有 PDF 原页号及字符锚点保存 Text 进度，同一原页内移动也 SHALL 更新字符位置；临时可视页号或排版标识不得写入公开持久化数据。重开、字号/窗口/横竖屏/底栏变化后 SHALL 显示包含最后稳定锚点的可视页；中间首屏或失败导航 MUST 不覆盖有效进度。Text/Layout 切换 SHALL 沿用既有原页和字符定位契约，并优先使用切换来源模式当前安全视口内首行文字；Layout → Text SHALL 打开包含该源字符的可视页，Text → Layout SHALL 将 Text 实际首行对应源文字对齐安全视口顶部，受边界限制时保持目标可见。仅来源安全视口没有可定位文字时 SHALL 按同一原页内纵向比例回退，保留比例以便返回，不能用目标模式的陈旧进度或固定页首替代。文字层尚未就绪 MUST 不被误判为无文字。历史高亮及其 ID、端点、样式和评论关联 MUST 保持不变；旧进度记录缺少比例时继续可读，不得改变原页号语义。

#### Scenario: Resume and reflow within source page
- **WHEN** 用户在同一原页翻两页后关闭重开，再改字号、窗口大小或底栏占用
- **THEN** Text 进度字符位置已前进，重开及重排后的当前可视页包含最后稳定锚点；零尺寸及连续重排期间旧进度不被临时首屏覆盖

#### Scenario: Mode switch and historic annotation
- **WHEN** 从 PDF Text 中途切到 Layout 再返回，加载历史 v2/v3/v4 高亮并操作含连字、展示空白或重复文本的选区，保存后重开
- **THEN** 按本次来源模式当前安全首行的原页/字符契约恢复，不被目标模式旧进度覆盖；选区仍映射原文字，输出为既有 v4 格式且 ID、端点及评论关联不变，不使用展示补空格偏移替换源偏移

#### Scenario: Layout to text uses the visible first line
- **WHEN** 用户在 PDF 页中部或后部，安全视口首行是源字符 A，切换到 Text，目标模式此前停在其他位置
- **THEN** Text 显示包含 A 的可视页及正确原页，不跳到原页首屏或目标模式旧位置；不要求 A 在该文字可视页恰好成为首行

#### Scenario: Text to layout aligns its own current first line
- **WHEN** Text 当前可视页首行是源字符 B，用户切到 Layout，分别在不同缩放、固有旋转页和裁切设置下操作
- **THEN** 对应源文字 B 出现在 Layout 安全视口顶部，边界限制时仍可见；同一位置反复切换且未阅读翻页不累积跳页或漂移

#### Scenario: No visible text uses source page proportion
- **WHEN** 来源视口只有图片或空白（即使同页屏外存在文字），或原页是无文字扫描页，用户在页内约 60% 位置切换模式再返回且未阅读翻页
- **THEN** 仍定位同一原页；Text 有多个可视页时进入最接近该页内比例的可视页，无文字时显示该页无文字状态；返回 Layout 时若 Text 仍无文字则恢复约 60% 位置，若 Text 已有文字则优先对齐其实际首行，不取屏外文字、不固定归零、不按全书比例跳页

#### Scenario: Slow or failed restoration and fast switches
- **WHEN** 首行所在页文字仍加载中，恢复失败后重试，或用户连续切换模式/文档使先前定位随后才完成
- **THEN** 加载中不提前保存比例回退或临时首屏，失败保留最后稳定位置并可重试；最终内容与进度只属于最后一次有效请求，无旧文档位置覆盖
