# HAM-278: iOS 本地 PDF 默认入口

本次补 `add-ios-native-pdf-reading` 的 5.4 / 6.4 实现。设备截图、S12 操作时间线和最终验收由 Mac 操作员另行补证；本文中的自动化测试不替代 PDFKit 真正显示、触控或 Swift 构建证据。

## 路由和身份

- `ReaderScreen` 仅对 iOS、本地缓存 PDF、Layout（含未设置模式）直接挂载 `NativePdfReader`。首次没有外层 `ReaderWebView`，也没有需要等待的旧 Web 写入者。权威快照读完才授予编辑写权。
- 已保存的 PDF Text 仍挂载原 `ReaderWebView`。正常的 Text/Layout 按钮在 release 也可用，通过原有保存队列和交接屏障修改既有 `readerData.renderMode`。Web 重排、字号、分页、选区代码不变。
- Web 构建、Android、EPUB 不满足原生路由条件，继续原路径。`__DEV__` 的 Web 对照仅在 iOS 本地 PDF 上手动启用；release 无 Web 对照或原生验证按钮。
- 缺少 `ReaderPdf` 模块或 native view 时显示 `yarn host:ios` / dev client / Expo Go 不支持的提示，不挂载外层 Web，不写入快照。用户明确选择 Text 是正常模式操作。
- iOS 的 OCR 辅助模块使用 `.ios.ts` 平台解析，只调用已配置的 `extraOCR`；未配置时明确报错。避免 Metro 把浏览器专用 ONNX/OpenCV 打进 RN（其动态 import 和 Node fs 不兼容）。Web/Android 仍解析原 `.ts` 实现，原有 provider/浏览器解析逻辑不变；文字 ID 前缀函数只做等价提取。
- `fileId` 直接沿用 `HostDocumentRecord.fileId`。导入时由名称、大小、修改时间和内容摘要生成；没有重命名缓存或权威 v2/V5 键。不同目录中同名但内容不同的文件有不同 ID，缓存、持久化和会话不混用。元数据和字节完全相同的副本继续按既有规则视为同一文档，不在这次修改文件身份语义。
- `paneId` 来自配置宿主传入的稳定栏标识；未提供时，每个 `ReaderScreen` 实例用 `expo-crypto.randomUUID()` 生成 `pane-<uuid>`，在该实例切书期间保持稳定。每次打开、重开和重建引擎均生成独立 `sessionId`；引擎重建同时递增 generation。
- 原生控制器按 ReaderDataStore 对象、paneId、fileId 分桶。原生事件同时校验 fileId/paneId/sessionId/generation；只允许活动栏写最近位置，磁盘排队期间失焦也不会覆盖活动栏位置。各栏共享同文件业务快照，运行中的视口和撤销历史独立。
- 配置文件切换先关闭旧会话并等待保存；保存拒绝保留旧会话、重试 UI 和待切目标。成功才挂新文件，旧回调失去写权。

演示 App 默认仍为单栏，单栏时 `ReaderScreen` 固定传 `paneId='left'`。`__DEV__` 的调试栏可以切到分栏：同时挂两个 `ReaderScreen`，分别传 `paneId='left'` / `'right'` 和各自的 `isActivePane`（同一时间只有一栏为 true），两栏可同时打开同一 PDF 或不同 PDF。release 不渲染调试栏，始终单栏。仓内 Web 工作区的单双栏实现保持不变；不要把 Web 双栏截图当原生双栏证据。

## 自动化复现

仓库根目录：

```sh
yarn install --frozen-lockfile
yarn test:run test/reader-screen-handoff.test.tsx test/review-handoff.test.tsx test/host-debug-route.test.ts test/host-debug-entry.test.tsx test/host-debug-ocr-seed.test.ts test/host-native-documents.test.ts test/pdf-page-render-census.test.ts test/native-pdf-save-diagnostics.test.ts test/native-pdf/annotation-controller.test.ts test/native-pdf/ios-ocr-content.test.ts --reporter=verbose
yarn test:run --maxWorkers=2 --minWorkers=1
yarn typecheck
yarn typecheck:host
yarn host:check
yarn lint
```

