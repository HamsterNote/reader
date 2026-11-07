# Design

## Context

动机见 proposal.md。项目安装 OpenSpec 1.13.1，`openspec/config.yaml` 仅配置 spec-driven；未发现项目随附的 propose 命令或技能，按运行时提供的 openspec-propose 技能和 CLI 产物指令执行。本次为代码只读核对，未运行 UI 或真机复现。

| 路径      | 当前实现及约束                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout    | `EngineSelectionControls.tsx` 的 pdfTouch 路径在 body fixed portal 渲染 `PdfTouchSelectionHandle`。起点圆心在首矩形上缘外 10px，终点在末矩形下缘外 10px。按钮热区 40×40，视觉圆外径 20px、白边 2px，2×12px 连接线，整体 `drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))`，线先画、圆后画。 |
| Text      | `IntermediateDocumentTextViewer.tsx` 只对 isPdf 指定 `PdfTextHandle`。其按源端点和当前分页列过滤，随后调用 scale=1 的 `RangeHandle`，未使用 Layout 的白边、竖线及大热区。                                                                                                              |
| Text 手势 | `RangeHandle` 将同一 button 的 pointerdown 交给 `useRangeHandleDrag` 和 selection 库；前者根据抓取点到按钮中心的偏差纠正 pointermove，并驱动放大镜。依赖按钮元数据和 document 捕获匹配，替换为多层 DOM 时必须保持兼容。                                                                |

主规格中两个旧场景明确要求 Text 圆柄不变，本次 delta 完整保留所在 requirement 并只替换这两处限制及 Text 场景描述，新增统一手柄契约。Layout 的跨页镜片、自动滚动及 Text 分页约束继续有效。

## Goals / Non-Goals

**Goals:** PDF 两模式复用同一视觉控件，在 Text 适配层隔离布局、源端点与 selection 库事件协议，确保外观改变后热区抓取和保存仍正确。

**Non-Goals:** 不把 Layout 的 DOM Range 拖动事务、跨页恢复、自动滚动或专用镜片迁移到 Text；不重写 selection 包，不调整全局 RangeHandle 默认样式，不改 EPUB、矩形选择、公开属性或标注结构。

## Decisions

### 1. 复用 PDF 专用视觉组件，默认共享圆柄保持不变

在 `PdfTextHandle` 中使用 `PdfTouchSelectionHandle` 作为 PDF Text 专用视觉。必要时为该组件补充内部定位适配，但 Layout 的 fixed portal 行为和视觉常量不变。保留原按钮 ref、className、aria-label、range/rect 标识，以及拖选所需的端点元数据；内部圆点和线均不接受 pointer 命中，事件由外层透明 button 接收。

替代方案：给 RangeHandle 全局加白边和热区会影响非 PDF 与矩形选择；复制一份 PDF 样式会使两模式再次分叉，均不采用。组件名称含 Touch 不限制 Text 既有鼠标操作。

### 2. 视觉几何和库端点坐标分别适配

保留 PdfTextHandle 的源端点判定和 `pdfTextAnchorColumn` 过滤，先判断端点是否属于当前列，再计算可见端点所在行的实际矩形。草稿从 activeRange、已有高亮从对应 item 取得，不能使用裁剪选区的当前列首末矩形冒充源端点。

Text 适配器在原叠层坐标系定位热区圆心：起点对应行左端、上缘外 10 CSS px；终点对应行右端、下缘外 10 CSS px。位置转换沿用现有 px/percent 单位，浮点值不取整；如测量使用 client rect，需减去叠层原点并按实际变换换算，不能把 Layout 的 fixed 坐标直接放到 Text 绝对定位层。正常 Text scale=1；重排后重新计算，不套 PDF 页面缩放。

将“真实库端点坐标/合法文字命中点”与“视觉圆心”分离。PDF Text 专用拖动配置在 pointerdown 冻结抓取点相对库期望端点的偏移，在 move 和最后有效释放位置使用同一纠偏，并让放大镜读取对应文字命中点。库期望坐标以传入 handle.position、端点行矩形和现有拖动测试为依据，不能默认按钮中心仍在文字行内。可在 useRangeHandleDrag 添加内部可选配置；未传配置时保持原坐标纠偏与命中规则。

