# Spec Delta

## MODIFIED Requirements

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
