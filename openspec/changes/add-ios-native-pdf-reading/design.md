# Design

## Context

动机、功能及源码定位见 `proposal.md`。reader 当前把 Expo 宿主与 Web 阅读层分离：`ReaderScreen` 负责打开/退出，`ReaderWebView` 管会话，`ReaderDataStore` 按文件持久化，`ReaderSurface` 串联标注、绘图、评论和历史。未发现本仓原生 PDF 阅读代码；本设计不依赖其他仓。

这是跨 Swift/Expo、TypeScript、Web 阅读层的改动，必须在渲染、规范文字和存储之间建立边界。尤其 PDFKit 的文字顺序/空白/连字与 PDF.js 的规范 UTF-16 偏移不能假定相等；直接沿用原生字符串下标会悄然破坏历史高亮。

## Goals / Non-Goals

**Goals:**

- PDF 页面显示、缩略图与 OCR 输入图片由 PDFKit 生成；现有 JS 数据与工具继续作为业务权威。
- 平台无关 API 隔离显示、规范文字、交互事务和落盘，使 Android 后续可接同一边界。
- 文字、矩形及绘图在滚动、缩放、旋转、裁切后使用同一页变换；不因跨桥接异步而使高亮/手柄落后一帧。

**Non-Goals:**

- 不把 Reader 的 Web JSX 插槽改成必须由 RN 消费，不引入平台专属公开标注模型，不替换 painting 文档。
- 不实现所有阅读 UI 的 Swift 重写，不要求移除 pdfjs-dist 的规范文本提取，也不新增 PDF 文档写回。

## Decisions

### 1. 仓内本地 Expo 模块 + 平台无关适配层

在 `app/modules/reader-pdf` 新增本地 Expo 模块，Swift 使用系统 PDFKit/UIKit；由 app 内 autolinking 接入，prebuild 不手工改生成的 Xcode 文件。新增 `src/nativePdf` 下的纯 TS 契约与可测试状态协调器，`app/src/components/NativePdfReader.tsx` 组装 RN 宿主。文件名是拟定落点，均尚未创建。

适配器的公开输入/输出由 JSON 值描述，避免 PDFPage/PDFSelection/CGRect/UIKit 类型越界。现有 Web 公共 Reader 入口、CSS 和 props 保持可用；原生能力通过新增平台入口接入，不让浏览器构建静态导入 Expo。

拟定运行时接口（名称可在实现中调整，语义固定）：

| 分类 | 负载/操作 | 契约 |
| --- | --- | --- |
| 身份 | `fileId, paneId, sessionId, generation, requestId` | 每个请求/事件都有所属会话；重复提交去重；不持久化运行时身份 |
| 源 | 宿主授权的本地文档 URI、稳定 fileId | 继承现有缓存来源/权限；不接受文档脚本传任意路径 |
| 能力 | `nativeLayout, thumbnails, textGeometry, pageImage` | 运行时布尔能力；未支持明确报错，不以 platform=iOS 代替特性判断 |
| 元数据/几何 | `pageNumber, pageCount, width, height, rotation, crop, pageToViewport, geometryRevision` | 原页一基，几何单位明确为未缩放页单位/逻辑点；不把临时压缩索引当公开页号 |
| 渲染命令 | 打开/关闭、原页或锚点导航、缩放、更新页过滤/裁切、缩略图和页图请求 | requestId 对应完成或分类错误；错误不得覆盖宿主快照 |
| 规范文字 | 分页 canonical text、源 UTF-16 边界、文字片段/字符几何 | 使用 reader 原有 PDF 规范，无原生下标替换 |
| 交互命令/事件 | pointer 输入类型、草稿/选中对象、开始/预览/提交/取消、Popover action | 提交转换成原有 ReaderSelectionRange/Rectangle 和历史回调；预览不落盘 |
| 生命周期 | loading/ready/error，取消/释放，flush/close 完成 | ready 要求目标页可见且恢复完成；close 等待现有持久化 ACK |

契约扩展只加可选字段/能力，不在既有桥接 v1 消息上追加未经识别的新必填类型。原生通道独立命名和版本协商；Web 原协议及旧消费者继续工作。Android 本期保留 Web 实现，无 Swift 编译要求；将来用 Android 适配器实现相同接口。

备选：把所有业务塞入 Swift 会复制并改变旧数据规则；从其他仓引入模块不符合本次要求；因此只新增渲染/快速交互边界。

### 2. PDFKit 页绘制及共享原生滚动坐标

使用 PDFDocument/PDFPage 读取，原生 UIScrollView 容纳按需创建的页绘制视图，PDFPage.draw 提供页面内容；页面容器按原始页号索引，过滤隐藏页只改变可见布局，不删除/重排 PDFDocument 页面。固有旋转、crop box 与 reader 四边裁切统一为页到内容及内容到视口变换。

选择自行组合页视图，而非直接使用 PDFView 的整套选择 UI，是为了可控制隐藏页零占位、页级裁切、自绘交互和稳定原页映射。页面绘制与预览使用有界工作队列，正文优先，内存压力回收离屏位图。默认正文预热为可视页前后各一页，预览并发上限 2；实现阶段可根据 S14 调小，不能变成全书预渲染。

