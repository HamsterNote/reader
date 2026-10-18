# Tasks

本清单全部为待实施工作，本次 propose 不执行。路径前缀表示负责仓库；难度为相对工程判断，不代表已分派。依赖顺序：1 -> 2；3/4/5 依赖 1、2 的契约与打包产物，完成后进入 6。每个平台内部按编号推进。

## 1. Shared contracts and compatibility（跨仓，中高）

- [x] 1.1 [reader，中] 新增无 DOM 依赖的 PDF source、metadata/page/selection 与 session 契约子入口，统一 1-based 页码和 reader-local 逻辑坐标；以类型测试和 RN consumer bundle 检查验证不引入 ReactDOM/painting。
- [x] 1.2 [reader，中] 为 `Reader.tsx` 增加本地 source 分流入口和页面状态回调，定义 source/document 同传错误，保留旧 document/data/onDataChange API；以旧 API 回归、输入冲突及 PDF/EPUB 互换测试验证。
- [x] 1.3 [native-reader，高] 更新 `types.ts`、`formatDetection.ts` 与入口分流，增加 PDF fixed-layout 支持及 design 所述本地 scheme → 已知正整数大小 → 32 MiB → 最多五字节的布尔签名 probe；分别验证误扩展名、缺 MIME、远程零请求、超过 32 MiB 和未具备平台能力的错误路径。探测不授予后续读取、复制、transfer 或 session 权限。
- [x] 1.4 [native-reader，高] 将 Foliate gate 与 PDF gate 分开接线，保留非 PDF 的完整 Foliate 预检；以 gate 失败测试验证除明确签名 probe 外不进行后续 source I/O、复制/transfer/session 创建，不把 bind 当 ready。
- [x] 1.5 [native-reader，中] 同步 `openspec/specs/local-multi-format-reading`、`reader-component-api`、`foliate-reader-security` 的 PDF 支持、签名 probe 例外和安全门禁适用范围；验证规格与 1.3/1.4 测试预期一致，现有 EPUB CSP/private bridge 场景仍通过。
- [ ] 1.6 [两仓，中] 接入统一 generation 与 teardown 语义，独立保存 PDF 临时页码/选区，禁止进入 EPUB annotation history；以 A->B、PDF->EPUB、source 清空和重复卸载测试验证迟到事件无副作用、host source 未删除。

## 2. Shared PDF.js runtime and React interactions（reader，中高）

- [x] 2.1 [reader，中] 锁定兼容 `pdfjs-dist` 与 worker 精确版本，建立 adapter/runtime 的显式导出和离线资源打包（按版本需要包含 cMap/font/WASM）；以 library build、pack 检查和断网 consumer 加载验证无 CDN 请求与 worker 版本冲突。
- [x] 2.2 [reader，高] 实现独立 PDF.js document/page canvas + text layer，按可见窗口调度/回收页面，关闭脚本/eval/外部文档 action；以多页、旋转、缩放、扫描件与损坏文件测试验证渲染/选文一致和稳定错误。
- [x] 2.3 [reader，中] 实现 PDF 页数/当前页/跳页和按需缩略图接口，缓存与并发设定有限上限；以首页/末页/越界、连续滚动和替换期间 thumbnail 测试验证无串页及局部失败降级。
- [x] 2.4 [两仓，中] 在 DOM 与 RN 外壳分别接入中立 Pages 展示模型，宽屏左栏、窄屏可折叠左栏、页码与当前项可访问状态；以两类视口验证打开/跳页/收起、缩略图占位尺寸和页码降级可用。
- [x] 2.5 [两仓，中] 新增独立 React 选区 Popover 及共享临时状态逻辑，仅显示“高亮”；用 callback/storage spies 验证重复点击不画 annotation、不触发高亮/存储/undo、EPUB 原有高亮回归正常。

## 3. iOS（native-reader，高）

- [ ] 3.1 [高] 创建独立 Swift PDFKit Expo Module 包、expo-module.config.json、podspec、TS wrapper 和 workspace/package 声明，接入 Expo development client；以 iOS 原生构建和外部 consumer 自动链接验证模块可用，缺模块时稳定 unsupported。
- [ ] 3.2 [中高] 封装 PDFDocument/PDFView 本地授权打开、首屏渲染、metadata/page 通知和跳页；以 file URI、失效权限、损坏/加密/超限 fixture 的宿主运行验证正确状态、页数与 1-based 页码。
- [ ] 3.3 [中] 添加按需 PDFPage 缩略图、reader-owned 有界缓存及取消；以 Pages 点击跳转、thumbnail 失败和加载时换源验证页码仍可用、旧缓存/事件不污染新文档。
- [ ] 3.4 [高] 输出 PDFSelection 文本和多 rect，完成 PDFView->RN reader 坐标转换；在缩放、滚动、旋转、安全区和跨页选区下验证 Popover 正确定位或连同选区关闭。
- [ ] 3.5 [高，优先验证] 使用 public API 屏蔽最低支持版本及新版本 iOS 的系统编辑/选区菜单，保留长按和 handles 调整；提交实际 PDFKit 宿主操作证据，证明“菜单不出现 + 可调整选区 + React 高亮按钮无副作用”，不能仅用 mock 或编译代替。
- [ ] 3.6 [中高] 完成 source replacement、后台/卸载事件隔离、通知移除与 security-scoped/临时副本清理；以 PDF->PDF/EPUB 和卸载期间选区/缩略图回调验证无泄漏、无旧 Popover、host 文件未变。

