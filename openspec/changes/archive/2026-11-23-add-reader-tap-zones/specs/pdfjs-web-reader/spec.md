# Spec Delta

## MODIFIED Requirements

### Requirement: PDF text viewport pagination
系统 SHALL 在 PDF Text 模式按正文实际可用宽度和高度重排为单个可视页；上一页/下一页 MUST 每次移动一个可视页，原 PDF 页号不得作为可视页号。一个原页结束后 SHALL 进入下一可读原页的首个可视页，反向操作进入前一可读原页的末个可视页；隐藏页和页范围限制 SHALL 沿用现有契约。全书首末边界 MUST 不循环、不越界、不出现分页产生的空白尾页。

#### Scenario: Long source page
- **WHEN** 一个原 PDF 页的重排文字超过三个可视页，用户连续通过正文操作前进两次再返回一次
- **THEN** 每次只移动一个可视页，原页号不变，正文连续且无遗漏、重复，上一页回到前一个可视页

#### Scenario: Source page and range boundaries
- **WHEN** 用户在原页末个可视页向前翻页，再向后翻页，且相邻原页包含隐藏页或页范围之外页面
- **THEN** 前进进入下一个允许阅读原页的首个可视页，后退回到前一个允许阅读原页的末个可视页，全书或允许范围两端向外翻页保持原位置

#### Scenario: No extractable text
- **WHEN** 用户导航到没有可提取文字的原页或整本扫描 PDF
- **THEN** 每个无文本原页显示一个可识别的无文字状态及返回 Layout 的可用入口，保留原页导航；不无限跳页、不伪造文字锚点，也不把无文字误报为加载失败

### Requirement: PDF text reading controls

PDF Text MUST 移除底部翻页按钮。正文的滚轮、触控板传统滚动、滚动按键及选区越界 MUST 不引起正文或外层滚动或翻页。只有符合正文分区规则的指针点击或滑动可触发相邻可视页导航。显式定位、页内选择、高亮工具和侧栏滚动 SHALL 保持可用。

#### Scenario: Inputs and selection

- **WHEN** 在正文及空白处使用滚轮、触控板、未达门槛的横纵滑动、方向键、空格、PageUp/PageDown、Home/End，或拖选至页边
- **THEN** 阅读位置及外层滚动不变，无自动翻页；仍可鼠标/长按选择页内文字和操作高亮，侧栏可独立滚动，输入控件正常编辑

#### Scenario: PDF Text custom selection handles

- **WHEN** 在 iOS 或 Android WebView 的 PDF Text 长按选字并拖动可见端点
- **THEN** 显示与 PDF Layout 一致的自绘起点/终点手柄，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”；拖动可调整选区并操作高亮 Popover，不出现系统复制/查询/分享菜单，不触发滚动或自动翻页；离屏源端点不在当前列边缘生成替代手柄

#### Scenario: Responsive and busy controls

- **WHEN** 在宽屏、320px 窄屏及横竖屏阅读时显隐栏位，或在加载、翻页或重排时重复点击翻页区及滑动
- **THEN** 栏位覆盖正文时，正文与高亮叠层保持对齐及原位置，忙碌时重复输入不跳过内容，首末边界向外操作保持当前页

#### Scenario: Explicit navigation

- **WHEN** 用户通过既有目录、页码、书签或高亮入口定位 PDF 原页或文字范围
- **THEN** 原页跳转打开该页首个可视页，文字锚点跳转打开包含该锚点的可视页，不把源页码当作临时可视页序号

### Requirement: PDF text stable progress and compatibility
系统 MUST 在成功翻页后使用既有 PDF 原页号及字符锚点保存 Text 进度，同一原页内移动也 SHALL 更新字符位置；临时可视页号或排版标识不得写入公开持久化数据。重开、字号/窗口/横竖屏变化后 SHALL 显示包含最后稳定锚点的可视页；中间首屏或失败导航 MUST 不覆盖有效进度。Text/Layout 切换 SHALL 沿用既有原页和字符定位契约，并优先使用切换来源模式当前安全视口内首行文字；Layout → Text SHALL 打开包含该源字符的可视页，Text → Layout SHALL 将 Text 实际首行对应源文字对齐安全视口顶部，受边界限制时保持目标可见。仅来源安全视口没有可定位文字时 SHALL 按同一原页内纵向比例回退，保留比例以便返回，不能用目标模式的陈旧进度或固定页首替代。文字层尚未就绪 MUST 不被误判为无文字。纯 PDF 续读保存的比例 MUST 不替代或抢先截断模式互切的文字采集；safe area MUST 同时作用于来源首行筛选和目标位置对齐，完全位于遮挡区域的行 MUST 不参与判定，部分与安全正文相交的行继续按首行规则处理。宿主已经预留的 safe area MUST 不重复计入。历史高亮及其 ID、端点、样式和评论关联 MUST 保持不变；旧进度记录缺少比例时继续可读，不得改变原页号语义。

