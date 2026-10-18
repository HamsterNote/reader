# Design

## Context

动机见 proposal。以下是实际检出的两个仓库现状，而非假定已有功能：

| 仓库 | 已有入口/实现 | 对本次设计的约束 |
| --- | --- | --- |
| reader | `src/components/Reader.tsx` 接收 IntermediateDocument；`isPdf/isEpub` 是 viewer 提示；`renderMode` 只有 layout/text | 不存在可直接加载本地 PDF 原件的平台 renderer 路由，新增 source 路径不能破坏 document 路径 |
| reader | `demo/App.tsx`、`demo/pdfParserForReader.ts` 使用 `@hamster-note/pdf-parser`；`PageBrowser.tsx` 依赖页面尺寸、底图、批注；`DefaultSelectionPopover` 会真实修改高亮 | 旧 parser/缩略图/Popover 不能直接当作新 PDF renderer 或占位按钮复用 |
| native-reader | `packages/native-reader/src/NativeReader.native.tsx`、`NativeReader.web.tsx`；`ReaderSource`、`ReaderLoadState`、generation/lifecycle 工具；Foliate renderer | 这里才是 Expo 多平台外层 API；跨平台改动必须覆盖该仓，不能只加 reader Web 代码 |
| native-reader | `formatDetection.ts` 检测 `%PDF-` 后直接返回 unsupported；主规格也明确拒绝 PDF | 新 PDF 路径必须同时修改内容检测、format union、错误预期和对应规格 |
| native-reader | Android 有 manifest-exact WebViewAssetLoader 和私有 bridge；Apple secure-WebView 是 Objective-C/Objective-C++，没有现成 PDFKit Swift Expo Module | Android 可复用受限宿主机制但需独立 PDF 模式；iOS 模块是新增，不是已有 Swift 文件的小改 |

reader 的 OpenSpec CLI 为 1.13.1；初次 context/list 确认已有 OpenSpec 根、没有 config.yaml/config.yml、没有主规格或进行中的 change，仅有历史 archive。创建 change 后 CLI 写入仅含 `schema: spec-driven` 的 config.yaml，没有额外 context/rules。native-reader 存在项目自带 `.opencode/commands/opsx-propose.md`、技能和已归档 Foliate 方案；未归档 EPUB change 的旧 epubjs 方案不能覆盖当前代码与主规格。

## Goals / Non-Goals

**Goals:** 以内容检测分流和中立交互契约连接独立 renderer；明确两个仓库的实现归属与各平台验收；在本地离线阅读下保持 source 所有权、代际隔离与严格资源权限。

**Non-Goals:** 不把 PDF 位置伪装为 EPUB CFI/章节，不把临时选区写成 ReaderData.ranges，不迁移旧 PDF parser 保存的数据，不统一引擎内部状态机。产品范围以 proposal 的一期和非目标为准。

## Decisions

### 1. 规划在 reader，平台宿主在 native-reader

本 change 是 reader 内的唯一规划来源；实现阶段必须同时覆盖 native-reader，而不另起互相漂移的功能定义。reader 提供 DOM Web PDF adapter 和纯 TypeScript 契约（平台无关子入口，不能令 RN 导入 DOM/ReactDOM/旧 painting 依赖图）；native-reader 提供 RN Chrome、iOS 模块、Android host 和 Expo Web 接线。两仓通过显式版本依赖/打包产物消费，不能使用 `../reader/src` 跨仓源码路径。

reader 的 `Reader` 新增可选本地 `source` 路径和统一页面事件；已有 `document`、data/onDataChange 与导出继续兼容。`source` 与 `document` 同时传入时返回明确输入错误，不静默覆盖。没有原始 source 的 IntermediateDocument 保留原路径，不声称完成了新 PDF renderer 验收。demo 上传 PDF 将原件传给新路径；EPUB 继续现有解析路径。native-reader 保持 `NativeReader`、`ReaderSource` 和 onStateChange 入口，外部不需要选择具体引擎。

替代方案：把整个 reader DOM 库嵌入 native，或把 PDF 转回 IntermediateDocument；两者都会把引擎、性能和选区逻辑重新耦合，因此不采用。

### 2. 复用边界

