# pdfjs-web-reader Specification

## Purpose

为 PDF 提供可靠的 Web 页面展示、文本选择与导航，同时让用户继续使用 reader 的既有工具、高亮、矩形及绘图能力，并在缩放、页面回收及历史数据恢复后保持标注与原文一致。

## Requirements

### Requirement: PDF display and text navigation
系统 SHALL 在 Web 阅读层提供 PDF 页面展示、缩放、翻页、链接和可选择文本，保留现有 Layout/Text 入口及 reader 控件；大文件页面 SHALL 按需加载和释放。

#### Scenario: Read a multi-page PDF
- **WHEN** 用户打开多页 PDF，翻页、缩放并切换既有文本阅读入口
- **THEN** 显示正确页面和文本，页码导航保持一致，返回页面展示后内容可继续阅读

#### Scenario: Revisit a released page
- **WHEN** 用户离开已标注页直到其被回收，再返回该页
- **THEN** 页面、文字及原标注重新显示，加载过程不改变已存标注

### Requirement: PDF overlay alignment
系统 MUST 保留原 PDF 页号、字符端点、px/percent 矩形及样式语义，标注 SHALL 在缩放、旋转及裁切后与原文或原页面区域对齐。绘图 MUST 使用稳定公开页 ID 及与显示变换无关的页面锚定坐标；reader SHALL 将页面几何及当前变换交给绘图库，绘图的输入坐标换算与回放投影 MUST 由绘图库统一处理，reader 不得另行缩放或平移笔迹数据。以已知页面定位点为基准，指针命中点与对应笔迹几何中心线/端点的屏幕误差 MUST 不超过 1 CSS px；抗锯齿外沿不计入该误差。

#### Scenario: Historic annotations on a rotated page
- **WHEN** 用户恢复带文字高亮、矩形及绘图的旋转页并改变缩放
- **THEN** 叠加层对应原页面区域，高亮点击及调整可用，保存不替换原 ID、端点或坐标单位；绘图经库迁移后保持同一页面位置、颜色及绘制顺序

#### Scenario: Select text containing spacing and ligatures
- **WHEN** 用户选择含空白、换行或连字的文本并保存，再关闭重开
- **THEN** 同一文字范围被恢复，文字与端点符合旧数据契约，页外文本不被误选

#### Scenario: Draw after zoom and scroll
- **WHEN** 在同一 PDF 的 50%、100%、200% 缩放下，分别在容器顶部与横向/纵向滚动后，用鼠标、触摸或笔在页面四角附近及中心的定位点绘图
- **THEN** 每种组合的输入与回放误差均不超过 1 CSS px，笔迹大小随页面显示比例变化；往返缩放与滚动不改变持久化的页面坐标，不累积漂移

#### Scenario: Change pages and restore recycled overlays
- **WHEN** 在尺寸不同的第 1、2 页分别绘图，离开至页叠加层被回收，再通过分页导航返回，保存并重开
- **THEN** 各页只显示自身笔迹，公开页 ID 不因回收改变，恢复位置相对同页定位点误差不超过 1 CSS px

#### Scenario: Rotated cropped and high density display
- **WHEN** 在包含固有旋转的 PDF 页上绘图，改变显示旋转及裁切，并在 DPR 1、2、3 的显示环境回放
- **THEN** 可见部分笔迹与原页面区域误差不超过 1 CSS px，裁切只改变可见区域，设备像素比例不进入持久化坐标

### Requirement: PDF errors preserve state
系统 SHALL 对损坏、不可读或加载失败的 PDF 提示错误和可执行的重试操作，保留已确认数据。

#### Scenario: Rendering fails after annotations were restored
- **WHEN** 文档展示失败或用户关闭正在加载的 PDF
- **THEN** 已有标注不被清空，旧加载结果不更新后续文档

### Requirement: PDF text viewport pagination
系统 SHALL 在 PDF Text 模式按正文实际可用宽度和高度重排为单个可视页；上一页/下一页 MUST 每次移动一个可视页，原 PDF 页号不得作为可视页号。一个原页结束后 SHALL 进入下一可读原页的首个可视页，反向操作进入前一可读原页的末个可视页；隐藏页和页范围限制 SHALL 沿用现有契约。全书首末边界 MUST 不循环、不越界、不出现分页产生的空白尾页。

