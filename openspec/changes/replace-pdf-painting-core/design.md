# Design

## Context

动机与范围见 proposal.md。以 2026-11-03 实际核查为基线：

| 项目 | 已观察事实 | 本次影响 |
| --- | --- | --- |
| reader 依赖 | package.json / yarn.lock 均为 painting 0.4.0 | 不能直接改版本后沿用原 props |
| npm 正式包 | 查询 npm dist-tags，latest 为 0.7.0；下载 0.4.0 / 0.7.0 发布包核对源码及导出 | 0.7.0 不是本次所需能力已完成的证据 |
| 0.7.0 公开入口 | PaintingBoard 为分层表面，接收 LayeredEditorController；公开 createEditor、EditorDocument、readLayeredDocument、serializeLayeredDocument，文档 schemaVersion 为 3 | 没有旧 DrawingValue、PaintingControllerData、PaintingController、normalizeDrawingValue 的公开导出 |
| 0.7.0 数据读取 | 文档 reader 只接受 schema 3，不提供旧数据迁移；分层表面是通用绘图层 | 需要 painting 增量提供旧数据迁移及 PDF 页锚定能力 |
| PDF 路径 | PdfDocumentViewer → PdfPageOverlayLayer → PageDrawingLayer；后者使用旧 value/onChange/controller props，含 scaleDrawingValue | 页锚定不能继续由 reader 缩放笔迹点实现 |
| 状态及颜色 | Reader.tsx 合并受控/非受控 pagePaintings；drawingStrokeColor 与工具栏控制状态合成后下传；DefaultBottomBarControls 使用旧 PaintingController | 需要统一新版工具状态和文档负载 |
| 共享消费者 | Page、IntermediateDocumentViewer、EngineEpubLayoutLayer、PageBrowserDrawingPreview 等复用绘图层 | 必须一并迁移并验证非 PDF 路径 |
| Web 持久化 | demo/App.tsx 的 persistHighlights 写 `hamster-reader-demo:highlights:<fileName>`；绘图、高亮、矩形等入口都会调用 | 只改绘图回调仍会导致其他入口继续改写旧 v4 |
| 原生持久化 | readerSnapshot 在 highlights 中序列化 v4；ReaderDataStore 将整个快照写 `reader.host.v1.doc.<fileId>`；bridgeHostSession 异步落盘后 ack | 新格式必须独立存储，不能经旧 serializer 重建 v4 |

既有主规格要求继续写 v4、保持旧绘图公开类型。本 change 的 `reader-data-compatibility` 增量显式修改这些要求，遵循本线程最新决策：只写新格式、保留旧原件、接受旧 App 仅看到升级前状态。撤回的双写/旧模型投影方案不属于此设计。

## Goals / Non-Goals

**Goals:**

- 新版绘图库承担绘图模型兼容与页锚定；reader 只有存储选择、几何传递、工具栏同步和错误处理。
- 新数据全量、版本化、可验证；迁移可中断重试且不丢旧原件；已保存内容能跨页回收与重启恢复。
- 绘图表面只保留一条新版路径，共享消费者及公共绘图类型同时升级。

**Non-Goals:**

- 不在 reader 内实现旧笔迹映射、旧样式重建、绘图坐标投影或降级渲染。
- 不向旧 App 同步升级后的新数据，不提供新旧格式双写或反向投影。
- 不替换 PDF.js，不重写已有文字/矩形坐标适配，不改造其他格式的阅读引擎。
- 本次不实现代码、不发布包；以下 API 能力和任务是后续工程交付契约。

## Decisions

### 1. painting 正式发布是 reader 集成的前置门槛

painting 工程师负责增量 minor API、兼容测试与发布；既有 0.7.x 新版消费者不得被破坏。reader 侧最终使用已发布的确定版本号及对应锁文件，不使用 git ref、本地 link、file/workspace 替代，不直接依赖包内未导出的模块。

本提案只约定以下能力，不创造尚未存在的导出名称：

