# reader-data-compatibility Specification

## Purpose

约束阅读引擎与应用宿主迁移时的公共数据和交互兼容性，使已有消费者与历史文件标注继续可用，并通过双向读写及固定交互矩阵避免格式不变但定位失效的隐性数据损坏。

## Requirements

### Requirement: Persisted annotation round trip
系统 MUST 读取现有 v2/v3/v4 高亮数据并保持现有 v4 写入格式，保留范围、矩形、绘图及其 ID、createdAt、端点、坐标单位、样式和评论关联。运行时专有定位标识不得泄露到公共数据或回调。

#### Scenario: Read legacy and write current data
- **WHEN** 同一文件加载合法 v2、v3 或 v4 历史样本后保存
- **THEN** 使用既有兼容规则补齐缺省字段，标注内容及定位不丢失，输出可由旧 v4 读入器读取

#### Scenario: New annotations remain backward readable
- **WHEN** 在新引擎创建跨页高亮或矩形并保存
- **THEN** 输出仍使用稳定公开页面 ID 和旧字段结构，旧读入器可读取且同文件重新打开定位一致

### Requirement: Preserve interaction contracts
系统 SHALL 保留既有适用的高亮新增、激活、调整、样式、删除、跳转、拖拽回调、撤销重做、矩形、绘图、评论关联，以及书签、进度、裁切和隐藏页；鼠标与触摸各遵循现有 UI 契约。

#### Scenario: Complete annotation workflow
- **WHEN** 用户在 EPUB 或 PDF 执行基线支持的标注流程并重开文件
- **THEN** 控件和回调语义保持一致，已确认操作按既有历史规则可撤销重做，持久化内容与界面一致

#### Scenario: Native touch selection
- **WHEN** 用户在移动设备的 EPUB 或 PDF Layout 长按选字并激活已有高亮
- **THEN** 使用原生文字选择手柄及既有 Popover 流程，不与滚动或矩形工具产生重复操作

#### Scenario: PDF Text touch selection
- **WHEN** 用户在移动设备的 PDF Text 长按选字或调整已有高亮
- **THEN** 使用自绘圆形端点手柄及既有 Popover 流程；只显示当前可视列内的源端点，拖动保留原页字符映射，不触发正文滚动、自动翻页或系统编辑菜单

### Requirement: Existing consumers and formats remain usable
系统 SHALL 保留现有 Web 库入口、公开数据类型与回调契约，以及非 EPUB/PDF 文档的原有阅读路径。

#### Scenario: Existing Web consumer imports the library
- **WHEN** 既有消费者导入库入口和 style.css，并传入原有 Reader 数据
- **THEN** 能构建、显示并接收兼容回调，不要求传入引擎专有定位字段

#### Scenario: Other formats are opened
- **WHEN** 打开基线支持的 TXT、Markdown、DOCX 或图片
- **THEN** 继续使用原有可用阅读与标注行为，不受 EPUB/PDF 引擎替换影响

### Requirement: Unified committed drawing history
启用标注历史时，系统 MUST 将绘图与文字高亮、矩形纳入当前文件同一条按提交时序排列的撤销／重做历史，并通过已有撤销／重做入口和可用状态暴露。系统 MUST 保存所有页面的完整绘图内容，回放不得改变无关页面或标注。历史关闭时 SHALL 保持原有绘图和保存能力且不维护可用历史。

#### Scenario: Mixed annotations across pages
- **WHEN** 在第 1 页画 A、创建高亮 H，再在第 2 页画 B，然后连续撤销三次、重做三次
- **THEN** 依次移除 B、H、A，再依次恢复 A、H、B；对象 ID、样式、坐标、内容、顺序及原有关联保留，各步状态和历史计数正确

#### Scenario: Drawing history disabled
- **WHEN** 未启用标注历史并完成一笔绘图
- **THEN** 绘图正常显示及保存，不新增可撤销记录，撤销／重做返回未应用

### Requirement: Atomic drawing edit granularity
系统 MUST 将一次成功提交的完整手绘 stroke 或形状创建记为一条历史，不按采样点或渲染帧拆分。既有入口支持的对象编辑（包括整笔重绘）、删除、擦除及当前页绘图清空 MUST 按一次用户提交记为一条历史；一次擦除手势影响多个对象时也只记一条，撤销恢复全部受影响内容。系统 SHALL 区分修改文档的整笔重绘与纯显示重渲染，后者不得入栈。本要求不增加现有界面没有的工具或改变既有文字／矩形 clear 命令的作用范围。

