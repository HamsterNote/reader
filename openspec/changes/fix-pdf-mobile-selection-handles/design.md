# Design

## Context

动机见 proposal.md。项目使用 OpenSpec 1.13.1 / spec-driven，无额外 context/rules，当前无活动 change。本设计基于 reader 当前代码的只读核对，尚未进行设备复现。

| 模式 | 已观察到的选择路径 | 手柄现状 |
| --- | --- | --- |
| PDF Layout | `Reader.tsx` → `EngineDocumentViewer.tsx` → `PdfDocumentViewer.tsx` 的 PDF.js textLayer；监听原生 selectionchange，通过 `serializePdfTextSelection` 产出公开字符端点 | 引擎传 `showHandles={mouse}`；`EngineSelectionControls.tsx` 的 pointerdown 对 touch 直接 return，故移动端依赖系统手柄 |
| PDF Text | `IntermediateDocumentTextViewer.tsx` → `HamsterSelection`（`@hamster-note/selection`）linkedMode → `PdfTextHandle` → `RangeHandle` / `useRangeHandleDrag` | 自绘 20px 圆柄、放大镜、源端点所在分页列校验；拖动由 selection 库处理 |

颜色：`Reader.tsx` 的 `resolvedHighlightColor` 同时用于底栏与高亮，来源为受控 highlightColor、内部选择或描边色的透明版本；selectionColor 独立下传。Layout 的 PdfDocumentViewer 只接 highlightColor，现有 pdf-viewer.scss 没有普遍覆盖原生选区颜色，仅对不连续分组选区抑制原生涂色。

已有规格的 PDF Text custom selection handles 场景仅覆盖 Text；新增 Layout 和两模式颜色 requirement，不改 Text 分页/禁止滚动契约。

## Goals / Non-Goals

**Goals:** 在 reader Web 层建立可取消、仅一次提交的 PDF 移动选择会话；两模式共享圆柄视觉与放大镜能力，保留各自文字命中和锚点转换；统一当前 PDF 预览颜色。

**Non-Goals:** 不改 PDF.js 源码、Expo 原生宿主或 selection 包；不重写 Text 分页、EPUB 手势、OCR 提取和标注数据格式；PDF Layout 支持拖动边缘自动滚动；Text 的禁止滚动/自动翻页契约保持不变。

## Decisions

### 1. 在 PDF Web 适配层接管移动选择手势

在 PdfDocumentViewer 的已加载 textLayer 内建立长按识别：单指主触点在文字命中处停留后创建初始词/字符范围，使用同一 text mapping 验证源锚点。长按阈值和移动容差沿用现有选择工具语义；这些数值为实现细节，不作为新产品约束。移动超过容差、第二指加入、切工具等取消候选；普通平移与双指缩放继续交给现有导航。

移动自定义路径用 reader 管理的 Range/公开端点状态驱动预览和序列化，不能以可见原生 Selection 作为唯一状态。对该路径限定 textLayer 的原生 user-select/touch-callout/contextmenu 抑制，自绘选区，避免浏览器产生第二套手柄；不能只隐藏系统选区颜色却仍依赖系统手柄。桌面仍可用原生 DOM Selection 获取初始范围。为 serializeSelection/confirmSelection 等现有 ref 方法补充读取活动受管范围的适配，必要时让内部序列化助手接收 Range，同时保持公开输出格式。

替代方案：只删除 showHandles 的 mouse 条件或 touch return，无法解决系统手柄共存、长按及默认手势争用；整页套用 HamsterSelection 会与 PDF.js 动态 textLayer 和既有引擎标注事务重复管理，因此不采用。

### 2. 复用 RangeHandle 视觉，保留引擎拖动事务