## 4. Android（native-reader，高）

- [x] 4.1 [高] 在 secure-WebView 源 patch/生成链新增独立 PDF host 模式，加载 reader 打包的 PDF.js 产物并维护 exact manifest/MIME/CSP；以 staging 完整性、打包和 Android 编译验证，禁止只编辑 generated 输出。
- [ ] 4.2 [高] 实现限定 `https://appassets.androidplatform.net/pdf-runtime/...` 静态路径与 `/pdf-document/<session>/document.pdf` 动态授权，file/content URI 仅映射当前文档，未命中显式拒绝；以离线渲染及 traversal/编码分隔符/未知资产/旧 token/错误 MIME 请求验证无源泄露与网络 fallback。
- [ ] 4.3 [高] 复用私有 main-frame port 机制建立独立 PDF 消息协议，校验 origin/frame/schema/version/session/generation/command 及负载上限；以错来源、过期事件、畸形选区和重复命令测试验证状态与宿主能力不被改变。
- [ ] 4.4 [中高] 接线 page/thumbnail/selection 事件到 RN Pages 与 Popover，处理 WebView 到 RN 的偏移/缩放；以 file/content URI、多页跳转、旋转/缩放选文与快速换源验证位置和状态同步。
- [ ] 4.5 [高，优先验证] 在 PDF host 原生 WebView 层屏蔽 selection ActionMode/Context Menu，并配合 DOM contextmenu 拦截；以真实 Android WebView 长按、拖 handles、再次选文与占位按钮点击验证不出现原生菜单且选文仍可用。
- [ ] 4.6 [高] 锁定三个 file access 开关为 false，阻止远程资源/导航/popup/下载与 PDF external actions；以 WebView instrumentation/故障矩阵和请求记录验证被拒且不启用 file:// 或公开 bridge fallback。
- [ ] 4.7 [中高] 源替换/卸载撤销动态授权、取消 runtime 任务与关闭 private port，清理 reader-owned 缓存；以旧 URL 重放、迟到事件和 host 文件保留检查验证释放完整。

## 5. Web（reader + native-reader，中高）

- [x] 5.1 [reader，中] demo 本地上传 PDF 使用新 source/PDF.js 路径，EPUB 与旧 document 输入保留原路径；以离线浏览器 E2E 和误扩展名 fixture 验证 renderer 分流、原始文件所有权与 loading/ready/error。
- [x] 5.2 [native-reader，中高] `NativeReader.web.tsx` 增加独立 PDF iframe 接线，消费 reader 精确版本 runtime，校验 window/origin/session 消息，传私有 bytes/blob 而非任意 URI；以 Expo Web export/外部 consumer 和错窗口/错来源消息测试验证。
- [ ] 5.3 [两仓，中] 以 DOM Range/selectionchange 输出 PDF text layer 选区和 reader-local rect，PDF surface 内阻止 contextmenu；浏览器 E2E 验证拖选/长按可用、右键不弹原生菜单、周围页面及 EPUB 行为未变。
- [x] 5.4 [两仓，中] 联调 Pages、缩略图与 React Popover 在宽/窄视口、缩放/旋转及边缘选区的位置；以 Chromium/Firefox/WebKit 浏览器测试记录通过或缺口，WebKit 不冒充真实 Safari 证据。
- [x] 5.5 [两仓，中高] 销毁 PDF loading/render/worker、iframe、监听器与 reader-owned blob URL，禁用 PDF 脚本和外部 action；以加载期间切源/卸载、源 URL 所有权、网络 canary 与重复打开 E2E 验证。

## 6. Cross-platform acceptance and handoff（跨仓，中高）

- [ ] 6.1 [中] 添加可公开使用的 PDF fixture：多页 selectable 文本、旋转页、扫描件、无权限/损坏/加密、误扩展名及 native 超限文件；以 fixture 清单标明每项对应的 spec scenario 和预期错误分类。
- [ ] 6.2 [中] 运行 reader 的 `yarn typecheck`、`yarn test:run`、`yarn build:all`、`yarn pack:check` 与 native-reader 对应已有 type/test/build/consumer 门禁；提交实际命令结果，EPUB 及旧 document 行为不得回归。
- [ ] 6.3 [高] 分别汇总 iOS/Android/Web 的离线本地 PDF、Pages、菜单屏蔽/保留选文、无副作用 Popover、换源清理证据；缺平台证据保持未完成，既有 HAM-35 豁免不作为本需求通过依据。
- [ ] 6.4 [中] 文档更新支持平台、32 MiB native 上限、开发客户端要求、旧 document 兼容与新 PDF 非目标，给出 reader/native-reader 精确配套版本和回滚方式；以外部 consumer 按文档安装验证无跨仓源码路径依赖且无新增持久化需求。
