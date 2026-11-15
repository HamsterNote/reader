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

Expo 演示 App 本身当前是单栏。仓内 Web 工作区的单双栏实现保持不变。本次验证原生双栏使用两个 `ReaderScreen` 实例的配置契约，不新增双栏产品 UI。配置宿主应传 `paneId='left'` / `'right'` 和各自的 `isActivePane`（同一时间只有一栏为 true）；不要把 Web 双栏截图当原生双栏证据。

## 自动化复现

仓库根目录：

```sh
yarn install --frozen-lockfile
yarn test:run test/reader-screen-handoff.test.tsx test/review-handoff.test.tsx test/native-pdf/annotation-controller.test.ts test/native-pdf/ios-ocr-content.test.ts --reporter=verbose
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

## 验收记录

Linux 自动化：全量 168 个文件 / 2109 个用例通过（只限制 worker 并发数）；定向 56 个用例通过，含 release 保存失败后的恢复入口检查。`typecheck`、`typecheck:host`、`host:check`、`lint` 和 OpenSpec strict validate 均通过。

在 `app` 下运行 `npx expo export --platform ios --max-workers 2 --output-dir ../../evidence/ios-export` 已通过生产 JS/Hermes 打包，不能据此声称 Swift 编译或真机运行已通过。

额外的旧 `yarn check:browser` 未通过：Chromium 的 EPUB/PDF 已进入实际渲染，但初始化快照迁移触发旧脚本断言；WebKit 浏览器未安装。在基线 `ac8b34e` 原代码上执行同命令，26 项结果与当前完全相同；原始两份日志/报告随附件交付，不将此项标为通过。

本轮原始检查输出随 issue 评论附件交付；设备项补证前，tasks 5.4 / 6.4 保持待验收，不把未执行的设备场景勾为通过。不归档或改勾其他任务。
