# reader-data-compatibility Specification

## Purpose

约束阅读引擎与应用宿主迁移时的公共数据和交互兼容性，使已有消费者与历史文件标注继续可用，并通过双向读写及固定交互矩阵避免格式不变但定位失效的隐性数据损坏。

## Requirements

### Requirement: Persisted annotation round trip
系统 MUST 读取现有 v2/v3/v4 高亮数据，保留范围、矩形、绘图及其稳定 ID、createdAt（若源数据具有）、端点、坐标单位、样式和评论关联。升级后系统 MUST 只向新的版本化存储键写入新格式，绘图内容使用新版 EditorDocument；首次打开只有旧数据的文件时 SHALL 调用 painting 提供的一次性迁移能力，而非在 reader 内映射旧笔迹。原始旧 blob MUST 原样保留，后续新增、编辑、删除、清空、导入及导出均不得改写、投影或删除该 blob。运行时专有定位标识、显示变换及派生渲染缓存不得泄露到标注的公共持久化数据。

#### Scenario: Read legacy and write current data
- **WHEN** 同一文件首次加载合法 v2、v3 或 v4 历史样本，新键不存在
- **THEN** 范围和矩形按既有规则恢复，绘图交由库迁移，新格式落入独立键；旧 blob 字节内容保持不变，源标注位置、样式、顺序及关联保持一致；v2/v3 缺少绘图时产生空的新绘图集合

#### Scenario: New annotations use the new authoritative format
- **WHEN** 在升级后创建跨页高亮、矩形或绘图并保存，再由新版重开
- **THEN** 从新键恢复最新数据，使用稳定公开页面 ID；仅新键被更新，原旧 blob 不变，旧版只能显示升级前状态而不会获得新增标注

#### Scenario: New annotations remain backward readable
- **WHEN** 升级后创建跨页高亮、矩形或绘图并保存，然后使用旧版读入器打开同一文件的旧记录
- **THEN** 旧读入器仍能读取未被修改的升级前 v4 数据，但不再保证读到新增标注；新增标注只在新版新键中恢复，此场景的旧版可读保证明确收窄为升级前快照可读

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
系统 SHALL 保留既有 Web 库入口、style.css、非绘图公开数据与回调语义，以及非 EPUB/PDF 文档的原有阅读路径。绘图公开类型和回调负载 MUST 统一为新版文档与控制模型，调用方 SHALL 按版本升级说明迁移，不再承诺旧 DrawingValue 类型和旧控制器 API 兼容。所有共享绘图层消费者 MUST 在同一 change 内转用新版绘图能力；reader 不得保留旧绘图组件、旧模型适配实现或旧渲染兜底。

#### Scenario: Existing Web consumer imports the library
- **WHEN** 既有消费者导入库入口和 style.css，并按新版绘图契约更新绘图参数和回调
- **THEN** 能构建、显示并接收新文档回调；非绘图参数与回调保持原有语义，不要求传入引擎私有定位标识

#### Scenario: Other formats are opened
- **WHEN** 打开基线支持的 EPUB、TXT、Markdown、DOCX 或图片并使用适用的绘图或页面预览能力
- **THEN** 继续使用原有可用阅读与标注行为，绘图及预览均走同一新版路径，无旧组件或悬空旧 API 引用

### Requirement: New format recovery and migration are idempotent
系统 MUST 以完整、有效的新键为唯一权威数据源。仅新键不存在时可启动旧数据迁移；空绘图集合也属于有效的新数据。迁移 SHALL 按文件完成一次完整写入，失败不得留下可被视为成功的新数据。重复打开、重试或重复消息 MUST 不重复创建笔迹或改变稳定 ID。新键损坏或版本不支持时 MUST 明确提示恢复错误并保留原数据，不得自动退回旧 blob 后覆盖新数据。

#### Scenario: Reopen or retry an interrupted migration
- **WHEN** 同一旧文件重复打开，或在新键提交前失败后重试迁移
- **THEN** 成功后得到同一组稳定笔迹 ID、样式及页面坐标，无重复对象；原旧 blob 不变，不出现半页迁移成功的混合状态

#### Scenario: Deleted drawings never reappear
- **WHEN** 用户完成迁移后删除该页全部笔迹或清空全部标注，保存并重开
- **THEN** 有效新键中的空集合被恢复，不再用旧 blob 补齐或迁移，已删除笔迹不复活

#### Scenario: Corrupt or unsupported new data is encountered
- **WHEN** 新键存在但 JSON 损坏、文档校验失败或格式版本不受支持
- **THEN** 提示可重试或显式恢复的错误，既不将其当成新键缺失，也不静默回退、清空或覆盖任何已存数据