#### Scenario: Resume and reflow within source page
- **WHEN** 用户在同一原页翻两页后关闭重开，再改字号或窗口大小
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

### Requirement: PDF text bounded loading and failure recovery
PDF Text SHALL 继续按需提取正文、受现有加载页数限制释放离屏内容，不得为计算全书可视页数一次性提取整本正文。失败 SHALL 提供重试并保留最后成功位置及已确认标注；切换文档或模式后，旧加载、排版和导航结果 MUST 不更新新会话。

#### Scenario: Lazy navigation and retry
- **WHEN** 用户阅读大 PDF、跳到未加载页，该页文本提取失败后重试
- **THEN** 正文仅在目标及预加载窗口按需提取，缓存遵守现有上限；失败有可识别提示和重试入口，旧进度与标注保留，重试成功后完成目标定位并恢复正文导航

#### Scenario: Replace a pending session
- **WHEN** 文档 A 加载/重排/翻页未完成，用户打开 B 或切换模式，随后 A 的操作返回
- **THEN** 旧结果不改变当前内容、正文导航状态、错误或进度，监听及排版资源清理；PDF Layout、EPUB 和其他格式继续遵循各自原有交互

### Requirement: PDF text resumes stable first-line content
PDF Text MUST 在成功翻页后保存当前可视页首行的稳定原页字符锚点；无字状态 SHALL 使用原页和可选页内比例。重开及重排 SHALL 显示包含原锚点或比例目标的可视页，同排版恢复同页，不强制滚动破坏可视页导航。系统 MUST 保留源字符偏移、页范围、隐藏页及模式切换契约，不持久化临时列号。

#### Scenario: Text page reflows and reopens
- **WHEN** 在同一 PDF 原页内翻到第三个可视页保存，重开并调整字号或窗口尺寸
- **THEN** 同排版回到第三个可视页，新排版当前页包含所存源字符，重排临时首屏不覆盖进度

#### Scenario: Text page contains no text
- **WHEN** 无字原页的单个 Text 状态页被保存并重开
- **THEN** 恢复该原页及既有无字状态，不生成字符锚点、不开启滚动或自动跳页；缺少历史比例时按 0 处理

### Requirement: PDF magnifier and continuous touch selection

PDF Layout 与 PDF Text 的文字手柄及放大镜 MUST 遵循 `reader-text-selection-interaction`；PDF 预览、EPUB、PDF 纯文字三者共用该规格的同一份交互描述与全部验收场景。镜片显示位置由触摸点及正文可见边界决定，层级 SHALL 保证镜片与可见手柄均不被错误遮挡，跨页与滚动后仍对应当前源端点。手柄竖线 MUST 绘制在圆点后方，白圈完整。PDF Layout 拖动 MUST 允许越过固定端并交换起止角色；其活动选择 SHALL 在正常滚动后保留。PDF Layout 手指接近阅读器顶部/底部 MUST 启动按距离加速的自动滚动，每帧用当前手指位置更新端点，释放/取消时立即停止；自动滚动仅适用于 PDF Layout；PDF Text 与 EPUB 的可视页导航和禁止越界滚动契约保持有效。

#### Scenario: Cross a page with a text-only lens
- **WHEN** 用户触摸拖动 PDF Layout 手柄跨页或在页间隙取景
- **THEN** 镜片读取当前位置文字层，排除所有高亮与手柄，可定位的当前字符间隙显示有效高亮色竖线，取景无有效字符间隙时按共享规格隐藏竖线；镜片与圆柄不发生层级反转

#### Scenario: Reverse an endpoint across its anchor
- **WHEN** PDF Layout 起点拖过终点或终点拖过起点，随后再拖回来并释放
- **THEN** 保留固定字符端点，起止角色随移动端交换，预览和最终保存范围一致，不丢失捕获