高亮、手柄和活动范围是原生自绘视图，挂在同一页/滚动变换树中；滚动/缩放帧内更新，不能等 JS 消息往返才移动。屏幕固定尺寸手柄按共享比例抵消内容缩放，原页锚点不变。页几何事件带 geometryRevision，JS 只消费最新版本。

透明 Web 工具层继续承载现有 painting/矩形内容与 Web 自定义 UI；页工具层必须由共享原生内容容器驱动位移/缩放，工具内部视口配置与 native 几何一致，不能用异步 scroll 消息逐帧追赶页面。只保留当前工具所需命中区域：绘图单指输入由工具消费，双指转交阅读导航；普通阅读不被工具层透明区域拦截。手势仲裁、同帧对齐及多个 Web 工具层的内存成本列入 S05/S07/S14 实测门槛。

### 3. 按需保留 reader 的规范文本，而非迁移历史 offset

复用 `pdfDocumentSession.ts`、`pdfTextMapping.ts` 和 `pdfSelectionSerializer.ts` 的规范：`getTextContent` 规范 TextItem.str 无分隔拼接，offset 为页内 UTF-16 边界，textId 沿用 page-N-item-I。只为可视页/导航目标/活动选区按需提取；iOS Layout 不创建 PDF.js canvas 或调用 page.render。

通过现有文字层的布局/规范映射生成文字片段及字符边界几何；可保留离屏的仅文字布局用于计算，不能渲染第二套 PDF 背景或显示系统 Selection。把 canonical 边界、文字/行几何和页面变换送入原生自绘选择组件。PDFKit 字符几何可辅助命中，但只能通过已验证的逐边界映射转回 canonical offset；无法验证时不允许持久化该范围，不用全页模糊文本搜索兜底。

双栏、连字、空白、重复文本、反序定位组及旋转页使用现有 fixtures 固定期望。高亮 text 与 rectsBySelectionId 从同一组端点产生。跨页活动选择保留必要文字映射，不阻止页位图回收；清除时释放。OCR 使用现有 OCR textId/坐标定义，与原生 PDF 文字分开，不把扫描页当有隐藏原文。

备选：完全依赖 PDFKit 文字提取会改变字序/偏移；批量迁移历史端点违反只增可选字段约束；按需兼容提取能保持旧格式，但性能需计入基线。

### 4. 两个自研组件及业务提交边界

**选择组件：**原生自绘暂存状态机 `idle → draft/active → dragging → commit/cancel`；共享规范参数从 TS 单一配置生成/传入，不能在 Swift 再复制一套常量。端点命中使用真实指针坐标，取消恢复拖前状态；提交前处理最终 pointerup 位置。原生 UIView/CALayer 绘制为自研 UI，不使用 PDFView 默认手柄、UITextView 选择或 UIMenu。主线程只消费就绪字形几何，不在拖动帧同步提取整页文字。

镜片遵循共享 38px 半径、76px 中心距、2倍倍率及安全边界。其内容使用独立的仅文字取景层（由规范文字片段/已布局文字纹理生成），不截取包含高亮/手柄的合成页面，也不因选区变化重新截图。虚拟竖线独立按 canonical 字符间隙绘制，角色、颜色及离散更新与 Web 相同；视觉保真须经 S05 验证。

**Popover：**继续 Web/React 自绘 UI，复用 `DefaultPopover.tsx`、`PopoverPortal.tsx` 与定位规则，新增原生选区几何适配输入，保留 selectionPopover/highlightPopover 自定义内容路径。评论编辑器仍可使用正常系统键盘，不把 PDF 菜单抑制扩展到评论/其他 reader。移动确认依旧去重 pointerdown/click。

Popover 显示坐标来自当前 native geometryRevision；滚动/缩放期间允许暂时关闭菜单，选择及手柄不能因此丢失，结束后仅在会话和选区仍有效时重算。Popover 不自己写存储，所有操作转交现有业务层。

### 5. painting、矩形、评论和历史继续使用现有所有者

`ReaderSurface` 现有快照/业务协调逻辑提取为与显示引擎无关的控制层，Web 与 iOS 共用。painting 仍通过正式库公开的页面锚定与完整 EditorDocument 读写；native 提供几何，reader 不解析或重投影旧笔迹内部坐标，不将其换成 PencilKit 模型。矩形/快照工具和评论使用现有组件与回调，必要页面图像改由 native 命令返回。

一次笔迹/矩形/范围更新只有一个 commitId 进入统一历史和保存队列；范围预览、布局变化、颜色设置不入栈。跨 Layout/Text 使用同一文件业务控制器和历史，切文件/外部替换按既有规则重置；保存确认/受控回显不能重复入历史。已配置的 toolbar 文件入口、单双栏继续传递 storageId/path/paneId，不把两栏共用一个原生会话。

### 6. 存储完全复用，第一期无需新增持久化字段