| 能力 | 消费方提供 | 库必须保证的结果 |
| --- | --- | --- |
| 一次性迁移 | 不透明旧绘图值/旧文档、稳定文档与页身份、必要的原始页几何 | 返回有效 EditorDocument 或明确失败；稳定 ID、页面位置、样式、对象顺序和可表示内容保真；同一输入重复调用结果稳定；不静默丢弃对象 |
| 页面锚定 | 稳定 page-N、基准页几何、当前显示几何与变换、滚动后页面位置、旋转/裁切信息、设备像素比等库要求的上下文 | 库统一输入命中、文档坐标及显示投影，满足规格精度；display 变更不改存储坐标；重复挂载不会重复变换 |
| 新文档生命周期 | 新文档、当前工具/颜色、启用状态、页面身份 | 以正式公开的新控制器/表面接口工作，输出已提交文档；未提交/取消的笔迹不进入持久化；可透明覆盖 PDF |

现有 `readLayeredDocument` / `serializeLayeredDocument` 可作为 schema 3 校验与序列化的基线，实际签名及新增迁移/锚定入口以工程师产物为准。集成前记录实际发布号、公开导出、几何单位、颜色及取消语义，并用发布包执行契约测试。若正式 API 不能满足上述能力，需在本线程对齐库契约，不在 reader 内补兼容实现。

替代方案：reader 自行迁移和投影能快速接入，但把维护成本分散到每个消费者；已按最新决策排除。

### 2. 统一新版文档与工具状态

reader 内存和公共 `pagePaintings` 统一为 `Record<string, EditorDocument>`，页 ID 沿用 `page-N`。`ReaderData`、页面 props、`onPagePaintingChange` / `onPagePaintingsChange` 负载、预览与 demo/WebView 调用点同步更新，不定义旧 DrawingValue 的本地替代类型或联合类型兜底。旧原值只在存储入口以 unknown 读取后传给库。

新版控制器按稳定文档/页身份管理，不因工具栏改色、缩放或普通重渲染而重建。订阅已提交文档变更触发回调；只同步新文档，不订阅临时移动点作为保存事件。外部受控数据回传同一文档时不重复提交；真正替换文档时按正式 API 恢复/重建并清理旧订阅。Reader 保留跨页更新用最新 map 合并的语义，避免快速连续回调覆盖其他页。

工具栏当前绘制颜色是唯一颜色来源，传给库当前工具设置，在落笔时冻结本笔颜色；切页、回收、受控更新均不恢复库默认值。替换旧 PaintingController，使用已发布新版控制接口绑定现有 reader 工具栏；若使用新版库 Toolbar，仅作为同一受控工具状态的视图，不引入独立颜色选择源。原有工具枚举升级到库新工具模型，例如 pen 对应新版 freehand 的调用方迁移写在升级说明，不留运行时旧工具兼容层。

旧绘图层的实现被替换，可保留 PageDrawingLayer 作为薄的新版集成边界，但不得保留 scaleDrawingValue、旧 sanitizer 或旧 controller binding。全部共享消费者同批升级后删除旧 API 引用。非绘图 API、文字/矩形样式与评论关联保持不变。

### 3. 绘图坐标变换只有 painting 一个责任方

reader 已能从 PDF.js 取得 scale=1 的 viewport、当前 page viewport、页 DOM 位置及公开页号；将这些几何与变换原样按正式 API 的单位契约传给库。基准页坐标必须独立于当前滚动/缩放，固有旋转、当前旋转及裁切也必须有明确语义；库负责解释和转换。reader 不逐点乘除缩放、不计算绘图专用逆矩阵，也不把 DPR 烘焙进 samples。

页面切换、PDF.js viewport 重建、滚动、尺寸变化时更新上下文；页回收时释放表面资源和监听，重新进入时从权威 map 恢复新文档。绘图层保持透明、覆盖正确内容区域，避免库默认白色背景遮住 PDF。绘图启用状态与单指/双指仲裁沿公开接口接入；库如缺少必要的取消或禁用能力，同样由库增量补齐，不重建旧版事件实现。

`src/pdf/pdfOverlayGeometry.ts` 的文字/矩形适配不属于此次迁移，保留其原有用途，不能因“无旧绘图适配”误删非绘图能力。页面锚定的具体计算算法、类型名和参数结构由 painting 工程师定义，此处不提供竞争实现。

### 4. 新存储格式和独立键

以下为 reader 的新容器设计，不改变 painting 的 schema 3 文档：

```ts
type AnnotationStorageV5 = {
  version: 5
  ranges: ReaderSelectionRange[]
  rects: ReaderSelectionRectangle[]
  paintings: Record<string, EditorDocument> // key: page-N; value.schemaVersion: 3
}
```