#### Scenario: A legacy object cannot be migrated
- **WHEN** painting 返回某个历史绘图无法迁移或不能保证保真
- **THEN** reader 显示明确失败结果，停止该文件的迁移提交并保留旧数据；不得自行补写旧模型映射或静默丢弃该对象

### Requirement: Reader delegates drawing compatibility to the published library
reader MUST 仅调用正式发布绘图库的迁移能力和页面锚定能力；对旧绘图类型的识别、对象映射、迁移版本处理和绘图坐标投影 MUST 由库负责。reader 可执行新旧存储键选择、读取旧容器并将绘图原值传入迁移 API，以及处理成功/失败结果，但不得包含旧笔迹模型分支、反向投影、降级双写或对不同 PDF 变换的自定义绘图换算。

#### Scenario: Integrate the released drawing capabilities
- **WHEN** 审查 reader 最终依赖与调用路径，并使用旧格式样本打开 PDF
- **THEN** 依赖为正式发布的确定版本，无 git ref、file/link/workspace 替代；reader 直接消费库的迁移结果和页锚定能力，源码与构建产物均无旧绘图实现兜底

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

### Requirement: Viewport content determines persisted reading position
系统 MUST 以实际正文视口的可见内容确定进度。视口内有可定位非空白文字时 SHALL 锚定最上方可见行的首个可见源字符，包括部分可见行；同一行按既有阅读顺序判定。仅当文字提取已完成且视口无可定位文字时，系统 MUST 保存目标页及视口顶端在该页中的纵向百分比；不得使用全书滚动比例或选取视口之外的文字。页面/文字映射尚未就绪、零尺寸或加载失败 MUST 保留最后稳定位置，不视为无文字。

#### Scenario: Image above visible text
- **WHEN** 视口顶部是图片，下部有一行可定位文字
- **THEN** 保存该行首个可见源字符，不保存图片比例或页面首字

#### Scenario: No text inside a mixed page viewport
- **WHEN** 视口仅展示文字页面中的插图/空白区域，其他文字位于视口外
- **THEN** 保存目标页及 clamp((视口顶端 - 显示页顶端) / 显示页高度 * 100, 0, 100)，页间距不计入页高度；分页逻辑页使用按阅读顺序纵向展开后的片段累计内容坐标和总高度；视口顶端位于页间隙时选择视口内下一允许页面

#### Scenario: Loading is not an empty viewport
- **WHEN** 重开时目标页或文字映射尚未就绪，或目标加载失败
- **THEN** 已保存进度不被临时页首、空值或比例 0 覆盖

### Requirement: Reading progress remains incrementally backward compatible
系统 SHALL 继续读取已有 Layout 文字/百分比书签、Text 页码/文字进度以及旧布局变换。当前模式的有效进度 MUST 优先于旧变换锚点；Text 无 anchor 时 SHALL 使用可选页内比例，缺少比例的旧页码 SHALL 恢复页首。系统 MUST 保持原有信封字段优先级、存储键和旧原件；新比例仅作可选字段扩展，不能要求批量迁移。恢复读取不得自行回写降级位置或丢弃无关标注和阅读配置。

#### Scenario: Legacy progress samples are reopened
- **WHEN** 分别打开仅有 layoutReadingProgress、仅有 textReadingProgress.currentPageNumber、仅有 virtualPaper.anchor 或旧布局 x/y/scale 的记录
- **THEN** 前三者按当前模式及既有回退语义恢复，纯变换在支持该变换的原布局继续恢复；不伪造缺失精度，用户有效移动后才写当前进度

#### Scenario: Current and legacy positions disagree
- **WHEN** Layout 同时存在有效 layoutReadingProgress 和不同位置的 virtualPaper.anchor，或信封 readerData 与独立 progress 包含同名字段
- **THEN** 前者使用 layoutReadingProgress，后者沿用 readerData 同名字段优先，重复打开结果一致

#### Scenario: Invalid or unavailable historic anchor
- **WHEN** 历史锚点在目标加载完成后仍不能定位，或比例不是有限数值
- **THEN** 采用同记录有效比例或有效源页页首作显示回退，提示不能精确恢复并保留原记录；无任何有效位置才显示默认首个可读页，不绑定到相似文字；有限越界比例夹至 0..100

#### Scenario: Save progress alongside another edit
- **WHEN** 进度等待提交期间用户新增高亮、绘图或书签，然后进度被保存并重开
- **THEN** 最新进度与最新已提交编辑均被保留，未改模式的进度和其他阅读配置不被旧快照覆盖

### Requirement: Existing page and data semantics remain compatible