#### Scenario: Long source page
- **WHEN** 一个原 PDF 页的重排文字超过三个可视页，用户连续点击下一页两次再点击上一页
- **THEN** 每次只移动一个可视页，原页号不变，正文连续且无遗漏、重复，上一页回到前一个可视页

#### Scenario: Source page and range boundaries
- **WHEN** 用户在原页末个可视页点击下一页，再点击上一页，且相邻原页包含隐藏页或页范围之外页面
- **THEN** 前进进入下一个允许阅读原页的首个可视页，后退回到前一个允许阅读原页的末个可视页，全书或允许范围两端禁用相应按钮

#### Scenario: No extractable text
- **WHEN** 用户导航到没有可提取文字的原页或整本扫描 PDF
- **THEN** 每个无文本原页显示一个可识别的无文字状态及返回 Layout 的可用入口，保留原页导航；不无限跳页、不伪造文字锚点，也不把无文字误报为加载失败

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

### Requirement: PDF text bounded loading and failure recovery
PDF Text SHALL 继续按需提取正文、受现有加载页数限制释放离屏内容，不得为计算全书可视页数一次性提取整本正文。失败 SHALL 提供重试并保留最后成功位置及已确认标注；切换文档或模式后，旧加载、排版和导航结果 MUST 不更新新会话。

#### Scenario: Lazy navigation and retry
- **WHEN** 用户阅读大 PDF、跳到未加载页，该页文本提取失败后重试
- **THEN** 正文仅在目标及预加载窗口按需提取，缓存遵守现有上限；失败有可识别提示和重试入口，旧进度与标注保留，重试成功后完成目标定位并恢复按钮

#### Scenario: Replace a pending session
- **WHEN** 文档 A 加载/重排/翻页未完成，用户打开 B 或切换模式，随后 A 的操作返回
- **THEN** 旧结果不改变当前内容、按钮、错误或进度，监听及排版资源清理；PDF Layout、EPUB 和其他格式继续遵循各自原有交互

### Requirement: Drawing color follows the reader toolbar
系统 SHALL 以 reader 工具栏当前选中的绘制颜色作为新笔迹颜色，跨页和重新挂载后也 MUST 一致。系统 MUST 在落笔时冻结该笔颜色，不得以绘图库默认颜色覆盖工具栏选择；改变颜色不得重染已有笔迹。受控颜色以调用方最新已传入值为准。

#### Scenario: Choose a color and draw on two pages
- **WHEN** 用户选择颜色 A，在第 1 页绘图，改选颜色 B 后在第 1、2 页各绘一笔，再保存重开
- **THEN** 第一笔仍为 A，后两笔为 B，界面和持久化颜色一致，页面挂载不会使颜色回到库默认值

#### Scenario: Controlled color and color change during a stroke
- **WHEN** 受控调用方更新颜色为 C 后开始一笔，在该笔结束前将颜色更新为 D，再开始下一笔
- **THEN** 两笔颜色分别为 C、D，已有笔迹不改变，不产生重复颜色回调或回调循环

### Requirement: A single drawing path preserves reading gestures
系统 MUST 仅使用新绘图路径渲染和编辑 PDF 笔迹；非绘图模式可显示笔迹但 MUST 不阻挡文字选择及页面导航。绘图模式下单指绘图、双指导航 SHALL 保持既有交互，切换工具或取消手势不得提交误笔。

#### Scenario: Two fingers replace a pending drawing gesture
- **WHEN** 单指起笔后第二根手指加入，或绘制中切换到文字选择工具
- **THEN** 取消尚未提交的笔迹，不新增持久化对象，双指导航或文字选择保持可用，之前已确认笔迹保持不变

#### Scenario: Overlay remains transparent and read only outside drawing mode
- **WHEN** 已有笔迹的 PDF 切换至文字选择模式
- **THEN** PDF 内容及笔迹均可见，绘图表面无不透明底色遮挡页面，文字选择和链接导航不被绘图层截获

