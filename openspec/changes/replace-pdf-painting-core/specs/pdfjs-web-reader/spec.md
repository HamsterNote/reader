# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
