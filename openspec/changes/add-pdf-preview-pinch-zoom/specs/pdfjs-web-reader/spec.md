# Spec Delta

## ADDED Requirements

### Requirement: PDF Layout pinch scale and focal point

PDF Layout MUST 提供 reader 自研双指缩放，仅使用 PDF.js 缩放渲染能力。一次连续操作中，1× SHALL 为当前文档、视口及裁切设置下的常规基准比例，默认使用现有默认值或适宽结果。已显式生效的宿主缩放值作为新的基准。手势倍率 SHALL 等于起手倍率乘以当前触点间距与起手间距之比，夹取至 1×–3×，倍率容差为 0.02。手势 SHALL 将起手中点下的原页点跟随实时中点，在可滚动区间内误差至多 4 CSS px。中点落在页间距或空白时采用最近的可见允许页面和最近页内点，同距按阅读顺序。达到边界时按可用轴夹取，缩放不得改变浏览器、宿主或其他栏的视口比例。

#### Scenario: Pinch to a clamped scale while moving the midpoint
- **WHEN** 用户从 1× 开始，将触点间距从 80 增到 160 CSS px，并将中点平移 30×20 CSS px，且两轴均可滚动
- **THEN** PDF 到达 2×，同一原页点跟随中点，释放后仍在目标位置。继续扩大至超过 3× 的输入则稳定在 3×，从 1× 缩小则保持 1×

#### Scenario: Keep source coordinates on rotated or cropped pages
- **WHEN** 在旋转或裁切页面上围绕可见文字或标注双指缩放并释放
- **THEN** 同一原页点保持可定位，文字、标注及绘图和页面对齐，继续满足既有源坐标与叠层几何契约

### Requirement: PDF Layout pan, rebound and baseline landing

倍率高于 1× 时，阅读态的单指正文拖动和双指中点位移 SHALL 平移当前栏。可用范围由内容边界和正文安全视口决定。无可用范围的轴按基准对齐且不产生超界。倍率高于 1× 且可平移的轴，拖过边界 SHALL 按越界拖动距离的三分之一产生受阻位移，每轴至多 48 CSS px。释放后 SHALL 在 250 ms 内回到最近合法边界，允许 2 CSS px 误差。1× 时 SHALL 恢复基准横向对齐和普通纵向滚动。缩回 1× 时 SHALL 保留最后一帧有效中点对应的原页和原页纵向锚点，使该点的 Y 回到该帧的安全视口 Y，稳定误差至多 4 CSS px。受首尾限制时 SHALL 夹取到最近合法位置，原页仍可见。

#### Scenario: Pan within the document and release beyond its edge
- **WHEN** 用户在 2× 下从正文空白单指拖动，或用两根手指保持间距移动中点，然后在可滚动轴拖过内容边界并释放
- **THEN** 内区画面跟随触点位移，双指移动保持倍率，超过边界时有受阻位移并在规定时间内回到合法范围。手势不发出显式相邻页导航

#### Scenario: Return from a panned page to baseline
- **WHEN** 用户在 2× 平移至原页 2 的中段，围绕靠近正文中部的标记捏回 1×
- **THEN** 页面恢复基准横向对齐，同一原页标记仍对齐最终中点 Y，首尾受限时使用夹取结果。后续独立单指可正常纵向滚动

### Requirement: PDF Layout gesture ownership and cleanup

双指手势 SHALL 只接管起于同一已就绪 PDF Layout 正文栏的触摸。已接管的选区手柄和已启动的侧栏或宿主拖拽 SHALL 优先完成当前序列。其余情况下，第二指进入同一正文栏后，双指 SHALL 优先于待定长按、正文拖动、点击、滑动导航或尚未提交的绘图和矩形工具，并取消待定动作。已存在的选区和已确认的标注 SHALL 保留。无双指接管的序列遵循既有控件、选区、绘图和链接规则。双指结束后剩余触点 SHALL 被消费至全部抬起，期间不得触发点击、绘制、选区、拖拽或翻页。第三指 SHALL 不替换原触点，也不启动其他动作。系统取消 SHALL 回到手势开始前的稳定倍率及位置。文档、模式或栏位销毁时 SHALL 清理触点、回弹与排队渲染。PDF Text 的分区翻页、其他格式及独立原生 PDF 浏览器沿用既有交互。

#### Scenario: Claim two touches without committing an unrelated action
- **WHEN** 第二指在正文长按成立前加入，或在正文平移、未提交绘图或矩形创建期间加入，且落在同一 PDF 栏
- **THEN** 双指可缩放，待定动作取消，无笔迹、矩形、选区或导航误提交。留下一指滑动和抬起仍无额外动作

#### Scenario: Respect an active drag
- **WHEN** 第二指加入时已有选区手柄、侧栏或宿主拖拽接管
- **THEN** 原拖拽继续处理所属触点，本序列的 PDF 比例不变

#### Scenario: Cancel and isolate the gesture
- **WHEN** 在双栏的一栏开始缩放，然后系统取消手势、切换模式或更换文档
- **THEN** 另一栏不发生缩放。系统取消恢复起手状态，换视图后旧手势不再更新界面。下一次独立触摸可按当前模式处理
