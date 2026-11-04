# Spec Delta

## ADDED Requirements

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
- **THEN** 40×40 屏幕像素热区触发拖动且不跳变，视觉圆仍为 20px，最终手柄与保存的源端点一致；热区之外不拦截正文指针事件，Text 圆柄不改变

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
- **THEN** 20px 圆柄有恒定 2px 白边，圆点与竖线有整体阴影；起点圆点在行上缘外、终点在下缘外，命中按行内位置纠偏，PDF Text 圆柄视觉不随之改变

### Requirement: PDF magnifier and continuous touch selection

PDF Layout 镜片 MUST 位于自定义手柄之上且只显示文字与高亮色插入竖线，跨页与滚动后仍对应当前源端点。手柄竖线 MUST 绘制在圆点后方，白圈完整。拖动 MUST 允许越过固定端并交换起止角色；活动选择 SHALL 在正常滚动后保留。手指接近阅读器顶部/底部 MUST 启动按距离加速的自动滚动，每帧用当前手指位置更新端点，释放/取消时立即停止；Text 与 EPUB 既有行为保持不变。

#### Scenario: Cross a page with a text-only lens
- **WHEN** 用户拖动 PDF 手柄跨页或在页间隙取景
- **THEN** 镜片读取当前位置文字层，排除所有高亮与手柄，当前字符端点显示高亮色竖线；镜片与圆柄不发生层级反转

#### Scenario: Reverse an endpoint across its anchor
- **WHEN** PDF 起点拖过终点或终点拖过起点，随后再拖回来并释放
- **THEN** 保留固定字符端点，起止角色随移动端交换，预览和最终保存范围一致，不丢失捕获

#### Scenario: Accelerate scrolling at the viewport edge
- **WHEN** 用户保持手指在阅读容器上下边缘，并逐渐接近边缘
- **THEN** 滚动速度随距离缩短增大，手指静止时仍更新跨页范围；松手或取消立即停止，普通滚动不清除活动选区，原生 Selection 仍为空

#### Scenario: Continue beyond the PDF.js page cache
- **WHEN** 选择从第 1 页持续拖动到第 12 页，PDF.js 已回收起始页画布和文字层
- **THEN** 适配层保留并恢复当前会话需要的文字层及真实字符端点，拖动不中断，确认结果包含中间页文字与矩形；清除会话后释放保留文字并恢复重建的 PDF.js 文字层，不阻止画布缓存回收