#### Scenario: Accelerate scrolling at the viewport edge
- **WHEN** 用户在 PDF Layout 保持手指在阅读容器上下边缘，并逐渐接近边缘
- **THEN** 滚动速度随距离缩短增大，手指静止时仍更新跨页范围；松手或取消立即停止，普通滚动不清除活动选区，原生 Selection 仍为空

#### Scenario: Continue beyond the PDF.js page cache
- **WHEN** PDF Layout 选择从第 1 页持续拖动到第 12 页，PDF.js 已回收起始页画布和文字层
- **THEN** 适配层保留并恢复当前会话需要的文字层及真实字符端点，拖动不中断，确认结果包含中间页文字与矩形；清除会话后释放保留文字并恢复重建的 PDF.js 文字层，不阻止画布缓存回收

#### Scenario: Apply the shared contract to both PDF modes
- **WHEN** 在 PDF Layout 与 PDF Text 分别执行 `reader-text-selection-interaction` 的共享验收矩阵
- **THEN** 两种模式均满足同一交互描述，PDF Layout 保留连续选择及边缘自动滚动，PDF Text 不因此滚动或自动翻页

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
- **THEN** 圆点与热区屏幕尺寸稳定，可见手柄对应真实源端点；离屏源端点保持隐藏，不在当前列边缘补柄；正文不滚动或自动翻页，通过正文翻页后不遗留错误位置手柄，保存并重开仍映射相同源字符

#### Scenario: Restore a single saved highlight after reflow

- **WHEN** PDF Text 的普通单条高亮或分组高亮被选中、保存重开，且源字符顺序与视觉顺序不同或重排插入了展示空白，并切换到大字号
- **THEN** 所有已保存端点在进入 selection runtime 前转换成当前 DOM offset，背景和手柄对应同一组源字符；草稿不重复转换，触摸调整后仍保存 canonical 源范围及原 ID/颜色，分页/书签/高亮导航保留源锚点语义

#### Scenario: End a Text handle session safely

- **WHEN** Text 手柄拖动发生 pointercancel、失焦、模式/工具/文档切换或组件卸载
- **THEN** 本次手势不产生额外的高亮或范围提交，已保存数据不受影响，无遗留手柄、指针监听或放大镜阻挡下一次选择

#### Scenario: Preserve other selection surfaces

- **WHEN** 使用桌面 PDF Text 或 PDF Layout 鼠标调整范围、PDF Layout 现有移动选择，或 EPUB、其他格式及矩形选择
- **THEN** 桌面 PDF 两模式均可操作并共享统一手柄外观与热区，鼠标沿用各自原有选择引擎；Layout 触摸选择保持原行为，EPUB、其他格式及矩形选择的手柄外观与逻辑不受本次变更影响

## RENAMED Requirements

- FROM: `### Requirement: PDF text button-only reading controls`
- TO: `### Requirement: PDF text reading controls`

## ADDED Requirements

### Requirement: PDF Text reading tap and swipe zones
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

#### Scenario: Keep PDF Layout outside the interaction
- **WHEN** 从 PDF Text 切换至 PDF Layout，再切换回 PDF Text
- **THEN** Layout 无本分区翻页和新页码，原滚动及工具可用。回到 Text 时栏位隐藏并保留既有模式切换锚点

### Requirement: PDF Text source page indicator
PDF Text 正文右下角 SHALL 显示灰色 `当前/总数`，两处栏位显隐时始终可见。就绪后分子 MUST 为当前稳定阅读位置所在的 1 起始原始 PDF 页号，分母 MUST 为文件全文总页数。阅读范围限制或隐藏页不改变原始编号及总数。同一原页的可视页之间翻动不改变页码。无稳定位置时省略页码，不显示虚构数字。PDF Layout 不显示本指示。

#### Scenario: Display source numbering across viewport pages
- **WHEN** 在文件共 N 页的 PDF 中，从原页 1 的首视口翻到同原页下一视口，再跨到原页 2，期间切换栏位显隐
- **THEN** 指示一直可见并依次显示 `1/N`、`1/N`、`2/N`，显隐不改变页码

#### Scenario: Retain document numbering with hidden or excluded pages
- **WHEN** 从原页 1 翻到下一个允许阅读的原页 3
- **THEN** 指示从 `1/N` 变为 `3/N`，全文分母 N 保持