范围、矩形及评论关联继续使用现有字段语义；绘图保存完整的库文档（真实样本、brush、对象变换、稳定对象 ID/修订等），不手动截断、投影或丢字段。临时预测点、派生轮廓、DOM 位置、显示 viewport 和渲染缓存不存储。painting 返回结构由库正式序列化/校验能力处理。

| 后端 | 新权威键/记录 | 保留的旧数据 |
| --- | --- | --- |
| Web demo | `hamster-reader-demo:annotations:v5:<fileName>`，值为完整 AnnotationStorageV5 JSON | 原 `hamster-reader-demo:highlights:<fileName>` 原始字符串不修改 |
| Expo 宿主 | `reader.host.v2.snapshot.<fileId>`，值为完整 BridgeHostSnapshot；其中 data.annotations 为 AnnotationStorageV5，comments / readerData / 非旧标注扩展数据沿用快照语义 | 原 `reader.host.v1.doc.<fileId>` 中携带旧 v4 的记录保留，不通过新写入重建其旧 highlights |

新容器保存所有范围、矩形和绘图，而不仅保存绘图：否则编辑范围或矩形仍会调用原 persistHighlights，破坏“旧 v4 原件冻结”的要求。WebView 新快照不再生成 data.highlights 或写 v4 serializer；改用 data.annotations。原快照中其他不相关字段保留，旧 highlights 不复制为另一个持续更新的副本。

原生文件元数据/索引职责不变，但读取快照必须先查新快照键，缺失才读取旧记录用于初始化；新增文件也直接写新快照。更新读取、保存、重载、导入/导出入口，避免某个旧 `saveSnapshot` 调用继续写带 v4 的旧记录。桥接协议版本及 ack/revision 语义保持不变，新旧应用各自只读写其支持的存储命名空间，不要求旧 App 解释新快照。

设计假设：Web demo 本次沿用 fileName 身份与现有同名文件行为，不额外扩展文件身份改造；原生继续使用已校验的 fileId。文件隔离测试在各自既有身份契约下执行。

### 5. 首次读取和幂等迁移

读取顺序：

1. 查询新键。存在且有效时立即恢复，包括空集合；不再查询旧绘图来补数据。
2. 新键存在但损坏/版本不支持时报告错误并保留原件，不当作“缺失”触发自动降级。
3. 仅新键确实不存在时读取旧容器。范围/矩形沿现有读规则恢复，绘图原值连同页身份及必要几何交给 painting 迁移 API。reader 不识别 pen/text/image 等旧对象类型。
4. 收集该文件全部页的迁移结果（包含暂未渲染页；必要时读取基准几何而不挂载整页 DOM）。全部成功后组装一个完整 V5 容器写新键；迁移期间不允许编辑产生混合版本提交。
5. 新键完整落盘才算迁移完成；原生收到 ack 后再转为已确认快照并允许编辑。失败可重试，旧 blob 始终不变。没有旧数据的新文件初始化空 V5 容器，不创建旧键。

以“有效新键存在”为迁移完成标志，不依赖另一个容易先写成功的标记键。单文件完整容器一次提交，不做逐页部分成功；宿主新键写入需具备完整替换语义，文件系统通过临时文件及原子替换或等效方式确保中断不会暴露半写 JSON。Web localStorage 单次 setItem 提交整容器，quota 异常视为失败。串行化同文件初始化与写入，重复会话/请求不重复追加；库负责输入到稳定对象 ID 的幂等迁移。

确认后的清空也保存有效 V5 空集合，不能删除新键来实现清空，否则旧笔迹会在下次打开时复活。新键存在后忽略旧 App 对旧记录的后续编辑，不合并两套历史。

### 6. 写入时机、保存确认和恢复

- 库完成笔迹提交、对象编辑、删除、清空、撤销/重做后，读取已提交文档并合并完整页 map，发送一次逻辑保存；不在每个 pointermove 或显示变换时保存。
- Web demo 更新完整新键，setItem 成功才视为持久化成功；失败保留最后已确认状态并显示错误，允许重试。
- WebView 沿 ReaderSurface → serializeReaderSnapshot → bridgeClient 发送完整新快照。沿用 pendingChange 合并和单 in-flight 请求机制；同 requestId/revision 重发必须幂等。
- 宿主以 sessionId/fileId 校验会话，按 revision 串行落盘到新键，成功才 ack。UI 可乐观显示新笔迹，但保存成功状态与 confirmed snapshot 只能在 ack 后前移；失败不能伪装已保存。
- 翻页/缩放不会丢弃已提交的保存；正常切换或关闭前发送/等待待确认提交，旧会话结果不得写入新文件。未完成的一笔在取消/卸载时不提交；异常终止仅承诺恢复最后完整落盘的数据，不承诺恢复未确认输入。
- 快照恢复和受控数据回显不触发自动空写；迁移是唯一允许初始化主动写入的分支，且必须基于完整成功迁移结果。