| 层 | 复用内容 | 各 renderer 独立内容 |
| --- | --- | --- |
| 外层 API/状态 | 本地 source 验证、idle/loading/ready/error 语义、style/testID、错误分类、source 所有权和 generation 工具 | PDF 页面状态另加字段，不改变既有 ready 结构；EPUB CFI/TOC 和 flow 不塞进 PDF |
| 操作契约 | 打开/释放、页面请求、元数据/页面/选区事件的类型 | EPUB 的 navigate/flow、PDFKit PDFView 操作、PDF.js viewport/render task |
| Pages | 展示模型、页码、当前项、占位/错误状态和跳转语义 | iOS 缩略图生成与 URI、PDF.js 缩略图 canvas、平台可见范围请求 |
| 选区交互 | 临时 text/rects、React Popover 显隐和无副作用按钮逻辑 | PDFKit PDFSelection、PDF.js DOM Range/text layer、坐标计算和原生菜单拦截 |
| 持久化 | 既有 EPUB 存储接口保持兼容，未来可挂载高亮交互契约 | 本期 PDF 不调用 data.ranges、autoHighlight、annotation history 或存储 |

native-reader 的 `ReaderChrome.tsx` 复用加载/错误/外壳布局，通过 PDF 模式新增 Pages/页码显示；不能把 PDF 页数映射到其现有 Chapter/spine UI。reader 的 PageBrowser 展示样式/可访问性可沿用，但 PDF rail 只能接收中立页列表，不依赖原有底图/painting 数据链。PopoverPortal 的 DOM 定位可供 Web 沿用；RN 使用 React Native overlay，不把 DOM portal 当作 native 通用组件。

### 3. 内容检测和安全门禁顺序

先验证本地 file/content scheme，再检查已知正整数大小及 32 MiB 上限；任一条件失败即拒绝且不读签名，不访问 HTTP(S)。native 仅在偏移零最多读五字节，与现有 detector 的 `%PDF-` 规则一致；不采用原提议的 4 KiB。probe 只返回是否为 PDF 候选的布尔值，不返回字节或任何后续读取、复制、transfer、session 授权。完整解析由目标引擎验证，扩展名/MIME 仅作提示。PDF 候选先做该平台能力检查，再打开完整文档；非 PDF 候选必须重新走现有 Foliate 全部门禁。

这是对 native-reader 当前“Foliate 门禁失败前零 source I/O”契约的明确、有限调整，已在 HAM-46 实施前记录并获认可：仅准许通用入口上述五字节候选探测；失败后仍禁止后续读取、复制、传输和 session 创建。同步 `local-multi-format-reading`、`reader-component-api` 的分流场景，并在 `foliate-reader-security` 明确入口探测的适用范围。其既有 EPUB CSP、private bridge 与完整读取授权规则原文不改。旧 HAM-35 的设备证据豁免不自动适用于 HAM-46。

替代方案：按扩展名直接绕过 Foliate 门禁会误分流；让 PDFKit 依赖 Foliate WKWebView 的 CSP probe 会错误阻断纯原生 PDF 阅读。采用独立 PDF 能力检查与显式签名 probe 例外。

### 4. 中立 PDF 契约与生命周期

Web Blob HEAD 在 Chromium/Firefox 均不可用。Expo Web 分流只允许同源 blob 的
`Range: bytes=0-4`；读取 body 前要求 206、精确 Content-Range 的已知正整数总大小
和 128 MiB Web 上限，以及 Content-Length=min(5,total)。不支持 Range 即失败，
不回退完整读取。它只返回 PDF 候选和大小；非 PDF 继续完整 Foliate gate，PDF
等独立静态 iframe 的 CSP/窗口/origin/session 握手通过后才传完整私有 bytes。
native 仍保持先元数据/32 MiB 后最多五字节的顺序。

新增契约属于提议而非现有 API：`PdfMetadata { pageCount }`、`PdfPageState { pageNumber }`、`PdfSelection { sessionId, selectionId, text, rects, coordinateSpace: 'reader' }`，rect 使用 reader 内容区域左上角为原点、逻辑点/CSS px，非物理像素；pageNumber 统一 1-based。引擎内 index 转换只发生在适配器。source identity、session/generation 随每次打开重置，thumbnail、导航、错误、选区响应必须携带同一身份。ready 需要首屏页面实际呈现，不等同于 bridge bind 或文档解析成功。

PageState 通过新可选事件向宿主暴露，临时选区只存在内存；不扩展已有 ReaderData 高亮持久化格式。引擎侧 rect 先转换到其视图坐标，宿主再减去 reader 根偏移并处理 safe-area/iframe/WebView 边界，禁止重复加缩放或 DPR。跨页选区可报告多 rect，以可见首个 rect 定位 Popover。

释放顺序：失效 generation、关闭 Popover/选区、撤销源授权、取消 render/thumbnail 任务、移除事件与通知、销毁 PDFDocument/PDF.js worker/视图、删除 reader-owned 临时缩略图/副本。保留 host file/content grant/blob URI 的所有权；只撤销本 reader 创建的 URL。重复清理必须幂等。

