# HAM-278: iOS 本地 PDF 默认入口

本次按 B 方案收缩范围：保留 iOS 本地 PDF Layout 默认进入仓内 PDFKit 的主线交付，撤下双栏宿主、确定性深链接和 OCR seed 调试入口。5.4 的单双栏隔离验收移至 HAM-290；6.4 保持完成。设备截图和操作时间线由 Mac 操作员取证，自动化测试不替代 PDFKit 显示、触控或 Swift 构建证据。

## 路由、身份与保留契约

- `ReaderScreen` 仅对 iOS、本地缓存 PDF、Layout（含未设置模式）直接挂载 `NativePdfReader`。首次没有外层 `ReaderWebView`，权威快照读完才授予编辑写权，不静默回退 Web。
- 已保存的 PDF Text 仍挂载原 `ReaderWebView`。Text/Layout 按钮在 release 也可用，通过既有保存队列和交接屏障修改 `readerData.renderMode`。Web 构建、Android、EPUB 继续原路径；`__DEV__` 的 Web 对照只在 iOS 本地 PDF 手动启用。
- 缺少 `ReaderPdf` 模块或 native view 时显示 dev client 构建提示，不挂外层 Web，也不写快照。Expo Go 不被伪装成支持原生模块。
- `fileId` 沿用 `HostDocumentRecord.fileId`，仍由名称、大小、修改时间和内容摘要按既有规则生成。不同目录同名但内容不同的文件不共享缓存或 V5/v2 快照。
- `ReaderScreen` 的 `paneId` / `isActivePane` 契约保留；原生控制器仍按 ReaderDataStore 对象、paneId、fileId 分桶，事件仍校验 fileId/paneId/sessionId/generation。这些接口及对象级标注补丁留给 HAM-290 修复同对象冲突后恢复双栏使用。
- 演示 App 现在任何路径都只挂载一个 `ReaderScreen`，固定 `paneId='left'`、`isActivePane=true`。没有 split 状态、分栏按钮、活动栏切换或收起分栏流程。仓内 Web 工作区自身的单双栏实现不因本次收缩改变。
- 配置文件切换先关闭旧会话并等待保存；保存拒绝保留旧会话、重试 UI 和待切目标，成功才挂新文件。页头返回或宿主关闭失败后，`closeRequest` 以 `unconfirmed` 结算，下一次返回会从失败态重新 drain，不复用卡住的 Promise。

## 自动化复现

仓库根目录：

```sh
yarn install --frozen-lockfile
yarn test:run test/reader-screen-handoff.test.tsx test/review-handoff.test.tsx test/host-debug-entry.test.tsx test/host-page-render-census.test.tsx test/host-native-documents.test.ts test/pdf-page-render-census.test.ts test/native-pdf-save-diagnostics.test.ts test/native-pdf/held-save.test.tsx test/native-pdf/canonical-delivery.test.tsx test/native-pdf/annotation-controller.test.ts test/native-pdf/ios-ocr-content.test.ts --reporter=verbose
yarn test:run
yarn typecheck
yarn typecheck:host
yarn host:check
yarn lint
```

缺模块用例 `shows the dev-client requirement when the module is absent, writes nothing and never silently mounts Web` 将实际组件依赖的模块构造为 null，断言提示可见、PDFKit view/外层 Web 均不挂载、没有写盘、仍能返回，不是仅检查源码含 throw。

`test/reader-screen-handoff.test.tsx` 保留直接打开/重开、A/B/A/B/A、同名不同内容、存储失败后切书重试、加载失败重试，以及 ReaderScreen 层的 pane 隔离契约。关闭回归覆盖「保存失败 → 页头返回 → 存储恢复 → 再次返回」和「页头失败后宿主 close()」，断言第二次写盘且 revision 递增；Web 非 external 失败分支也覆盖重复返回。`test/host-debug-entry.test.tsx` 另断言旧深链接/环境变量不再启动阅读器，App 任何路径最多挂一个 ReaderScreen。

## Mac / dev client 验证入口

```sh
git rev-parse HEAD
yarn install --frozen-lockfile
yarn host:ios
# 真机可使用 yarn host:ios --device
# 已安装包含 ReaderPdf 的 dev client 后：
yarn host:start --lan
```

入口只有：书库 → 选择/导入本地 PDF → 直接打开。返回书库重开同一 PDF，再 A→B→A→B→A。Text 按钮进入原 Web 重排，Layout 按钮经保存屏障回原生。开发构建的 Web 对照用于同一 V5/v2 快照互读；release 不出现对照按钮。

**确定性深链接、启动环境变量开书、`layout=single|split`、路径导入和 OCR seed 均已撤下，不能用于当前版本。后续由 HAM-290 在修复同对象删除冲突和布局卸载屏障后恢复。** 不要再执行旧文档中的 `hamsterreader://open`、`EXPO_PUBLIC_HAM278_*` 或 `seed` 命令。

记录 SHA、设备/iOS、文件摘要、每次操作时间及截图。首次原生证据应同时具备 `reader-pdf-route` 的 `renderer=pdfkit, outerWebMounted=false`、Swift `documentOpened=true/pageCount` 及实际页面可见。核对 fileId/paneId/sessionId/generation，重开 sessionId 应变化。

注意：不能把所有 `reader-pdf-web-ready` 日志都要求为零。原生路径仍有 canonical 文字提取与自绘 Popover 的内部 Web 服务，此日志带 `role=canonical-popover-service, renderer=pdfkit`；它不绘制 PDF 页面。应检查外层 Web 阅读器未挂载，以及 PDF.js 页面画布 render 调用为零。