缺模块用例 `shows the dev-client requirement when the module is absent, writes nothing and never silently mounts Web` 将实际组件依赖的模块构造为 null，断言提示可见、PDFKit view/外层 Web 均不挂载、没有写盘、仍能返回。不是仅检查源码含 throw。

同一测试文件还覆盖直接打开/重开、A/B/A/B/A、同名不同内容、存储失败后切书重试、加载失败重试、不同 pane 的错误投递、活动栏切换及排队失焦进度、release 模式入口和手动 Web 对照。旧手动交接回归仍明确从 Web 起步，保留慢握手、写权、保存失败和真实 Popover 的覆盖。

## Mac / dev client 验证入口

```sh
git rev-parse HEAD
yarn install --frozen-lockfile
yarn host:ios
# 真机可使用 yarn host:ios --device
# 已安装包含 ReaderPdf 的 dev client 后：
yarn host:start --lan
```

入口：书库 → 选择/导入本地 PDF → 直接打开；无需点击「原生 PDF 验证」。返回书库重开同一 PDF，再 A→B→A→B→A。Text 按钮进入原 Web 重排，Layout 按钮经保存屏障回原生。开发构建的 Web 对照用于同一 V5/v2 快照互读；release 不应出现对照按钮。

记录 SHA、设备/iOS、文件摘要、每次操作时间及截图。首次原生证据应同时具备 `reader-pdf-route` 的 `renderer=pdfkit, outerWebMounted=false`、Swift `documentOpened=true/pageCount` 及实际页面可见。核对 `reader-pdf` 中 fileId/paneId/sessionId/generation，重开 sessionId 应变化；同文件两栏的 paneId/sessionId 应不同。

注意：**不能把所有 `reader-pdf-web-ready` 日志都要求为零。** 原生路径仍有用于 canonical 文字提取与自绘 Popover 的内部 Web 服务，此日志现在明确带 `role=canonical-popover-service, renderer=pdfkit` 和会话身份；它不绘制 PDF 页面。应检查外层 Web 阅读器没有挂载，以及 PDF.js 页面画布 render 调用为零。不要通过删除服务日志伪造原生证据。

S12 设备复跑：canonical 握手 → 自绘色板改色后重开 → A/B 两次往返 → 删除后重开检查 `ranges=0` → 冷远页激活及文字—空白—文字跨页。每步保留原始时间线和快照；Linux 组件用例不视为本轮设备通过。

## 调试入口（仅 `__DEV__`，release 不暴露）

设备取证不必依赖 HID 点击。三个入口都在 `__DEV__` 下生效，默认入口（书库 → 原生）语义不变。

**1. 确定性打开入口**：深链接或启动环境变量直接指定 PDF。

```sh
# 深链接（应用已在运行时最可靠；dev client 冷启动可能先停在 launcher）
xcrun simctl openurl booted "hamsterreader://open?fileId=<fileId>"
xcrun simctl openurl booted "hamsterreader://open?path=/absolute/on-device/book.pdf"
xcrun simctl openurl booted "hamsterreader://open?fileId=<fileId>&layout=split"
# 真机（已安装 dev client）
xcrun devicectl device process launch --device <udid> com.hamsternote.reader \
  --terminate-existing "hamsterreader://open?path=/absolute/on-device/book.pdf"
```

```sh
# 环境变量（打包时内联，改完需重启 Metro；优先级 ROUTE > FILE_ID > PDF）
EXPO_PUBLIC_HAM278_ROUTE="hamsterreader://open?fileId=<fileId>&layout=split" yarn host:start --lan
EXPO_PUBLIC_HAM278_OPEN_FILE_ID=<fileId> EXPO_PUBLIC_HAM278_LAYOUT=split yarn host:start --lan
EXPO_PUBLIC_HAM278_OPEN_PDF=/absolute/on-device/book.pdf yarn host:start --lan
```