将 `RangeHandle` 的圆柄渲染与 selection 库专用坐标转发分离为共享视觉基础；Text 的 RangeHandle 继续使用原有库回调和 useRangeHandleDrag。Layout 的 EngineSelectionControls 通过适配器使用同一圆柄基础、20 CSS px 视觉直径、不透明同色手柄和相同可访问名称；复用 useRangeMagnifier，但不把 selection 库的合成 pointermove 纠偏接入 Layout 的直接 Range 拖动。

Layout 的 fixed portal 坐标取屏幕矩形，scale=1；Text 保留逆缩放逻辑。PdfTextHandle 包含分页列限制，不直接复用到 Layout。共享控件新增 PDF 专用触摸路径，EPUB 继续使用已有行为，避免共享组件默认语义改变。

拖动采用 pointer capture 和 document 收尾监听。固定另一端，使用圆心相对抓取点偏移修正命中坐标，仅接受当前文档允许页 textLayer 内可映射的文字节点；拒绝其他控件和失效节点；PDF 允许越过固定端并交换起止角色。每次移动只更新受管范围及预览；pointerup 通过既有 onUpdate/emitRange 提交一次：草稿仅更新待确认状态，已有高亮保留 ID、颜色、评论并提交范围更新。沿用 generation token 阻止旧会话异步回写。

真机复验修正：仅 PDF Layout 圆柄增加 2px 白边和覆盖圆点/竖线的 drop-shadow，fixed portal 保持 20px 屏幕直径。起点圆柄放在行上缘外、终点放在行下缘外；抓取点至文字行内中心的偏移用于命中和放大镜，不能继续以行下缘圆心减半行高推算。弹层预留圆柄空间。Text 共享圆柄的默认视觉与拖动逻辑保持原样。

偶发双柄复验：每端改为 40×40 透明方形 button 负责 pointer capture 与 touch-action:none，内部无 pointer 命中的 20px 圆保留白边/阴影，中心一致。fixed portal 已使用屏幕坐标，缩放因子为 1，不能再按 PDF viewport 比例反向缩放使屏幕尺寸翻倍。热区外的长按和滚动仍传到正文；热区内用于拖动，以实际抓取点至文字命中点的偏移纠正坐标。移动即发布同源几何，pointerup 重算最后坐标，保留最终预览直到父级接受新 Range；rAF 只跟随滚动/布局，不能在释放后回读旧 prop 把柄拉回。

原生 Selection 在触摸入口、显式 PDF touch 预览写入和选择事件中清空；selectstart 与 reader 工具栏的 user-select:none 提前阻止激活，避免原生范围从正文延伸到工具栏。受管 Range 独立 clone，复制事件直接写入文本，无需 addRange 到可见 textLayer。保护评论输入、contenteditable 和其他 reader 的原生选择，桌面及 EPUB 原生路径保留。真实 iOS 系统手柄是否消失由设备复验确认，DOM/CDP 断言不能替代系统 UI 截图。

取消、失焦、多指、工具或会话切换、页面节点回收时释放捕获、清理监听/放大镜；仍在原会话则回滚原始范围，已换会话则丢弃旧预览。通过 PDF text mapping 和 serializer 保留 page-N、字符偏移与现有跨页/不连续分组语义，不能用全局 DOM 文本长度替代源字符偏移。端点不可见时隐藏对应手柄，不夹到视口边缘；不把不连续范围误合并为包含间隙的大范围。

### 3. PDF 预览颜色单一来源

Reader 对 PDF Layout/Text 将 resolvedHighlightColor 同时传给选择预览和新高亮；底栏及受控调用方保持既有解析顺序。PDF 的 selectionColor 即使显式传入不同颜色也不覆盖底栏色，非 PDF 调用保留原行为，在属性文档/发布说明中说明该行为变化。

Layout 为受管选区叠层和桌面原生 ::selection 使用同一作用域颜色变量，保留 RGBA alpha；不连续分组继续按精确矩形渲染且禁止原生重复涂色。Text 为 HamsterSelection 传入统一后的 selectionColor/highlightColor。换色仅更新活动草稿/母版视觉，不清空范围，不重染历史标注。已存高亮的编辑仍使用保存颜色，显式改色走既有操作。