S12 设备复跑：canonical 握手 → 自绘色板改色后重开 → A/B 两次往返 → 删除后重开检查 `ranges=0` → 冷远页激活及文字—空白—文字跨页。每步保留原始时间线和快照；Linux 组件用例不视为设备通过。

## 单栏调试与取证诊断

`__DEV__` 调试栏只保留「换源」「渲染计数」「待写保持」「返回书库」，release 不渲染。

### 组 1：PDF.js 页面画布渲染计数

计数器在 `src/pdf/pdfRenderingQueue.ts` 的 `instrumentPdfRenderCensus` 里自增，只在 `renderView` 确实返回 `true` 时 +1。宿主 → Web 使用同一诊断通道：原生模式发给 PDFKit 服务，Web 对照模式发给 Web 页面；宿主统一记 `reader-pdf-page-render-census`。

```text
# 原生（期望 0）
reader-pdf-page-render-census { renderer: 'pdfkit', reason: 'service-ready'|'requested',
  pageCanvasRenders: 0, pdfViewerMounted: false, pdfViewerCanvasNodes: 0,
  pdfjsDocumentPages: 1, fileId, paneId, sessionId, generation }

# Web 对照（期望正数，证明计数器有效）
reader-pdf-page-render-census { renderer: 'web', outerWebMounted: true,
  pageCanvasRenders: 2, pages: [1, 2], pdfViewerMounted: true,
  pdfViewerCanvasNodes: 2, sessionId, requestId }
```

判据：原生 `pageCanvasRenders=0`、`pdfViewerMounted=false`、`pdfViewerCanvasNodes=0` 且 `pdfjsDocumentPages>0`；切「Web 对照」后同一按钮得到 `renderer:'web'` 且 `pageCanvasRenders>0`。

### 组 4：保存屏障时序

换源、返回书库、Text/Layout 切换都走同一屏障：

```text
reader-pdf-handoff-barrier-start  { direction, phase, fileId, paneId, sessionId, generation, retrySave|discard }
reader-pdf-save-barrier-start     { pendingSaves, pendingCommands, retry, ... }
reader-pdf-save-queue             { event: 'queued'|'started'|'confirmed'|'failed'|'drain-start'|'drain-end', pending, ... }
reader-pdf-save-barrier-end       { pendingSaves, waitedMs, result, ... }
reader-pdf-handoff-barrier-end    { direction, status, waitedMs, reason?, ... }
```

判据：`save-barrier-end.result='drained'` 且 `pendingSaves=0` 出现在 `handoff-barrier-end.status='closed'` 之前；`drain-start` / `drain-end` 包住该次 `confirmed`。失败时旧会话保留并可重试。

「待写保持」用于稳定制造待确认写入：点击后 10 秒内点「换源」并选另一个文件。期望 `drain-start(pending≥1)` → `confirmed` → `drain-end(ok=true, elapsedMs>0)` → `save-barrier-end` → `handoff-barrier-end(closed)`，新旧 sessionId 不同。

### 组 5：OCR 握手实现与历史证据判据

当前实现仍在 web-ready 前把 OCR 页面缓存进 `NativeCanonicalDelivery`，握手时标为 `replay:true` 重放；之后实时页面标为 live。历史设备证据按下面顺序判定：

```text
reader-pdf-canonical-publish      { page, bufferedBeforeWebReady: true, ... }
reader-pdf-web-ready              { role: 'canonical-popover-service', bufferedBeforeReady: [...] }
reader-pdf-surface                { event: 'ocr-cache', delivery: 'buffered-replay',
                                    bufferedBeforeWebReady: true, ... }
reader-pdf-surface                { event: 'activate-start', rangeId, pages, ... }
reader-pdf-surface                { event: 'activate-end', materialized: true, ... }
```

握手后才到的页面必须是 `delivery:'live'`、`bufferedBeforeWebReady:false`，所以该标记不是恒 true。`web-ready` 时 `cachedOcrPages=0` 是重放前的正常状态，不能据此判失败。

**当前版本不再提供深链接 OCR seed 入口；旧样本生成和 seed 命令已随入口撤下。** 这里只记录实现与既有证据的判据，不把历史设备步骤写成当前可执行入口。真实 Apple Vision / `extraOCR` 识别质量仍未覆盖。

## 验收记录与范围边界

- 组 1 / 4 / 5 的设备证据来自 `18041c8`（评论 `01a1df35-30e3-7477-952f-dfa0da522743`）。
- 组 2 与 S12 五步的设备证据来自 `82316e0`（评论 `01a1deee-06ee-7b84-9546-06e33dcc2605`）。组 3 双栏不再属于 HAM-278，不作为本任务通过项。
- 上述证据 SHA 与收缩后外观代码的差异仅为移除双栏、深链接、路径导入和 OCR seed 调试宿主，以及关闭失败后的内部状态修复；单栏 PDFKit 渲染、文件身份、持久化数据结构、canonical 投递和保存交接协议未改变，因此组 1/2/4/5 与 S12 证据继续有效。
- 真实 Apple Vision / `extraOCR` 识别质量未覆盖；原生文字长按手势受模拟器 HID `invalidated` 限制，属 tasks 3.2，不在本任务范围；旧 `yarn check:browser` 的基线失败不标为通过。
- 本 change 其他大量任务未完成，不归档、不执行 sync。5.4 改回未勾并注明单双栏隔离移至 HAM-290，6.4 保持已勾。
