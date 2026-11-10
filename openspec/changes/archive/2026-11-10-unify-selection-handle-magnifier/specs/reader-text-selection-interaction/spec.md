# Spec Delta

## Purpose

为 PDF 预览（Layout 排版模式）、EPUB 和 PDF 纯文字（Text）提供唯一的文字端点手柄与放大镜交互标准。三个渲染面共用同一份交互描述、输入规则及验收场景，保证不同文档引擎的文字选择反馈一致，并保留各格式原有导航和数据契约。

## ADDED Requirements

### Requirement: One interaction contract across three rendering surfaces

PDF 预览 / EPUB / PDF 纯文字 MUST 共用本规格的同一份交互描述。以下全部场景 SHALL 分别在三个渲染面执行，覆盖未确认选区和已有高亮的起点、终点调整；不得以任一渲染面通过替代另两个。共享范围只包含文字端点及放大镜，格式原有的分页、滚动、跨端交换、有效性与持久化契约 SHALL 继续生效。

#### Scenario: Execute the shared acceptance matrix
- **WHEN** 在三个渲染面分别使用 touch、mouse、pen 拖动文字起止手柄，覆盖草稿和已有高亮
- **THEN** 每个组合均按本规格逐项判定；渲染面的规格只引用该标准，不另行定义不同的显隐、位移、镜片跟随、竖线或选区刷新规则

### Requirement: Visible handles throughout a valid drag

有效端点拖动期间，当前可见的自绘起止手柄 MUST 保持显示，包括正在移动的手柄，不得因进入拖动态而隐藏、透明或被镜片层遮住。源端点本来离屏时 SHALL 沿用既有离屏规则，不生成视口边缘替代手柄。

#### Scenario: Keep both visible endpoints during drag
- **WHEN** 选区两个端点均在正文可见区域，任一输入类型连续拖动起点或终点并触发选区更新
- **THEN** 每个呈现帧均能看到两个手柄，移动端手柄对应最新有效端点，选区更新或组件重建不造成手柄消失

### Requirement: Touch-only magnifier activation

仅当前有效拖动由 touch 输入发起且既有放大镜开关开启时，系统 SHALL 显示放大镜。mouse、pen 及未知输入 MUST 不显示放大镜，但其有效手柄调整 SHALL 保持可用。输入类型按当前拖动会话判定，不得用设备是否支持触摸或旧会话类型替代。

#### Scenario: Distinguish touch mouse and pen
- **WHEN** 在同一支持混合输入的设备上依次以 touch、mouse、pen、未知类型拖动同一可见文字手柄
- **THEN** 仅 touch 会话显示镜片，其余会话从按下至释放镜片可见数始终为 0，仍可调整和提交有效端点；触摸后的兼容鼠标事件不重新开启镜片

#### Scenario: Disable and end a lens session
- **WHEN** 放大镜开关关闭后触摸拖动，或已显示的镜片遇到释放、取消、失焦、切书或切模式
- **THEN** 开关关闭时镜片可见数为 0；会话结束时镜片关闭，旧会话的迟到事件不使镜片重新出现

### Requirement: Endpoint hit testing has no added displacement

端点命中 MUST 使用当前指针在正文中的实际位置，仅允许视口、iframe、缩放和页面坐标之间的必要换算；MUST NOT 叠加抓取点到圆柄中心、手柄到文字行、放大镜避让或手指遮挡补偿。指针落在有效文字行内时 SHALL 命中该行对应字符间隙；字符吸附沿用现有映射规则，不得使其命中相邻行。扩大手柄热区只影响能否开始拖动，MUST NOT 改变后续命中坐标。

#### Scenario: Select the line under the actual pointer
- **WHEN** 在已知字符边界的三行样本中，从手柄中心或热区边角开始，以三种输入分别拖到第二行同一个有效字符间隙并释放
- **THEN** 各次最终移动端均为第二行该字符间隙，与按实际指针直接命中的端点一致；不得落到第一或第三行，不因抓取起点不同而改变结果

#### Scenario: Transform coordinates without an offset
- **WHEN** 在非零阅读器偏移、iframe 偏移、PDF 50%/100%/200% 缩放以及已有旋转/裁切配置下，拖到已知源字符间隙
- **THEN** 各次保存的逻辑端点均对应指针下的源字符间隙；镜片在上方或下方不改变端点，同位置往返操作不累积偏移