- `path` 必须是在 App 沙箱内可读的绝对路径；模拟器可先 `xcrun simctl get_app_container booted com.hamsternote.reader data` 拿到容器，再把 PDF 放进 `Documents/`。路径含空格或 `&` 时先做 percent 编码。
- `path` 导入复用选择器的身份规则（名称 + 大小 + 修改时间 + 内容摘要），同一文件重跑同一条链接得到同一个 `fileId`；失败会弹「调试入口失败」并留在书库，不静默打开别的文件。
- 结构化日志：`reader-debug-route`（`source` / `layout` / `target` / `fileId|path` / `ok`）、`reader-pdf-route`（`renderer=pdfkit, outerWebMounted=false`）、`reader-pdf-document-opened`（`documentOpened=true` / `pageCount` / `fileId` / `paneId` / `sessionId` / `generation`）。Swift 侧仍有 `ReaderPdf document ... documentOpened=true pageCount=...`。

**2. 双栏宿主**：阅读中调试栏点「分栏」，两个 `ReaderScreen` 分别用 `paneId='left'/'right'`，另一栏镜像当前文档；「活动：左栏/右栏」切换 `isActivePane`。每栏也可各自「换源」指向不同 PDF（例如不同目录的同名文件）。

**3. 配置换源**：阅读中调试栏点「换源」，从书库选另一个文件。宿主替换配置记录后由 `ReaderScreen` 先关闭旧会话并等待保存（与返回书库同一屏障），保存失败保留旧会话与重试入口，成功才重开新文件。

调试栏、深链接、环境变量与分栏状态都由 `__DEV__` 控制；release 构建只走单栏与原有书库入口。

## 取证诊断（组 1 / 组 4 / 组 5）

三项都只加日志与测试入口，不改渲染、保存屏障或默认入口语义。所有日志经 `logNativePdfDiagnostic` 输出，`__DEV__` 之外静默。

### 组 1：PDF.js 页面画布渲染计数

计数器在 `src/pdf/pdfRenderingQueue.ts` 的 `renderView` 包装里自增（`src/pdf/pageRenderCensus.ts`），也就是 PDF.js 真正提交页面画布渲染的那个点；跳过的不可读页面不计。

读法（Metro / 设备 console）：

```text
reader-pdf-page-render-census { reason: 'service-ready', pageCanvasRenders: 0, pages: [],
  pdfViewerMounted: false, pdfViewerCanvasNodes: 0,
  pdfjsDocumentPages: 1, pdfjsTextPages: 0, webReady: true,
  fileId, paneId, sessionId, generation }
reader-pdf-page-render-census-request { renderer: 'pdfkit', outerWebMounted: false, token: 1 }
```

- 自动一次：canonical 服务在 `service-ready` 时上报（此时 pdfjs 文档已加载完成）。
- 随时再采：调试栏「渲染计数」按钮 → `reader-pdf-page-render-census-request` + `reader-pdf-page-render-census { reason: 'requested' }`。
- 判据：`pageCanvasRenders: 0` **且** `pdfViewerMounted: false` / `pdfViewerCanvasNodes: 0`，同时 `pdfjsDocumentPages > 0`（pdfjs 确实加载了这份 PDF，只是没有绘制页画布）。DOM 侧可交叉核对 `document.querySelectorAll('.pdfViewer canvas').length`。
- 用「Web 对照」切到 Web 渲染时，同一个计数会大于 0 —— 这证明计数器是活的，原生下的 0 不是「没采集」。

### 组 4：保存屏障时序

换源、返回书库、Text/Layout 切换都会走同一条屏障，日志按时间顺序：

```text
reader-pdf-handoff-barrier-start  { direction: 'native'|'web', phase, fileId, paneId, sessionId, generation, retrySave|discard }
reader-pdf-save-barrier-start     { fileId, paneId, sessionId, pendingSaves, pendingCommands, retry }
reader-pdf-save-queue             { event: 'queued'|'started'|'confirmed'|'failed'|'drain-start'|'drain-end',
                                    operationId, pending, waitMs?, elapsedMs?, ok? }
reader-pdf-save-barrier-end       { fileId, paneId, sessionId, pendingSaves, waitedMs, result: 'drained'|'pending-left'|'failed' }
reader-store-write-queue          { fileId, event: 'queued'|'started', queueDepth, waitedMs }   # 仅同一 fileId 有排队时
reader-pdf-handoff-barrier-end    { direction, status, waitedMs, reason?, fileId, paneId, sessionId, generation }
```