### Requirement: PDF layout resumes the first visible line or page ratio
PDF Layout MUST 按实际正文视口内首行的首个可见源字符保存位置，同原页内滚动也 MUST 更新位置；不能仅记录整个文本块起点。无可定位文字时 MUST 保存视口顶端相对当前显示页面的比例。可滚动布局重开后 SHALL 将目标字符所在行或比例目标对齐正文视口顶端，合法滚动边界内误差不超过 2 CSS px；触及边界时 SHALL 使用夹取后的合法位置。缩放 MUST 使用同一坐标系计算比例，页回收、迟到文字层与恢复事件不得覆盖稳定进度。

#### Scenario: Resume twice within one source page
- **WHEN** 用户先停在一页中部首行 A，保存重开，再滚至同页后部首行 B 保存重开，且排版相同
- **THEN** 两次分别以 A、B 所在行为视口首行，不回到源页首字；跨多行 span 仍定位正确字符，部分露出行恢复为完整行

#### Scenario: Scan or image region at nonzero ratio
- **WHEN** 视口内无文字，顶端处于目标页 40% 位置，保存后以 50%、100%、200% 缩放重开
- **THEN** 各次仍按目标页 40% 投影到正文视口顶部，不取固定 0；接近页尾无法顶对齐时停在合法最大位置

#### Scenario: Visible geometry excludes offscreen text
- **WHEN** 当前页可定位文字全部在视口下方或因横向滚动位于视口外，或视口同时包含两个页面
- **THEN** 仅视口相交的字形参与首行判定；整个视口无字时才使用比例，不因当前页码或 DOM 顺序误选离屏文字

#### Scenario: Restore after page recycling and geometry changes
- **WHEN** 已存页被回收后重开，或改变窗口、裁切及旋转再恢复无字比例
- **THEN** 等待目标几何就绪后定位，比例按新的显示页框纵轴投影，加载期间保留旧进度，不产生累计缩放漂移

### Requirement: PDF text resumes stable first-line content
PDF Text MUST 在成功翻页后保存当前可视页首行的稳定原页字符锚点；无字状态 SHALL 使用原页和可选页内比例。重开及重排 SHALL 显示包含原锚点或比例目标的可视页，同排版恢复同页，不强制滚动破坏按钮分页。系统 MUST 保留源字符偏移、页范围、隐藏页及模式切换契约，不持久化临时列号。

#### Scenario: Text page reflows and reopens
- **WHEN** 在同一 PDF 原页内翻到第三个可视页保存，重开并调整字号、窗口或底栏高度
- **THEN** 同排版回到第三个可视页，新排版当前页包含所存源字符，重排临时首屏不覆盖进度

#### Scenario: Text page contains no text
- **WHEN** 无字原页的单个 Text 状态页被保存并重开
- **THEN** 恢复该原页及既有无字状态，不生成字符锚点、不开启滚动或自动跳页；缺少历史比例时按 0 处理

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
- **THEN** 既有选择与保存操作保持可用，Text 不滚动或自动翻页，PDF 两模式预览颜色均遵循底栏规则

#### Scenario: Opaque host colors without blending
- **WHEN** 宿主传入不透明高亮色且 WebView 的混色无法生效，用户选择跨多 span 的紧密多行文字并确认高亮
- **THEN** 草稿和已确认高亮使用同一带 alpha 的填充（最大 0.35），文字可读；同行矩形无内部白缝且不越出文字行边界，源锚点与存储格式保持不变

#### Scenario: PDF handle contrast and line placement
- **WHEN** 用户在 PDF Layout 的 50%、100%、200% 缩放下选择文字并拖动起止圆柄
- **THEN** 20px 圆柄有恒定 2px 白边，圆点与竖线有整体阴影；起点圆点在行上缘外、终点在下缘外，命中遵循 `reader-text-selection-interaction` 的实际指针零额外位移规则，PDF Text 圆柄视觉不随之改变

### Requirement: PDF magnifier and continuous touch selection

PDF Layout 与 PDF Text 的文字手柄及放大镜 MUST 遵循 `reader-text-selection-interaction`；PDF 预览、EPUB、PDF 纯文字三者共用该规格的同一份交互描述与全部验收场景。镜片显示位置由触摸点及正文可见边界决定，层级 SHALL 保证镜片与可见手柄均不被错误遮挡，跨页与滚动后仍对应当前源端点。手柄竖线 MUST 绘制在圆点后方，白圈完整。PDF Layout 拖动 MUST 允许越过固定端并交换起止角色；其活动选择 SHALL 在正常滚动后保留。PDF Layout 手指接近阅读器顶部/底部 MUST 启动按距离加速的自动滚动，每帧用当前手指位置更新端点，释放/取消时立即停止；自动滚动仅适用于 PDF Layout；PDF Text 与 EPUB 的按钮分页和禁止越界滚动契约保持有效。

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

