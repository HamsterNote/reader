# Spec Delta

## MODIFIED Requirements

### Requirement: Lens follows the finger continuously

镜片位置 MUST 跟随当前触摸点连续更新，不随字符命中的离散变化而停顿或逐字跳动。PDF 预览 / EPUB / PDF 纯文字 MUST 共用本规格的同一份放置描述。无边缘约束时镜心 SHALL 位于触摸点正上方，距离采用共享尺寸要求的中心距。可用区域 MUST 是阅读器当前可见区域与当前视口 safe area 安全矩形的交集，所有边界和触点 SHALL 换算到同一 CSS client 坐标系；宿主已将阅读器放在安全区域内时 MUST NOT 重复扣除安全区。

当上方候选镜片整体位于可用区域的纵向边界内时，系统 MUST 保持上方；只有上方放不下完整镜片时 SHALL 翻到下方，上方重新放得下时 SHALL 立即恢复上方。恰好贴住安全上边界仍算放得下，MUST NOT 用固定触点阈值、额外顶部留白或渲染面专属视觉位移提前翻转或越过安全边界。横向 SHALL 夹取到可用区域。上下均无法完整放置或可用区域小于镜片时 SHALL 夹取显示位置以尽可能完整可见；标准中心距和间隙的测量适用于未发生此类夹取的位置。夹取、翻转和 safe area 变化 MUST NOT 改变真实文字命中、采样点或逻辑端点。

#### Scenario: Move within one character interval
- **WHEN** 手指在同一个字符命中区间内连续小幅移动，且远离边缘
- **THEN** 镜片随每次已呈现的触摸位置移动，镜心横向对齐触摸点、纵向保持共享中心距，不等待端点字符改变，也不播放滞后追赶动画

#### Scenario: Flip only when the top cannot fit
- **WHEN** 手指从正文中部向顶部移动，直到上方无法容纳完整镜片，再回到可容纳的位置
- **THEN** 依次为上方、下方、上方；靠近底部但上方可放下时仍在上方，翻转前后实际选中的文字不因镜片位置改变

#### Scenario: Predict the safe area flip boundary in both viewports
- **WHEN** 三面分别在 375×667（模拟 safe area 上 20、下 34 CSS px）及 390×844（模拟上 47、下 34 CSS px）视口内拖动，阅读器覆盖视口，触点横向居中，依次经过安全上边界 T 加 115、114、113 CSS px 并返回
- **THEN** 依次显示上方、上方、下方，再按相同边界恢复上方；理论切换边界为触点 y = T + 76 + 38，实测误差不超过 1 CSS px；镜片圆形外框不得越过状态栏或刘海占据的安全上边界

#### Scenario: Recompute after viewport and container changes
- **WHEN** 阅读器非零偏移、视口缩小或横竖屏变化，或宿主已把阅读器下移到安全区内，用户继续触摸拖动
- **THEN** 使用最新可见区域与安全矩形的交集放置镜片，不重复扣除 safe area，不将 iframe 内坐标直接当作外层触点，镜片尽可能完整可见，翻转及夹取不移动实际采样和端点

#### Scenario: Constrain a lens in an exceptionally small viewport
- **WHEN** 上下候选镜片均无法完整放下，或可用宽度/高度小于镜片直径
- **THEN** 镜片优先受安全矩形和阅读器可见范围约束并尽可能完整可见，不放大可用区域、不缩放文字端点；该受限位置不作为标准中心距或触点间隙测量样本

## ADDED Requirements

### Requirement: Shared text magnifier dimensions and magnification

PDF 预览 / EPUB / PDF 纯文字 MUST 使用同一组共享参数作为文字镜片半径、直径、中心距与放大系数的唯一来源，纯文字面 MUST NOT 保留独立的一份数值。镜片圆形外框半径 SHALL 为 38 CSS px（允许实测 ±1），直径为 76 CSS px；无边缘夹取时镜心至触点距离 SHALL 为 76 CSS px（允许实测 ±2）。三面正文相对于各自当前屏幕正文的放大系数 SHALL 同为 2 倍；内容缩放和 DPR MUST NOT 改变镜片外框的 CSS 尺寸。半径 1cm、中心距 2cm SHALL 采用 1cm ≈ 38 CSS px 的产品换算，不要求设备物理厘米标定。

无边缘夹取时镜片靠触点一侧的外框至触点 SHALL 留有约 38 CSS px 可见间隙，不遮住触点。外框尺寸包含边框而不包含阴影；各面 MUST NOT 通过额外缩放、边框外扩或专属平移改变上述测量结果。文字取景及插入竖线 SHALL 使用同一尺寸和放大系数，保持字符间隙与竖线对齐；文字手柄以外的矩形快照工具不适用该尺寸变更。

#### Scenario: Measure all three surfaces using one standard
- **WHEN** 在两个指定视口、DPR 1/2/3、PDF 内容缩放 50%/100%/200% 下，分别对三面的草稿与已有高亮触摸拖动起止手柄，在无边缘夹取处测量最终圆形外框和触点
- **THEN** 半径为 38±1 CSS px，镜心距触点为 76±2 CSS px，靠触点一侧间隙约 38 CSS px，三面同一标准；检索参数定义与消费链路可证明半径、中心距、倍率来自同一组共享来源，纯文字面没有独立参数副本

#### Scenario: Compare actual text magnification and insertion alignment
- **WHEN** 在各面显示已知屏幕字符宽度/行高的正文，将同一字符取入镜片并移动到下一字符间隙
- **THEN** 镜内对应宽度/行高均为该面当前屏幕正文的 2 倍（几何测量允许 1 CSS px 舍入误差），不存在纯文字的额外倍率；插入线始终对齐命中的字符间隙，位置离散切换且颜色仍遵循本共享规格

#### Scenario: Preserve the drag lifecycle with the larger lens
- **WHEN** 三面分别对草稿和已有高亮拖动、释放、取消及确认，并在 EPUB WebKit 完成长按初始选字后的第一次手柄拖动
- **THEN** 拖动中可见手柄和正文范围跟随实际触点，释放后有效范围不回退，取消和确认遵循各格式已有提交规则；结束会话镜片关闭，无迟到镜片、重复确认或旧端点覆盖，mouse/pen 不显示镜片，镜内仍无选区覆盖