#### Scenario: Complete stroke and cancelled stroke
- **WHEN** 用户落笔并多次移动后抬笔，再开始另一笔但取消或因多指介入取消
- **THEN** 第一笔只增加一个历史项，第二笔不改变已提交内容或历史

#### Scenario: Object edit erase and page clear
- **WHEN** 通过既有编辑入口依次提交一次对象重绘、一次擦除多个对象及一次非空当前页绘图清空
- **THEN** 每次提交各占一项；逐次撤销分别恢复清空前整页、擦除前所有受影响对象、重绘前对象；重做分别重现对应结果，其余页和文字／矩形保持不变

#### Scenario: Empty operations and visual updates
- **WHEN** 用户清空空页、未擦中内容、设置下一笔颜色／粗细、缩放、翻页或触发显示重渲染
- **THEN** 不创建绘图历史，不触发绘图内容保存，不清除已有重做分支

### Requirement: Redo branch invalidation and replay isolation
系统 MUST 在撤销后成功提交任意有效的新标注编辑时丢弃整个旧重做分支，包括其他页面或其他标注类型的未来记录。系统 MUST 保证一次撤销／重做只移动一个历史项，回放、受控回显和保存确认不得作为新编辑再次入栈。正在输入时调用历史命令 MUST 先取消未提交输入，再处理最近已提交项；无目标时返回未应用。

#### Scenario: New drawing replaces mixed future
- **WHEN** 撤销高亮和另一页笔迹后在当前页完成新笔迹 C
- **THEN** 旧高亮和笔迹均不可重做，可撤销 C；若 C 被取消则原重做分支仍可用

#### Scenario: Highlight replaces drawing future
- **WHEN** 撤销一笔绘图后成功新增高亮
- **THEN** 该绘图不可重做，下一次撤销作用于新高亮

#### Scenario: Replay during a pending gesture
- **WHEN** 用户在新一笔尚未提交时调用撤销，然后再收到该手势的结束事件及宿主回显
- **THEN** 未提交输入被取消，最近已提交操作被撤销一次，不出现幽灵笔迹或额外历史项

### Requirement: Controlled drawing history and durable results
系统 MUST 支持绘图的受控与非受控历史回放。受控消费者通过历史回调获得包含绘图的完整目标并原子回填；缺少必要历史回填处理器时系统 MUST 拒绝移动历史和修改内容，状态 MUST 不宣称相应操作可用。旧历史值未提供绘图字段时 SHALL 保留当前绘图，不将其解释为清空；显式空集合 SHALL 表示空绘图。一次有效绘图提交或回放 MUST 在宿主产生一次逻辑内容保存，保留整个文件其他数据；保存成功后重开恢复回放后的内容。历史记录本身不要求跨重启保存。

#### Scenario: Controlled replay and echoes
- **WHEN** 受控宿主收到撤销目标并回填完整标注值，随后保存确认并重开文件
- **THEN** 绘图与其他标注一致恢复到目标状态；回填和确认不重复入栈或产生第二次逻辑保存

#### Scenario: Missing controlled handler and legacy target
- **WHEN** 绘图由外部受控但未提供历史回填处理器，或旧调用方提交不含绘图字段的历史值
- **THEN** 前者撤销／重做不移动历史且返回未应用，相应状态不可用；后者保留已有绘图并保持原有非绘图行为

### Requirement: Drawing history document lifecycle
系统 MUST 在同文件翻页、绘图页卸载重挂及显示模式切换时保留已提交统一历史，不恢复未提交输入。切换文件或显式重置历史 MUST 以新文件／新基线清空过去与未来；与已提交目标相同的受控回显不重置历史，与其不同的外部内容替换 MUST 作为新基线重置，防止回放覆盖外部更新。

#### Scenario: Unmounted page replay
- **WHEN** 用户画笔迹后翻到其他页导致原页卸载，再撤销并返回原页
- **THEN** 原页笔迹已移除，重做可恢复，历史不依赖页面控制器是否挂载

#### Scenario: File switch and external replacement
- **WHEN** 用户从文件 A 切换到同样具有 page-1 的文件 B，或宿主对当前文件加载不同的外部绘图内容
- **THEN** 使用新的内容基线且历史为空，不能撤销回 A 或覆盖新外部内容；等值受控回显不触发该重置