### Requirement: Hidden pages stay out of the main document flow

系统 MUST 在阅读态和页面编辑态都将隐藏的原 PDF 页排除在正文文档流和正文导航集合之外。每个隐藏页 MUST NOT 在正文中对应整页占位、隐藏提示、canvas、文字层或页面叠加层节点；打开编辑开关 MUST NOT 使隐藏页重新参与正文测量或触发其正文渲染。每个连续隐藏页段只允许有一个共享折叠控制节点，该节点 MUST NOT 采用原页尺寸，也不得成为隐藏页的逐页替代节点。折叠控制节点 MUST 使用绝对定位叠加在既有页间隙，不得进入文档流；切换编辑开关前后，可见页 offsetTop 与文档 scrollHeight MUST 完全不变。

#### Scenario: Enable editing with hidden pages

- **WHEN** PDF 第 9、10 页已隐藏，第 8、11 页正常显示，用户打开页面编辑开关
- **THEN** 第 9、10 页仍不显示正文页面框、内容或逐页提示，不发起这两页的正文渲染，也不成为可导航页面；第 8、11 页之间只增加一个绝对定位的共享恢复入口，第 8 页底边与第 11 页顶边均不移动

#### Scenario: Large consecutive hidden range

- **WHEN** 200 页 PDF 的第 2 至 199 页全部隐藏，用户在阅读态与编辑态之间切换
- **THEN** 这 198 页在两种状态下都不产生参与正文布局的页面占位或正文渲染请求，编辑态只增加一个段入口，不重新加载文档，且所有可见页 offsetTop 及文档 scrollHeight 与切换前完全一致

### Requirement: Hidden pages form maximal consecutive groups

系统 SHALL 先把当前文档内合法的原页码及 `page-N` 标识规范化为同一原页集合并去重，再与当前页面允许范围求交集；范围外、越界或无效标识 SHALL 保留在宿主数据中，但不生成恢复入口或模态框可选项。系统 MUST 按原 PDF 页号把可恢复隐藏页划分为极大连续段，单页也构成一段；可见页或允许范围边界 MUST 分隔不同段，不得跨段合并入口。

#### Scenario: Consecutive and isolated pages

- **WHEN** 第 2 页、第 4、5、6 页及第 9 页隐藏，其余页可见，用户进入编辑态
- **THEN** 正文依次出现「隐藏 1 页」「隐藏 3 页」「隐藏 1 页」三个入口，各入口位于对应段与原可见页的边界，不增加逐页占位

#### Scenario: Head, tail, and entire-document groups

- **WHEN** 分别隐藏开头的第 1、2 页，隐藏末尾的第 9、10 页，以及隐藏整本 10 页 PDF，并进入编辑态
- **THEN** 段首入口显示在第 3 页之前，段尾入口显示在第 8 页之后；整篇隐藏时正文空状态区域显示唯一的「查看 10 个隐藏页」入口，仍可打开恢复界面

#### Scenario: Duplicate aliases and out-of-range entries

- **WHEN** 隐藏数据同时包含第 4 页的数字与 `page-4` 别名，以及不属于当前允许范围的隐藏页
- **THEN** 第 4 页只出现一次且只影响一个分组，范围外页面不进入本次恢复列表，其原始数据不被静默删除

### Requirement: One modal exposes all restorable groups

系统 SHALL 在编辑态提供模态框，按原页顺序和连续段分组展示当前所有可恢复隐藏页及页码。从任一段入口打开时 SHALL 显示同一完整列表并定位到该入口对应段，用户无需关闭模态框即可查看和操作其他段。模态框打开期间 SHALL 阻止正文滚动和编辑手势，关闭后 SHALL 将焦点返回原入口；退出编辑或切换文档 MUST 关闭模态框并丢弃未确认选择。

#### Scenario: Open from one group and review another

- **WHEN** 隐藏页分为第 2 页和第 7、8 页两段，用户从第 2 页对应入口打开模态框并滚动到第 7、8 页分组
- **THEN** 两段预览都可在同一模态框中查看，正文不滚动，关闭后焦点回到第 2 页对应入口

