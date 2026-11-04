# Spec Delta

## ADDED Requirements

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
