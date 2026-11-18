# HAM-278 / HAM-290: iOS 本地 PDF 默认入口与双栏调试宿主

HAM-278 保留 iOS 本地 PDF Layout 默认进入仓内 PDFKit 的主线交付。HAM-290 在修复同对象标注冲突和布局卸载屏障后，恢复 `__DEV__` 双栏宿主与确定性深链接。OCR seed 调试入口不在本次恢复范围内。设备截图和操作时间线由 Mac 操作员取证，自动化测试不替代 PDFKit 显示、触控或 Swift 构建证据。

## 路由、身份与保留契约

- `ReaderScreen` 仅对 iOS、本地缓存 PDF、Layout（含未设置模式）直接挂载 `NativePdfReader`。首次没有外层 `ReaderWebView`，权威快照读完才授予编辑写权，不静默回退 Web。
- 已保存的 PDF Text 仍挂载原 `ReaderWebView`。Text/Layout 按钮在 release 也可用，通过既有保存队列和交接屏障修改 `readerData.renderMode`。Web 构建、Android、EPUB 继续原路径；`__DEV__` 的 Web 对照只在 iOS 本地 PDF 手动启用。
- 缺少 `ReaderPdf` 模块或 native view 时显示 dev client 构建提示，不挂外层 Web，也不写快照。Expo Go 不被伪装成支持原生模块。
- `fileId` 沿用 `HostDocumentRecord.fileId`，仍由名称、大小、修改时间和内容摘要按既有规则生成。不同目录同名但内容不同的文件不共享缓存或 V5/v2 快照；完全相同的副本继续共享文档身份。
- `ReaderScreen` 使用稳定的 `paneId='left'/'right'` 和独立 `sessionId/generation`。控制器按 ReaderDataStore 对象、paneId、fileId 分桶，事件校验 fileId/paneId/sessionId/generation；只有活动栏保存最近位置。
- 演示 App 默认单栏。`__DEV__` 调试栏可以分栏、切换活动栏、换源、采集渲染计数和制造待写窗口；release 不渲染调试栏，也不注册深链接或读取启动环境变量。
- 配置文件切换先关闭旧会话并等待保存；保存拒绝保留旧会话和重试入口。页头返回或宿主关闭失败后，下一次返回会从失败态重新 drain，不复用卡住的 Promise。

## 同对象冲突与撤销/重做规则

标注保存不再用某一栏的整份旧快照覆盖另一栏。`src/nativePdf/annotationPatch.ts` 对 range、rect 和页内 painting object 生成对象级补丁，并在 `ReaderDataStore.updateSnapshot` 的权威基线上应用。每文件写队列给出确认顺序，补丁操作规则如下：

1. **create**：仅目标 ID 不存在时插入。另一栏已经创建或重建同 ID 对象时，本次创建作为冲突跳过，不覆盖现有对象。
2. **update / recolor**：仅目标对象仍存在时替换整个对象；对象存在时，并发修改按确认顺序后者覆盖前者，不做字段级合并。目标已被另一栏删除时，过期修改作为冲突跳过，不能重新插入。
3. **delete**：删除当前目标；目标已经不存在时保持删除结果。删除只影响同 ID 对象，另一栏的其他 range/rect/painting object 保留。
4. **restore**：只由“撤销自己的删除”产生，目标不存在时恢复。普通新增、改色以及撤销/重做修改都不能使用 restore 绕过删除冲突。
5. **undo / redo**：撤销新增是 delete，重做删除也是 delete；撤销删除是 restore，重做新增是 create。撤销/重做 recolor 仍是 update，因此目标已被另一栏删除时同样跳过，不复活对象。目标已由另一栏重建时，restore/create 不覆盖它。

冲突只跳过对应对象，同事务中的其他对象修改仍保存。宿主提交本次合并后的快照、显示“目标已在另一栏删除或重建”的提示并记录 `reader-pdf-annotation-conflict`，随后重新水合权威快照；不会把同一个过期操作留在保存队列里无限重试。该规则不新增持久化字段，以补丁操作类型和权威快照中的目标对象状态判定冲突。

## 布局切换的异步关闭屏障

返回书库、按钮收起分栏以及深链接 `layout=single` 都使用 App 的同一个 `runHostClose`：

- 需要卸载的栏先调用各自 `ReaderScreen.close()`，并行等待全部结果；只有全部 `closed` 后才提交新的 panes/split 状态并卸载。
- 任一栏 `unconfirmed` 或抛出关闭错误时，原栏、原文件和分栏状态全部保留。宿主 Alert 的“重试”重新执行同一个关闭动作。
- 关闭进行中收到新的深链接时，只排队一个后续动作，不提前改变布局；原动作成功并完成重试后才执行排队路由。
- 深链接换成 `layout=split` 不需要卸载栏，也通过同一串行入口提交，避免与正在进行的关闭交错。

原生关闭继续输出以下日志，不能因恢复调试宿主而删除：

```text
reader-pdf-handoff-barrier-start  { direction, phase, fileId, paneId, sessionId, generation }
reader-pdf-save-barrier-start     { pendingSaves, pendingCommands, retry }
reader-pdf-save-queue             { event: queued|started|confirmed|failed|drain-start|drain-end }
reader-pdf-save-barrier-end       { pendingSaves, result: drained|pending-left|failed }
reader-pdf-handoff-barrier-end    { direction, status: closed|unconfirmed, waitedMs, reason? }
```

成功收栏的判据是目标栏 `handoff-barrier-end.status='closed'` 先于卸载；失败时只出现 `unconfirmed`，两栏保持挂载。真实 App 集成用例还记录测试原生视图的卸载事件，断言其位于最后一次成功 `closed` 之后。