### 5. iOS：PDFKit + Expo Module

在 native-reader 新建独立 Expo Module 包（建议 `packages/pdf-kit-expo-module/`），包含 `expo-module.config.json`、podspec、Swift `Module`/`ExpoView`、TS wrapper 和打包声明。PDFView 使用 PDFDocument，暴露打开/释放、跳页、按需缩略图及 metadata/page/selection/error 事件。外层 RN overlay 绘制 Popover，不显示原生 PDF annotation 工具条。Expo Go 不具备此模块时返回明确 unsupported；验收使用重建的 development client/原生宿主。

本地 file URI 做规范化授权，必要的 security-scoped 访问和 reader-owned 副本仅限本次文档，并在释放时结束访问；不开放全目录读取。缩略图用 PDFPage 生成至有界缓存，异步结果带 generation。

订阅 PDFView selection/page change 通知，使用 PDFSelection 的页面 bounds 经 PDFView 转到 RN 容器。菜单屏蔽覆盖最低支持 iOS 和较新 UIEditMenuInteraction 路径，保留 PDFView 原生选文和 handles；仅 `canPerformAction` 返回 false 不足以证明菜单消失。先做真实 PDFKit 宿主验证，再完善兼容实现，不依赖 private API、不全局 swizzle。模块能力失效返回稳定错误，不能回退到未批准的 WebView PDF 路径。

### 6. Android/Web：共享 PDF.js 核心，宿主隔离

reader 提供可嵌入的 PDF.js Web adapter/runtime，封装文档、页面 canvas、text layer、缩略图与事件；native-reader 的 Android runtime 打包及 Expo Web 路径消费同一显式版本产物。PDF.js 与 worker 版本锁定，实际使用的 cMaps/fonts/WASM 都本地打包，不依赖 CDN。按可见窗口渲染与回收页面，text layer 与 canvas 使用同一 viewport/rotation，禁止以整份文档一次绘制作为默认路径。

Web 使用 DOM Selection/Range 和 PDF.js text layer，在 PDF surface 内阻止 `contextmenu`；不阻止 selectionstart/pointerdown/touchstart。reader DOM 页面由 adapter 绘制；native-reader Web 在独立 PDF iframe 中使用同一 adapter，消息校验 source window、精确 origin、协议、session/generation，URI 由宿主转换为私有 bytes/blob 数据，不能给 iframe 任意 URI fetch 能力。PDF.js 禁止文档脚本与 eval 功能、外部 action/navigation；iframe 配置 CSP/sandbox 仅允许打包 runtime/worker，不能给 PDF 内容脚本执行权。此路径不以 Foliate 专用 iframe CSP 行为 probe 为前置条件，但必须有自己的资源/消息校验。关闭时销毁 loading task/document/worker、canvas/text layer 和 reader-owned URL。

Android 复用 native-reader secure-WebView 的受限资产加载/私有 main-frame transport 机制，在独立 PDF host 模式中加载打包 adapter。DOM selectionchange 输出受限 text/rect；native 层同时拦截 WebView selection ActionMode/菜单创建，DOM contextmenu 拦截仅为补充。不得关闭长按监听、选文 handles 或统一吞掉 touch。RN overlay 的点击不触发网页 selection collapse；按下“高亮”只消费事件，不调用 EPUB 默认高亮处理。

### 7. Android 受限 HTTPS 路径

静态 manifest 精确列举 `/pdf-runtime/...` 的 shell、ESM、worker 和字体资产；PDF 动态路径 `/pdf-document/<session-token>/document.pdf` 只映射当前授权的 file/content URI 或 reader-owned 缓存文件，不是通用文件服务器。content URI 通过已有 grant 打开，不可用时返回 read error。可支持单一受验证 Range 并以明确 206/416 响应；不支持则返回完整 200，不能返回错误的部分数据。静态路径与动态文档授权分离，避免把用户 PDF 加进静态 manifest。

WebViewAssetLoader 对未命中路径返回显式拒绝，不能 null 后回退网络；校验 scheme/host/port、规范化路径、遍历/编码分隔符、MIME 与 session。禁止任意 asset 根、外网导航、popup、下载、文档 action 和非授权 scheme；保持 `allowFileAccess`、`allowFileAccessFromFileURLs`、`allowUniversalAccessFromFileURLs` 为 false。PDF host 配置单独的严格 CSP，仅允许自身打包模块/worker和文档端点。