系统 MUST 继续使用一基原 PDF 页号及既有 `hiddenPages` 数字 / `page-N` 公共格式，不要求宿主迁移。隐藏页在恢复确认前 MUST 保持不可导航，恢复后 SHALL 按既有页范围、裁切、标注和进度规则参与阅读；折叠入口、模态框选择及撤销本身 MUST NOT 创建标注历史或改写书签、进度、裁切和标注。

#### Scenario: Reopen historic hidden-page data

- **WHEN** 用户打开同时含数字页码和 `page-N` 的历史数据，批量恢复其中一页后保存并重开
- **THEN** 新旧标识均正确归一化，只有确认恢复的页面退出隐藏集合，其他字段与原页号语义保持不变

#### Scenario: Navigate while editing

- **WHEN** 用户在编辑态使用上一页、下一页、页码或书签定位，目标中包含仍隐藏的页面
- **THEN** 导航继续跳过仍隐藏页，不跳到折叠入口；只有已确认恢复的页面重新成为有效目标，当前可见阅读位置不因打开模态框而改变

### Requirement: Hidden page restoration preserves the latest reader data

系统 MUST 仅在确认时通过一次 `onDataChange` 原子移除所选原页的全部数字 / `page-N` 隐藏项，保留未选项、范围外项及其他最新 `ReaderData`。取消、关闭和 Escape MUST 不提交恢复。确认后 5 秒内的一次撤销 MUST 只还原确认前的隐藏页集合，合并其他最新阅读数据，不进入标注历史；受控回显不得重复提交。新隐藏或恢复、退出编辑、外部替换隐藏集合或切书 MUST 使旧撤销失效。

#### Scenario: Confirm aliases and preserve unrelated entries

- **WHEN** 当前隐藏数据同时包含 `4`、`page-4`、未选页及范围外项，用户选择第 4 页并确认
- **THEN** 仅发出一次数据更新，移除 `4` 与 `page-4`，其余隐藏项保持原顺序，最新书签、进度、裁切和标注保持不变，宿主回显不产生第二次恢复

#### Scenario: Undo after another reader field changes

- **WHEN** 恢复确认后宿主更新其他阅读字段，用户在 5 秒内撤销恢复
- **THEN** 确认前的隐藏页集合被恢复一次，其他字段保留最新值，不覆盖宿主更新，也不增加标注历史

#### Scenario: Expired or replaced restoration session

- **WHEN** 确认已超过 5 秒，或发生新的隐藏/恢复、退出编辑、外部替换隐藏集合或切换文档
- **THEN** 旧撤销不可用，迟到操作不得覆盖当前文档的隐藏页或其他阅读数据

### Requirement: 按栏文件切换与位置隔离

Reader SHALL 通过 painting 0.8.4 的公开 toolbar 接收可选文件列表与 pane layout，默认目录入口打开本库既有视图；旧 bottomBar 插槽保持兼容。文件格式能力 SHALL 以宿主 resolvedFormat 与已注册适配器匹配，支持格式在同内容容器内切换，不支持但宿主支持时异步接管。两者均不支持 SHALL 保留当前文档并报错。

切换 MUST 等待稳定位置采集、原进度队列冲刷及宿主持久化 ACK。保存失败 MUST NOT 卸载；释放后加载或恢复失败 SHALL 自动调用宿主重载回退，并在回退失败时允许重试或从存储重开原文件。位置仅按 storageId/path/paneId 缓存轻量切片，恢复布局就绪前不得发布初始化零进度。共享源引用最后释放才销毁，单/双栏最多一/两个不同活动文档；旧 session/request 不得污染新文档。

#### Scenario: 同容器往返并恢复
- **WHEN** 当前实例注册 PDF/EPUB 且 A.pdf 第8页页内位置切到 B.epub 后返回
- **THEN** 外容器与页面导航计数不变，旧无引用引擎释放，A 按本栏轻量位置在布局就绪后恢复

#### Scenario: 保存拒绝与加载失败
- **WHEN** 保存 ACK 被拒绝，或释放后目标加载/恢复失败
- **THEN** 前者保持原文档和当前项，后者只调用一次宿主重载，保留持久数据并提供失败重试

#### Scenario: 首次打开与往返回到 PDF 文字模式
- **WHEN** 持久数据为 PDF 文字模式，首次打开或切到 EPUB 后返回 PDF
- **THEN** 等目标页与字体加载、分页测量及原位置变换完成后才通过统一 ready 通知提交当前文件；挂载不得提前确认，目标页或布局失败通过统一 error 通知走宿主重载，不停留在 restoring

#### Scenario: 不同存储与双栏
- **WHEN** 两栏打开同一文件或不同存储下的同名文件
- **THEN** 每栏位置、引擎和历史独立，源引用按规范身份共享，只有活动栏写入持久最近位置