### Requirement: Lens follows the finger continuously

镜片位置 MUST 跟随当前触摸点连续更新，不随字符命中的离散变化而停顿或逐字跳动。无边缘约束时镜心 SHALL 位于触摸点正上方约 1cm；只有正文可见区域上方放不下完整镜片时 SHALL 翻到下方；上方重新放得下时 SHALL 恢复上方。横向及极小视口 SHALL 夹取镜片使其尽可能完整可见，夹取只改变显示位置，不改变实际文字命中。约 1cm 的跨设备换算口径见设计中的明确假设。

#### Scenario: Move within one character interval
- **WHEN** 手指在同一个字符命中区间内连续小幅移动，且远离边缘
- **THEN** 镜片随每次已呈现的触摸位置移动，镜心横向对齐触摸点、纵向保持约 1cm，不等待端点字符改变，也不播放滞后追赶动画

#### Scenario: Flip only when the top cannot fit
- **WHEN** 手指从正文中部向顶部移动，直到上方无法容纳完整镜片，再回到可容纳的位置
- **THEN** 依次为上方、下方、上方；靠近底部但上方可放下时仍在上方，翻转前后实际选中的文字不因镜片位置改变

### Requirement: Discrete insertion marker anchored between characters

镜内 MUST 显示一根独立的虚拟竖线，锚定当前移动端源字符间隙；其源文字锚点 MUST 仅在命中端点改变时离散切换，不得在两个字符边界间插值、缓动或固定在镜片中心。镜片移动时竖线 SHALL 随文字取景变换保持与同一字符间隙对齐，因此竖线的镜内像素位置可以变化；这不构成字符端点改变。竖线颜色 MUST 等于当前操作将用于高亮的有效颜色：草稿使用当前有效高亮色；已有高亮范围调整使用其保留颜色，显式改色后使用新颜色。

#### Scenario: Keep one boundary then jump to the next
- **WHEN** 手指从字符 A/B 间隙的命中区内连续移动，随后跨入 B/C 间隙的命中区
- **THEN** 第一阶段竖线始终对齐 A/B，跨界后在下一次呈现直接对齐 B/C；不存在竖线处于两个间隙之间的过渡帧，镜片位置仍连续跟随手指

#### Scenario: Match the target highlight color
- **WHEN** 草稿有效颜色由 A 更新为 B，或工具栏为 B 时拖动原颜色为 C 的已有高亮，再显式将目标改色为 D
- **THEN** 镜内竖线分别使用 B、C、D 的有效颜色；改色不改变字符端点，不以固定默认色或系统蓝色替代，不重染其他高亮

#### Scenario: No valid insertion point
- **WHEN** 手指移入没有可定位文字的页间隙或尚未就绪的文字区域
- **THEN** 镜片继续按触摸点取景；当前取景无法显示有效字符间隙时隐藏竖线，不伪造一个镜心插入点，端点有效性及释放行为沿用该格式既有契约

### Requirement: Lens does not refresh selection rendering

镜内 MUST 只呈现当前取景的正文文字和独立插入竖线，不渲染文字选区填充、高亮覆盖、系统选区或手柄。拖动引起的范围预览变化 MUST NOT 触发镜内选区重绘、重新截图或选区同步；正文外部的选区预览 SHALL 继续实时更新，竖线位置和颜色 SHALL 按本规格独立更新。文字取景平移、跨页、正文几何或内容变化所必需的正文更新不属于选区同步。

#### Scenario: Change selection while the lens stays free of overlays
- **WHEN** 同页正文及排版不变，连续拖动经过多个字符，使正文选区范围反复扩大、缩小
- **THEN** 每个呈现帧镜内只出现文字与有效竖线，无选区填充、高亮覆盖或手柄；正文范围继续变化，镜内由选区变化导致的选区重绘和重新截图次数为 0，可通过定向渲染计数或跟踪证据核验

#### Scenario: Refresh text for a new page without copying its selection
- **WHEN** 在支持连续选择的模式中，触摸跨到另一页或发生正文位置、内容变化
- **THEN** 镜内可更新对应文字取景，竖线对齐新有效端点，但不带入该页已有高亮或正在变化的选区；取消或切换文档后旧取景不覆盖新会话
