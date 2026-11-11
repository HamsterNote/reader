# Spec Delta

## MODIFIED Requirements

### Requirement: PDF layout resumes the first visible line or page ratio
PDF Layout 的新续读进度 MUST 始终使用原页号及安全正文上边界线在该显示页内的纵向百分比，不论安全视口是否有文字；该规则仅用于续读保存与恢复，不改变文字书签、高亮导航或模式互切的文字定位。令安全正文上边界为 L，显示页矩形为 P，百分比 MUST 为 clamp((L - P.top) / P.height * 100, 0, 100)，不含页间距，不使用全书滚动比例。系统 SHALL 选择穿过 L 且与安全视口相交的允许页面；L 位于页间隙时 SHALL 选择安全视口内下一允许页面，记录 0%；同高多页按既有阅读顺序选择。重开 SHALL 将 P.top + P.height * percentage / 100 对齐当前安全正文上边界，合法滚动范围内误差不超过 2 CSS px，边界使用夹取后位置。缩放、裁切和旋转后 SHALL 使用当前显示页矩形解释比例，不承诺不同裁切/旋转下恢复同一物理图像点。零尺寸、无相交允许页面、页面几何未就绪、恢复中或加载失败 MUST 保留最后稳定位置；有可用页面几何时 MUST 不等待文字层。安全区已由外层布局预留时 MUST 不重复扣除。


#### Scenario: Resume twice within one source page
- **WHEN** 用户先停在有字页面的安全线 35% 位置，保存重开，再滚至同页 65% 保存重开，且排版相同
- **THEN** 两次分别恢复 35%、65% 的安全线位置，即使首行位于更低处也不吸附到文字，不回到页首

#### Scenario: Scan or image region at nonzero ratio
- **WHEN** 视口内无文字，顶端处于目标页 40% 位置，保存后以 50%、100%、200% 缩放重开
- **THEN** 各次仍按目标页 40% 投影到正文视口顶部，不取固定 0；接近页尾无法顶对齐时停在合法最大位置

#### Scenario: Visible geometry excludes offscreen text
- **WHEN** 当前页可定位文字全部在视口下方或因横向滚动位于视口外，或视口同时包含两个页面
- **THEN** 续读始终按安全上边界线选择允许页面并记录比例，不因屏内外文字或 DOM 顺序改变记录；文字互切仍仅采集安全视口相交字形

#### Scenario: Restore after page recycling and geometry changes
- **WHEN** 已存页被回收后重开，或改变窗口、裁切及旋转再恢复无字比例
- **THEN** 等待目标几何就绪后定位，比例按新的显示页框纵轴投影，加载期间保留旧进度，不产生累计缩放漂移

#### Scenario: Safe area affects both capture and restore
- **WHEN** 容器顶为 0，剩余顶部遮挡为 80 CSS px，显示页顶为 -120、高为 1000 CSS px，保存后以同一几何重开
- **THEN** 保存 20% 而非 12%，恢复时该页 20% 位置对齐 y=80；将外层布局改为已预留 80px 且内部剩余遮挡为 0 后不再次叠加 80px

#### Scenario: Safe line crosses a page gap or scroll boundary
- **WHEN** 安全线落在两页间隙且下一允许页面可见，或比例目标位于文档末端、无法对齐安全线
- **THEN** 前者保存下一允许原页及 0%，后者使用合法滚动上限；隐藏页、范围外页面及页间距不成为比例目标

#### Scenario: Text layer arrives after a geometric progress sample
- **WHEN** 有效页面几何已展示但文字层延迟或提取失败，用户在同页两个位置停留，随后文字层返回
- **THEN** 两次几何位置均可保存，文字层返回不把比例改写成文字锚点或临时页首


### Requirement: PDF text stable progress and compatibility
系统 MUST 在成功翻页后使用既有 PDF 原页号及字符锚点保存 Text 进度，同一原页内移动也 SHALL 更新字符位置；临时可视页号或排版标识不得写入公开持久化数据。重开、字号/窗口/横竖屏/底栏变化后 SHALL 显示包含最后稳定锚点的可视页；中间首屏或失败导航 MUST 不覆盖有效进度。Text/Layout 切换 SHALL 沿用既有原页和字符定位契约，并优先使用切换来源模式当前安全视口内首行文字；Layout → Text SHALL 打开包含该源字符的可视页，Text → Layout SHALL 将 Text 实际首行对应源文字对齐安全视口顶部，受边界限制时保持目标可见。仅来源安全视口没有可定位文字时 SHALL 按同一原页内纵向比例回退，保留比例以便返回，不能用目标模式的陈旧进度或固定页首替代。文字层尚未就绪 MUST 不被误判为无文字。纯 PDF 续读保存的比例 MUST 不替代或抢先截断模式互切的文字采集；safe area MUST 同时作用于来源首行筛选和目标位置对齐，完全位于遮挡区域的行 MUST 不参与判定，部分与安全正文相交的行继续按首行规则处理。宿主已经预留的 safe area MUST 不重复计入。历史高亮及其 ID、端点、样式和评论关联 MUST 保持不变；旧进度记录缺少比例时继续可读，不得改变原页号语义。

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

#### Scenario: Persisted geometric progress does not override a visible text handoff
- **WHEN** PDF 续读比例为 35%，来源安全视口最上方可定位文字为 A，目标 Text 还保存了其他位置
- **THEN** 切换打开包含 A 的文字可视页，不按 35% 推算字符偏移、不使用目标旧进度；Text 分页保持完整页布局

#### Scenario: Occluded lines are excluded and return alignment is safe
- **WHEN** PDF 顶部遮挡内有行 X，安全视口最上方可见行是 A，切到 Text 并翻到首行 B 后返回 PDF
- **THEN** 进入 Text 使用 A 而不是 X；返回时 B 的行顶对齐 PDF 当前安全正文上边界，合法范围内误差不超过 2 CSS px，边界取合法夹取结果