真机复验修正：共用 PDF 填充解析，将不透明颜色转为 alpha 0.35，保留更低 alpha；历史颜色不改写，只统一显示填充。移除文字高亮叠层对混色的依赖，WKWebView 即使隔离混色背景也能读字。浏览器测量确认跨 span Range 含元素框与过大的字体框；只测量被选文本片段并裁到对应 PDF.js span，同行仅合并微小间隙，保持浮点坐标，不扩大行高、不跨列或不连续成员合并。预览、序列化共用此几何；历史标注可从 canonical 锚点实时重算显示，无法重算时回退保存矩形，无存储迁移。

替代方案：固定黄色或仅靠全局 ::selection 无法覆盖两种选择叠层和活动换色；全局 CSS 还会影响 EPUB 和表单，故颜色仅限定 PDF 阅读根节点。

## Risks / Trade-offs

- [iOS/Android WebView 原生选择行为不同] → 在两端真实 WebView 验证长按与菜单抑制；浏览器合成 pointer 测试不能作为设备验收替代。
- [共享圆柄重构影响 Text/EPUB] → 共享视觉保持原属性语义，PDF 触摸模式显式启用，保留 Text 离屏端点及 EPUB 回归。
- [旋转、裁切、缩放和页面回收导致命中漂移] → 复用现有几何与源映射，拖动前后验证节点/会话，覆盖 50%/100%/200% 与旋转裁切测试。
- [半透明预览与原生选区双重涂色] → 每个输入路径只允许一套可见选区；计算样式和截图一起验证 RGBA 与实际叠层。
- [PDF selectionColor 自定义调用方预期改变] → 明确记录 PDF 颜色行为调整；维持字段类型及非 PDF 行为，不新增持久化迁移。

## Migration Plan

后续实现只在 reader 提交代码及测试，构建并验证 WebView 资源后交宿主验收。无数据迁移；需要回退时回退本次交互代码即可，已保存高亮仍为既有格式。设备验收完成前不宣称问题已修复。

## Open Questions

无阻断问题。合理假设：“高亮母版”指确认前的活动高亮预览；统一颜色覆盖 PDF Layout/Text，不含 EPUB，且不批量修改历史高亮。以上是本提案采用的范围解释，并非额外已获用户确认的要求。

## 第二轮真机复验

PDF 镜片通过同一 document.body fixed portal 盖在手柄之上，克隆当前取景范围的 PDF.js 文字层（保留字体和变换，仅显示文字），排除 SVG/标注/手柄。取景以最新字符端点为中心，标记使用高亮色竖线，不再拍起始页快照。Text/EPUB 保持原镜片路径。

PDF 拖动保存固定端，移动端越过固定端时重建有序 Range 并交换视觉角色，保持原 pointer capture 和抓取偏移。边缘自动滚动使用阅读容器的实际屏幕边界及距离平方速度，每帧重测/重命中；页面空白/间隙使用最近合法文字，文本尚未就绪时保留最后有效范围并等待渲染。松手/取消停止循环，普通滚动保留活动选区，真实节点失效仍安全终止。

长距离压力测试确认 PDF.js 回收起始页会让 DOM Range 自动迁移到页容器。适配层仅保留选区经过的文字层，允许画布/页面缓存正常回收；在 DOM observer 验证之前把被回收文字层恢复到原页，并从独立端点快照修复 Range。重访时临时隐藏重复的新文字层，结束会话时恢复 PDF.js 原生层并释放保留文字。页树或尺寸变化仍使会话失效，不依赖 PDF.js 私有缓存 API。连续跨页序列化包含中间已加载页的全文和矩形，维持原 page-N/offset 格式；自动滚动经过的页面逐页加载，不跳过中间文字。保留文本 DOM 的内存随会话经过页数增加，在清除/换书/卸载时释放。