#### Scenario: Edit mode exits with a draft

- **WHEN** 用户在模态框中已选择若干页面但尚未确认，随后退出编辑或切换文档
- **THEN** 模态框关闭，草稿选择被清除，隐藏数据不变，旧草稿不会在新文档中恢复

### Requirement: Modal supports accessible multi-select and global select all

系统 SHALL 允许用户逐个切换页面选择，并在不同连续段之间保留选择。每个已选页面 SHALL 显示蓝底白字的圆形「✓」标记，同时暴露可读页码、选中状态及键盘可操作的复选语义；颜色或图形 MUST NOT 是唯一状态提示。模态框 SHALL 提供作用于当前全部可恢复页的「全选」，全选后可取消全选，并在确认操作中显示已选数量；零选择时确认不可用。

#### Scenario: Select across groups

- **WHEN** 用户在模态框选择第 2 页，再选择另一段的第 7、8 页，并取消选择第 2 页
- **THEN** 第 7、8 页保持选中并显示蓝底白字对勾，第 2 页取消标记，确认操作显示将恢复 2 页

#### Scenario: Select and clear the complete restorable set

- **WHEN** 当前可恢复列表包含多个段，用户激活「全选」后激活「取消全选」
- **THEN** 第一次操作选中所有段内的全部可恢复页，第二次清空全部选择并禁用确认；范围外隐藏页不受选择影响

### Requirement: Restore commits once and offers one undo

模态框选择 MUST 只是未提交草稿。取消、关闭或 Escape SHALL 丢弃草稿且不修改数据；确认 MUST 通过一次原子数据更新只移除所选原页对应的数字或 `page-N` 隐藏项，保留未选项、范围外项、其他阅读数据及其顺序。确认后 SHALL 关闭模态框、恢复所选页的正文与导航且不重载源文档，并提供 5 秒内可用的一次「撤销」；撤销 MUST 恢复本次确认前的完整隐藏页集合并保持其他最新数据不变。下一次隐藏/恢复、退出编辑或切换文档 MUST 立即使该撤销失效，撤销不纳入标注撤销/重做历史。

#### Scenario: Confirm a partial batch

- **WHEN** 用户跨段选择第 2、7、8 页并确认，而第 4 页仍保持隐藏
- **THEN** 系统只提交一次恢复，第 2、7、8 页按原页号回到正文和导航，第 4 页仍折叠隐藏，源文档不重新加载

#### Scenario: Cancel or undo

- **WHEN** 用户先选择页面后取消，再重新选择并确认，随后在 5 秒内激活一次撤销
- **THEN** 取消未修改任何数据；确认只恢复本次所选页，撤销将这些页恢复为确认前的隐藏状态且只执行一次，其他阅读数据不变

#### Scenario: Document changes before undo

- **WHEN** 用户在文档 A 确认恢复后、撤销仍可用时切换到文档 B
- **THEN** A 的撤销入口立即失效，任何迟到回调都不能恢复 A 的隐藏项或覆盖 B 的数据

### Requirement: Restoration previews are bounded and session isolated

模态框 SHALL 复用阅读器现有 PDF 预览能力，仅为模态框内可见或即将可见的页面按需生成真实缩略图，并保证原页宽高比；MUST NOT 为生成列表一次性渲染全部隐藏页。预览任务 SHALL 让位于正文渲染并具有有界并发和缓存，失败 SHALL 提供单页重试而不影响其他页面。关闭模态框或切换文档 MUST 取消旧任务并释放其资源，旧结果 MUST NOT 出现在后续列表中。

#### Scenario: Preview pending, failure, and retry

- **WHEN** 用户打开包含多个隐藏页的模态框，某个可见预览失败而其他预览成功，随后重试失败页
- **THEN** 加载中的项目保持稳定尺寸，失败页显示可识别错误和重试入口，重试只重新生成该页且成功后显示正确预览

#### Scenario: Close or replace during preview loading

- **WHEN** 文档 A 的隐藏页预览仍在加载，用户关闭模态框或打开文档 B，随后 A 的预览结果返回
- **THEN** A 的任务被取消并释放，结果被丢弃，B 不显示 A 的图片、页码或错误