## 自动化复现

仓库根目录：

```sh
yarn install --frozen-lockfile
yarn test:run test/native-pdf/annotation-patch.test.ts test/native-pdf/annotation-controller.test.ts test/native-pdf/interleaved-saves.test.tsx test/reader-screen-handoff.test.tsx test/host-debug-entry.test.tsx test/host-debug-route.test.ts test/host-native-documents.test.ts --reporter=verbose
yarn test:run
yarn typecheck
yarn typecheck:host
yarn host:check
yarn lint
```

关键覆盖：

- `does not resurrect a highlight deleted by the other pane while a recolor is queued`：左栏矩形保存受阻 → 右栏删除 R → 左栏改色 R → 释放，最终磁盘 `ranges=[]`，并显示冲突提示。
- `keeps the other pane object and applies the last confirmed recolor to a shared object`：同对象并发改色按确认顺序结算，另一栏 keeper 与左栏矩形均保留。
- `native annotation object conflict matrix`：覆盖 add/delete/recolor/undo/redo、过期 update、撤销自己的删除和 redo 删除，断言最终对象数量与内容。
- `drains a failed right-pane save across a deep link and unmounts only after closed`：真实 App + ReaderScreen + ReaderDataStore 注入右栏写盘失败，失败后双栏保留并可重试，检查屏障日志与卸载顺序。
- `queues a deep link behind an in-progress host close`：深链接不会绕过正在进行的宿主关闭。

## Mac / dev client 验证入口

```sh
git rev-parse HEAD
yarn install --frozen-lockfile
yarn host:ios
# 真机可使用 yarn host:ios --device
# 已安装包含 ReaderPdf 的 dev client 后：
yarn host:start --lan
```

普通入口：书库 → 选择/导入本地 PDF → 直接打开 PDFKit。开发构建点「分栏」后，两栏分别使用 `left/right`；再点「活动：左栏/右栏」切换焦点。Text 按钮进入原 Web 重排，Layout 按钮经保存屏障回原生。

### 确定性深链接与环境变量（仅 `__DEV__`）

```sh
# 书库已有 fileId；应用运行时发送最可靠
xcrun simctl openurl booted "hamsterreader://open?fileId=<fileId>&layout=split"
xcrun simctl openurl booted "hamsterreader://open?fileId=<fileId>&layout=single"

# 设备绝对路径导入；路径含空格或 & 时先 percent 编码
xcrun simctl openurl booted "hamsterreader://open?path=<percent-encoded-absolute-path>&layout=split"

# 启动环境变量；修改后重启 Metro，优先级 ROUTE > FILE_ID > PDF
EXPO_PUBLIC_HAM278_ROUTE="hamsterreader://open?fileId=<fileId>&layout=split" yarn host:start --lan
EXPO_PUBLIC_HAM278_OPEN_FILE_ID=<fileId> EXPO_PUBLIC_HAM278_LAYOUT=split yarn host:start --lan
EXPO_PUBLIC_HAM278_OPEN_PDF=/absolute/on-device/book.pdf yarn host:start --lan
```

`fileId` 可从普通打开时的 `reader-pdf-route` / `reader-pdf-document-opened` 日志取得。`path` 必须是 App 沙箱内可读的绝对路径或 `file://` URI；模拟器可用 `xcrun simctl get_app_container booted com.hamsternote.reader data` 获取容器。路径导入沿用选择器的文件身份规则。

### 双栏同文件编辑时间线入口

1. 用同一 `fileId` 以 `layout=split` 打开，确认两栏日志的 fileId 相同，paneId/sessionId 不同。
2. 左栏新增高亮 R，等待保存确认；右栏确认 R 同步出现。右栏新增另一高亮 K，左栏画一个矩形，等待两栏刷新，确认 R/K/矩形都在。
3. 点左栏「待写保持」制造 10 秒待确认窗口；窗口内右栏改色 K、左栏改色 R。等待 `drain-end` 后重开，按确认顺序检查最终颜色，K/R/矩形均不得丢失。
4. 再制造一次左栏待写窗口，右栏删除 R、左栏尝试改色 R。等待队列结算后，R 应保持删除，K 与矩形保留；左栏出现冲突提示并记录 `reader-pdf-annotation-conflict`。
5. 发送同文件 `layout=single` 深链接。正常保存时只在右栏 `closed` 后收栏；写盘失败注入与卸载先后由上述真实 App 自动化用例覆盖，不把未注入的设备操作当作故障证据。
6. 记录每步时间、SHA、fileId/paneId/sessionId、revision 和最终快照对象 ID/数量；设备时间线由 Mac 操作员补证。

OCR seed、`EXPO_PUBLIC_HAM278_OCR_SEED` 和 `seed=` 命令仍未恢复，不属于 HAM-290 的验收入口。

## 其他诊断与历史证据边界

- PDF.js 页面画布渲染计数仍由「渲染计数」采集。原生期望 `pageCanvasRenders=0`、`pdfViewerMounted=false`；Web 对照应得到正数，证明计数器有效。
- 原生路径仍有 canonical 文字提取与自绘 Popover 的内部 Web 服务。`reader-pdf-web-ready role=canonical-popover-service` 不代表挂载了外层 PDF.js 阅读器。
- HAM-278 组 1/4/5 的设备证据来自 `18041c8`，组 2 与 S12 五步来自 `82316e0`；这些历史证据不冒充 HAM-290 双栏冲突修复的设备通过项。
- 真实 Apple Vision / `extraOCR` 识别质量、原生文字长按手势和 Swift 编译不因 Linux 自动化通过而标记完成。OpenSpec 5.4 在双栏设备验收前保持未勾，本 change 不归档、不执行 sync。