Bridge 复用私有 port 机制，不复用 Foliate 命令解释器；PDF 协议独立版本/消息白名单/有限 text 与 rect 数量、session/generation/command 校验。不得新增 `addJavascriptInterface` 或公开 `ReactNativeWebView` fallback。secure-WebView ABI 保持原有 string postMessage/onMessage；新模式需要维护源 patch、`stage-secure-webview.mjs` 和生成完整性测试，不能只手改 generated Java/Kotlin。

Android 实现使用独立 `HNPdfView`，静态资源的 MIME 以 integrity-pinned manifest 为唯一生产来源，只校验封闭的 MIME 白名单，不按扩展名另建映射。真实 staged manifest 的每一项都必须经过资源响应回归，包括无扩展名的 `READER_LICENSE`。私有 port boot 校验成功后才允许完整 source I/O：file 需在 app-owned canonical 根内，content 需同 UID provider 或现有 OS read grant；均先检查已知大小和 32 MiB 上限，再通过有界 regular descriptor 获取私有快照。动态地址使用随机 token，返回完整 200，撤销时清零快照并关闭 port，不改动 host 文件。native 菜单策略使用 public ActionMode callback 包装并保留原 callback/handles，设备行为证据仍是独立验收条件。

### 8. Pages 与占位 Popover

Pages 默认在宽屏左侧展示，窄屏可折叠为左侧 rail；点击页面后收起窄屏 rail。页码始终可用，thumbnail 失败局部降级；按可见项请求并限并发/缓存，具体上限在实现性能验证中调整。页码保持物理页序，不使用 PDF 内印刷标签替代编号。

占位 Popover 只有“高亮”按钮，不附带颜色、删除、评论或快捷操作。独立组件复用 outer React 状态逻辑，不能复用会调用 `selectionRef` 高亮方法的 DefaultSelectionPopover。滚动/缩放期间可以主动清空选区并隐藏 Popover，以换取一致锚点；选择完成后仍可重新选文。Pages 跳页强制清空旧选区。image-only 文档不启用 OCR。

## Risks / Trade-offs

- [iOS/Android 菜单实现受系统版本影响] -> 把“菜单不出现且 handles 可调整”的真实宿主验证列为高难度任务和平台验收，编译或 mock 通过不能替代行为证据。
- [跨仓 package 依赖及双版本 worker] -> 先完成不导入 DOM 的契约子入口和 adapter 打包，再接 Expo consumer；consumer 包内检查资源闭包与版本一致性。
- [原 source 零 I/O 规格与内容分流冲突] -> 限制为经本地 scheme、已知正整数大小和 32 MiB 预检后的五字节布尔探测；同步冲突规格/测试，不隐式绕过 EPUB gate。
- [PDF 大文件/text layer/thumbnail 占内存] -> 保留 native 32 MiB 上限、窗口渲染、取消/销毁和有界缓存；无扫描 PDF 文字识别承诺。
- [旧 reader PDF 批注功能强于一期] -> 新 source/PDF path 不继承旧 annotation 能力，旧 document consumers 保留兼容；文档明确两条路径，避免数据误迁移。
- [本机不是 Apple/Android 设备环境] -> 本次只验证提案；未来 tasks 中单列编译、模拟器/设备和浏览器证据，不宣称已验证菜单、PDFKit 或离线 runtime。

## Migration Plan

1. 先完成契约、source 签名 probe 和跨仓规格冲突同步，明确新路径与旧 document 行为；现有 EPUB 回归必须保持通过。
2. reader 发布含纯契约子入口和 PDF.js runtime 的候选包；native-reader 先消费精确候选版本，再并行接入各平台。iOS 新 Expo Module 需重新构建宿主，不能仅 OTA JS 升级。
3. 平台分别完成本地渲染、Pages、选文/菜单/Popover、安全和生命周期证据后才启用对应 PDF 路径；三平台全部满足 spec 才能验收 HAM-46。任何平台门禁不可用必须如实显示 unsupported，不当作完成。
4. 回滚采用恢复包/宿主版本或关闭新 source PDF 路径并显示 unsupported；不自动切回旧 parser 以掩盖失败，也不修改 EPUB renderer、已有保存数据或 host-owned 文件。

## Open Questions

无阻塞提案的产品问题。以下为待工程验证的实现参数，不是用户已确认要求：最终兼容的 `pdfjs-dist` 精确版本、可见页/thumbnail 缓存上限、各 iOS 支持版本的菜单拦截具体 public API。native source 上限和不支持密码交互沿用现有约束/一期收敛假设，需在评审中可见；菜单与选文行为本身不能降级。