判据：`save-barrier-end.result='drained'` 且 `pendingSaves=0` 出现在 `handoff-barrier-end.status='closed'` **之前**；新旧 `sessionId` 不同。`save-queue` 的 `drain-start`/`drain-end` 包住所有 `confirmed`，`waitedMs` 就是真实等待时间。`drain-end.ok=false` 表示保存失败、旧会话被保留（此时不会出现新文档的 `documentOpened`）。

### 组 5：扫描版 PDF 的 OCR 握手

样本随仓库：`test/fixtures/ham278-scanned-sample.pdf`（2 页，每页一张 JPEG，无 `/Font`、无文本对象，pdfjs 提取 0 条文字）+ 同名 `.ocr.json`（OCR 文字种子，含一条跨页范围 `scanned-range-p1-p2`）。

重新生成（需要仓库已有的 playwright Chromium）：

```sh
node scripts/make-scanned-sample.mjs
```

设备上跑：

```sh
CONTAINER=$(xcrun simctl get_app_container booted com.hamsternote.reader data)
cp test/fixtures/ham278-scanned-sample.pdf "$CONTAINER/Documents/"
cp test/fixtures/ham278-scanned-sample.ocr.json "$CONTAINER/Documents/"
xcrun simctl openurl booted "hamsterreader://open?path=file://$CONTAINER/Documents/ham278-scanned-sample.pdf&seed=file://$CONTAINER/Documents/ham278-scanned-sample.ocr.json"
```

也可以 `EXPO_PUBLIC_HAM278_OPEN_PDF=... EXPO_PUBLIC_HAM278_OCR_SEED=... yarn host:start --lan`。`seed` 会把 OCR 文字写进快照 `readerData.ocrTexts` 并自动开启该文档的 OCR；种子无效时弹「OCR 种子加载失败」，不会用空白文字打开。

时间线读法（同一次打开）：

```text
reader-debug-ocr-seed             { fileId, pages: [1,2], texts, ranges: 1 }
reader-pdf-canonical-publish      { page: 1, source: 'geometry-cache', utf16, bufferedBeforeWebReady: true }
reader-pdf-canonical-publish      { page: 2, ..., bufferedBeforeWebReady: true }
reader-pdf-surface                { event: 'ocr-cache', page, beforeWebReady: true, cachedOcrPages }
reader-pdf-surface                { event: 'web-ready', cachedOcrPages: 2, pendingActivates }
reader-pdf-surface                { event: 'activate-start', rangeId, pages: [1,2], source: 'ocr-cache', webReady: true }
reader-pdf-materialize-input      { ... }           # materializeNativeRange 原生侧入口
reader-pdf-surface                { event: 'activate-end', rangeId, materialized: true, elapsedMs, utf16 }
```

判据：`bufferedBeforeWebReady: true` 与 `beforeWebReady: true` 出现在 `web-ready` 之前（说明 OCR/canonical 先到、缓存后重放）；随后 `activate-start` → `activate-end{materialized:true}` 构成完整 activate/materialize 链。激活方式：在原生高亮列表里点 `scanned-range-p1-p2`（不需要长按手势），它会跨页 1→2 激活。

## 验收记录

Linux 自动化：全量 168 个文件 / 2109 个用例通过（只限制 worker 并发数）；定向 56 个用例通过，含 release 保存失败后的恢复入口检查。`typecheck`、`typecheck:host`、`host:check`、`lint` 和 OpenSpec strict validate 均通过。

在 `app` 下运行 `npx expo export --platform ios --max-workers 2 --output-dir ../../evidence/ios-export` 已通过生产 JS/Hermes 打包，不能据此声称 Swift 编译或真机运行已通过。

额外的旧 `yarn check:browser` 未通过：Chromium 的 EPUB/PDF 已进入实际渲染，但初始化快照迁移触发旧脚本断言；WebKit 浏览器未安装。在基线 `ac8b34e` 原代码上执行同命令，26 项结果与当前完全相同；原始两份日志/报告随附件交付，不将此项标为通过。

本轮原始检查输出随 issue 评论附件交付；设备项补证前，tasks 5.4 / 6.4 保持待验收，不把未执行的设备场景勾为通过。不归档或改勾其他任务。
