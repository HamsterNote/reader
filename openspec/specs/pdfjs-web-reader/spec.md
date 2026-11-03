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
- **THEN** 显示自绘圆形起点/终点手柄，可访问名称分别为“拖动以调整选区起点”“拖动以调整选区终点”；拖动可调整选区并操作高亮 Popover，不出现系统复制/查询/分享菜单，不触发滚动或自动翻页；离屏源端点不在当前列边缘生成替代手柄

#### Scenario: Responsive and busy controls
- **WHEN** 在宽屏、320px 窄屏及横竖屏阅读，底栏展开或工具面板变化，并在加载、翻页或重排时快速连点
- **THEN** 两按钮与底栏不重叠、不遮正文最后一行，正文和高亮叠层位置一致；忙碌时按钮禁用且不跳过内容，完成后边界禁用状态正确

#### Scenario: Explicit navigation
- **WHEN** 用户通过既有目录、页码、书签或高亮入口定位 PDF 原页或文字范围
- **THEN** 原页跳转打开该页首个可视页，文字锚点跳转打开包含该锚点的可视页，不把源页码当作临时可视页序号

### Requirement: PDF text stable progress and compatibility
系统 MUST 在成功翻页后使用既有 PDF 原页号及字符锚点保存 Text 进度，同一原页内移动也 SHALL 更新字符位置；临时可视页号或排版标识不得写入公开持久化数据。重开、字号/窗口/横竖屏/底栏变化后 SHALL 显示包含最后稳定锚点的可视页；中间首屏或失败导航 MUST 不覆盖有效进度。Text/Layout 切换 SHALL 沿用既有原页和字符定位契约，历史高亮及其 ID、端点、样式和评论关联 MUST 保持不变。

#### Scenario: Resume and reflow within source page
- **WHEN** 用户在同一原页翻两页后关闭重开，再改字号、窗口大小或底栏占用
- **THEN** Text 进度字符位置已前进，重开及重排后的当前可视页包含最后稳定锚点；零尺寸及连续重排期间旧进度不被临时首屏覆盖

#### Scenario: Mode switch and historic annotation
- **WHEN** 从 PDF Text 中途切到 Layout 再返回，加载历史 v2/v3/v4 高亮并操作含连字、展示空白或重复文本的选区，保存后重开
- **THEN** 按既有模式进度及原页/字符契约恢复，不丢失定位；选区仍映射原文字，输出为既有 v4 格式且 ID、端点及评论关联不变，不使用展示补空格偏移替换源偏移

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