| 数据 | 必须保留的契约 |
| --- | --- |
| ReaderData | renderMode/selectedTool、edgeCrop、hiddenPages、两模式进度、virtualPaper、bookmarks/旧页书签保持含义 |
| 范围与矩形 | id、createdAt、page-N 端点、UTF-16 offset、selectionGroup、rectsBySelectionId、overlayRectType、markerStyle 保持原语义 |
| 绘图 | ReaderData.pagePaintings 对应 V5 annotations.paintings，完整 EditorDocument 交库校验与迁移 |
| 宿主信封 | annotations.version=5、readerData、comments 和其他 extra；readerData 同名字段优先于独立 progress |
| 宿主键 | reader.host.v1.doc.<fileId> 为旧记录；reader.host.v2.snapshot.<fileId> 为现有权威快照，沿用 pending 校验和写确认 |
| Web demo 键 | hamster-reader-demo:annotations:v5:<fileName> 继续为现有新键，旧 highlights blob 不改写 |

此 change 不引入 annotations V6、不改快照版本、不重命名旧键。所有 native selection/glyph/geometry/session 缓存都在运行时，第一期不需要平台专有持久化字段。未来若要辅助原生定位，只能添加可忽略的可选扩展，旧 canonical 字段仍为公共定位权威，必须通过双向互读测试。

保存通过 `restoreReaderSnapshot/serializeReaderSnapshot` 和 `ReaderDataStore`；当前 parser 若会丢弃未知可选字段，要补充无损保留，不改变已知字段校验/优先级。仅在权威新键缺失时调用已有旧数据迁移；迁移仍交 painting，不重新实现。新键损坏阻止写入并显式报告，不能回退后覆盖。文件保存单队列按最新快照合并字段，处理进度与标注并发。

### 7. 生命周期、安全与可观测验收

同一协调器处理 loading/restoring/ready/closing/error，native 页面显示只是 ready 的必要条件之一；只有稳定位置恢复及工具数据准备完成才提交当前文档。关闭取消未提交手势，等待导航稳定、采集进度、flush、宿主持久化完成才释放。沿用100ms尾防抖/1000ms最长提交及后台尽力 flush，强杀仅保证实际落盘数据。

文档源限于宿主选取后缓存的授权文件，不开放任意路径或文档可执行脚本；原 PDF 只读。内部链接经过允许页集合，外部 URL 由宿主策略审批，不直接执行 PDF action/JS。native 字节、缩略图 URI 与 Web 通道均绑定 fileId/session/generation，请求重放幂等；临时资源只销毁 reader 所有部分。

测试调试输出包含 renderer、首屏/目标页绘制时间、页/预览缓存数量、commitId、revision、geometryRevision 和过期消息丢弃计数，不包含文档完整正文或用户秘密。S14 用 Release 真机对照以包含桥接、规范文本与工具层全部成本；不以“native 方法已调用”代替屏幕可见首屏。

## Risks / Trade-offs

- [规范文字与 PDFKit 几何不一致] → 保留 PDF.js 规范及可验证边界映射，S03/S06 固定样本先通过；失败禁止重写旧端点。
- [原生与 Web 工具混合增加内存/手势复杂度] → 共用 native 变换树，限制活跃页工具、真机逐帧与 Instruments 验收；性能不达标不能宣称迁移完成。
- [仅文字镜片字形保真和滚动同帧更新] → 以共享几何基准和录屏测量检查；可修改内部绘制方案，不降低镜片/端点标准或改用系统控件。
- [隐藏页与原始页号混淆] → 可见列表只存原页号，不修改 PDFDocument 顺序；200页极端样本检验零占位及恢复行为。
- [可选 OCR 或消费者自定义 UI 缺覆盖] → 条件功能按原配置注入 provider/插槽单独验收，不能把未配置入口误报为已实现。
- [规模较大而一期要求完整对齐] → tasks 按可验证行为组织内部提交，所有“做”项完成后才替换默认入口，不通过静默 Web fallback 掩盖缺项。

## Migration Plan

1. 在 reader 增加适配契约、固定样本和单独的开发验证入口；复用现有文件数据与构建配置，不改默认路由。
2. 接入 PDFKit、原生自绘选择和共享工具/存储，逐项执行 S01–S13；完整保留 Web Layout 作为对照构建路径，正常用户路由不自动切回。
3. 完成 Mac/Xcode 的真实构建、真机验收与 S14 性能报告后，将 iOS ReaderScreen PDF Layout 默认切原生；保留 PDF Text/Web/Android 现有资源。
4. 若回滚发布，切回当前 Web 路由并从同一 V5/v2 权威快照读取；不恢复旧 v4 快照或双写。未确认保存失败必须先解决或提示，不能靠换引擎清空会话。

## Open Questions

无阻断提案的产品问题。开发时记录具体真机/iOS版本和大PDF文件哈希作为验收样本；不改变上述范围、接口语义或任务顺序。兼容提取与性能门槛是本提案的明确设计假设，评审可调整，但调整后须同步 proposal/specs/tasks。