命中有效性应使用纠偏后文字位置，而非外置圆心或热区原始指针位置，否则从圆外热区抓取会被现有 isPointOnSelectionText 拒绝。只对当前 PDF Text 配置启用新规则；保持同一 ownerDocument/reader 的事件归属、pointerId、捕获清理和防递归机制，不重复启动库会话。视觉 span 的 data 标识不能让现有按钮匹配失效；如复用按钮匹配协议，须在外层 button 保留等价标识。

替代方案：仅替换 CSS 会将圆心移动和 40px 按钮中心误当库端点，造成跳选；直接调用 Layout 控制器则改变 Text 页内选择契约。均不采用。

### 3. 保留两条选择引擎和颜色来源

Text 仍使用 HamsterSelection linkedMode 的 onPointerDown、activeRange/item 和既有更新/确认回调；草稿和历史高亮继续使用原颜色来源，视觉通过已有不透明颜色转换去除 alpha。不得因统一手柄而以当前底栏色覆盖历史高亮颜色。维持 Text 自有放大镜开关、正文锁滚动、系统选择抑制及分页策略，边缘拖动不启动 Layout 的自动滚动。

替代方案：把整个 Text 选区切换为 Layout DOM Range 会扩大范围并增加字符映射风险，且本需求只需要手柄一致，因此不采用。

### 4. Text 在当前 selection 容器中解析 runtime DOM 几何

验收发现重排后的可视文本会插入源流中不存在的空白。`linkedData` 的 runtime 端点是当前 `selectionId` 内容中的 DOM offset，不能直接拿 `data-selection-start-offset` 当 canonical offset 查 span。Text 手柄必须在所属 selection 容器中用 DOM offset 定位字符矩形；持久化时仍由既有 canonicalize 流程转换，存储格式不变。

第三轮复查发现上述 runtime 契约此前没有完整实现：`combinePdfTextSelectionGroups` 对普通单条高亮提前返回，只有分组高亮才转换端点。背景按 canonical offset 生成，手柄却把未转换的 offset 当 DOM offset，所以重排后两者落在不同字符。删除单条高亮的例外，让所有持久化高亮在进入 selection runtime 前转换一次；草稿本来就是 DOM offset，保持原路径。转换每次使用当前所属页面 DOM，不缓存 PDF 版面坐标。

`pdfTextDomOffsetRect` 专门用于 runtime 端点，`pdfTextAnchorRect` 继续按源 span 解析分页/书签的 canonical anchor；高亮导航也从存储范围取源锚点。不得为了修手柄改变分页锚点语义。可见列判定与手柄位置使用同一个实测字符矩形。

### 5. 桌面 PDF Layout 只共享视觉和抓取纠偏

`EngineDocumentViewer` 对 PDF source 显式启用 `pdfCustomHandles`，使桌面鼠标也渲染 `PdfTouchSelectionHandle`、起上终下位置与 40×40 热区。`pdfTouch` 仍为 false：桌面继续使用 caret 命中和原生 Selection 更新/确认，仅复用抓取偏移，不启用触摸专用预览事务、自动滚动或镜片实现。EPUB、矩形和非 PDF 默认手柄不变。

## Risks / Trade-offs

- [热区或竖线被分页容器裁剪] → 在真实浏览器检查每列首末行、窄屏和可视边缘；如需调整叠层裁剪，仅限定 PDF 手柄，不能开放正文滚动或伪造离屏端点。
- [视觉外移导致命中错位或松手回弹] → 覆盖中心/边缘/热区角落、首个移动不跳选、跨行、快速释放，验证最终字符锚点和预览一致；保留原事务只提交一次。
- [共享 hook 影响其他格式] → 新配置默认关闭，回归原 RangeHandle、矩形、多个 reader 实例及 EPUB 选择。
- [DOM 测试无法验证系统手柄和实际阴影] → 自动化验证行为和计算尺寸，再在 iOS/Android WebView 同文档两模式截图对照；未完成设备验收不得声称已修复。

## Migration Plan

无数据、依赖或公共 API 迁移。后续由实现角色执行 tasks，局部验证通过后构建 WebView 资源并按验收矩阵复验。回退本次 PDF Text 视觉适配及显式启用配置即可，已有标注继续可读。此阶段不执行 apply、构建、部署或编码。

## Open Questions

无阻断问题。合理假设：以仓库当前 Layout 自绘手柄作为用户所指的外观基准；统一涵盖草稿和已选高亮，并包含与现有 Layout 一致的透明热区。这些是本提案的范围解释，未作为用户逐项确认的细节。视觉一致不意味着复制 Layout 的自动滚动或镜片内容。