替代方案：原先双键事务及旧模型投影需要跨格式一致性和持续旧实现，已撤回。当前每次只写一个新权威容器，旧数据不参与事务。

## Risks / Trade-offs

- [正式发布版本及签名尚未交付] → 作为外部前置依赖而非假定存在；以能力规格约束，集成前绑定实际发布号和契约测试，不阻碍本次 propose 文档完成。
- [历史对象样式/压力/图片/文字迁移失真] → painting 用 0.4.0 实际格式和真实 fixture 验证，覆盖旧 pen、shape、text、image 及库声明支持的更早文档；无法保真的对象明确失败，reader 不静默删除或自行修补。
- [共享组件升级影响 EPUB 等格式] → 同 change 更新所有引用、预览和公共类型，执行非 PDF 绘图与库构建回归后才删除旧实现。
- [旧 App 无法看到升级后的修改] → 已明确接受；保留升级前原件，只读历史源，不设计降级同步。回滚 App 只恢复升级前视图，不会把新键数据反向迁回 v4。
- [旧 serializer 仍被其他保存入口调用] → 全量审计高亮/矩形/历史/导入导出/清空入口，测试所有入口对旧原始字符串或原始记录的字节不变性。
- [滚动/缩放双重变换或不透明绘图底色] → 删除 reader 绘图换算，库契约测试和真实浏览器/设备测量同时覆盖，不用仅 mock 表面的单元测试宣称无偏移。
- [大文档迁移时页面几何尚不可用] → 只读取需要的基准几何，完整文件提交前显示迁移状态并禁止编辑；失败不写半成品。

## Migration Plan

1. painting 工程师完成并正式发布增量迁移/页锚定能力；在本 change 记录正式版本和 API 交接，验证既有新版消费者未破坏。
2. reader 实现新容器与读取优先级、宿主新快照键和保存确认，更新全部写入口及导入导出；旧数据只作为一次性输入。
3. reader 更新依赖/锁文件、公共绘图契约、单一新版表面、工具栏及全部共享调用点，接入库的迁移与几何能力，移除旧实现。
4. 使用真实旧 fixtures、新版绘图交互、失败注入和重启重开验证；发布说明写清 API 及降级可见性变化。
5. 如需回滚应用版本，保留新键与旧 blob；旧版只显示旧快照。修复后回到新版继续读新键，不自动覆盖或反向转换。任何显式恢复旧备份属于用户主动恢复操作，不纳入自动迁移路径。

## Validation Strategy

- 库契约：迁移稳定 ID/保真/失败语义、页锚定正反向精度，以及公开 API 增量兼容；在正式发布包上验证。
- reader 集成：`test/page-drawing-layer.test.tsx`、`test/pdf-viewer/pdf-document-viewer.test.tsx`、`test/reader.test.tsx` 覆盖颜色、受控回传、跨页更新、回收和触摸取消；仅几何单元测试不足以证明真实对齐。
- 存储：`test/highlightStorage.test.ts`、`test/compat/highlight-json-roundtrip.test.ts`、`test/demo.test.tsx`、`test/host-reader-data-store.test.ts`、`test/bridge-contract.test.ts`、`test/webview-bridge-client.test.ts` 及重载用例覆盖新键、完整写入、幂等、失败及旧原件不变。既有测试中“升级后继续写 v4”的断言须按新 delta 更新，不删除非绘图保真断言。
- 真实交互：按 PDF 规格矩阵在 Web 与 iOS/Android WebView 实测鼠标/触摸/笔、50/100/200% 缩放、滚动、不同页尺寸、回收、旋转、裁切及 DPR；记录定位点偏差与重开结果。
- reader 标准检查：`yarn typecheck`、`yarn lint`、`yarn test:run`、`yarn build:lib`、`yarn host:check`；必要浏览器回归扩展既有 `check:browser` 场景。
- 本次 propose 仅执行 OpenSpec 状态及文档严格校验；以上实现测试留在 tasks 中，不标记为已运行。
