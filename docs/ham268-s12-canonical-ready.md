# S12 canonical 接收握手

`af947a8` 的 RN 在 WebView 加载前发送 OCR canonical；Web 没接到数据，activate 进入 pending 后只能超时。WebView ref 存在不代表消息接收器已经安装。

这次修复将 canonical 发送改为文件会话内的状态同步：

- `NativeCanonicalDelivery` 保留当前会话产生/从快照重建的 canonical。Web 接收器注册后立即发送一次带完整 identity 的 `web-ready`；RN 校验 fileId/paneId/sessionId/generation 后重放全部缓存。ready 后新结果立即发送，相同页按完整 canonical 去重，文本相同但边界改变仍更新。
- `onLoadStart` 关闭发送并清除已发送记录，保留当前文件缓存；新的 ready 重放。关闭会话清空缓存并拒绝迟到消息。`onLoadEnd` 不作为接收器就绪的依据。
- activate 缺缓存时，pending 队列只发一次 `canonical-request`，但不在这里停下等待。Web 先发不带 offset 的目标页导航，并主动 ensure 高亮覆盖的全部页面；文字 PDF 直接取得 canonical，跨页中间页也包含在内。
- RN refill 除重发会话缓存外，还从持久化 OCR 构造请求页 canonical。目标页缺少几何时，按范围逆序导航取得页面尺寸，最后由 Web 回到高亮起点执行带 offset 的精确跳转并打开菜单。
- Web 可在 PDF 服务建立前接收 canonical。pending 在 PDF 服务就绪后先完成一次提取；只有提取后仍缺 OCR 才启动三秒等待，成功回放会取消计时。回放失败丢弃、dispose/dismiss 清理及 dispose 解绑接收器保持不变。
- readiness 不再以每页 `text.length > 0` 为门槛。完整空映射（空 glyphs + `offset=0` 边界）可直接通过中间页；非空页必须有完整 UTF-16 边界和 glyphs，选区端点 offset 也必须存在。缺边界或端点不满足的扫描页仍等待 OCR，不会把损坏映射交给 materializer。
- 原生历史项区分 ranges 与绘图操作。原生高亮仍按原历史撤销/重做；矩形和笔迹只恢复 rects/pagePaintings，保留当前最新 ranges，因此 Web 新增、删除、改色不会被绘图 undo/redo 整份旧快照覆盖。

## Linux 回归验证

`test/native-pdf/canonical-delivery.test.tsx` 挂载实际 NativePdfReader，模拟 native/WebView 平台边界；`test/native-pdf/web-canonical-ready.test.tsx` 运行实际 Web 接收器、pending、session guard 和 materializer，仅替换 PDF 文件提取与 UI 外观。`interleaved-saves.test.tsx` 通过真实 Host 消息与事务存储覆盖双向交替保存，`diagnostics.test.ts` 检查 Release 日志开关和路径脱敏。

覆盖：① OCR 早于 ready，全部缓存重放；② OCR 晚于 ready，立即发送；③ activate 早于回填，请求一次、最终产生编辑菜单 value；④ A→B→A 后同页号不串文件，旧 session 的 ready/request 被拒绝；⑤ 冷远页文字 PDF 主动提取与导航；⑥ 文字/扫描跨页高亮包含中间页且成功路径无 `activate-wait-timeout`；⑦ 原生矩形与 Web 新增/改色双向交替保存后重开均保留两端最新数据；⑧ undo/redo 与 Web 新增、删除、改色交错时只撤/恢复绘图字段；⑨ 文字—空白—文字和扫描端点 + 空白中间页均能激活并打开菜单。另测 Web reload、同文本新几何、回填先于 PDF 服务、无 OCR 响应超时、损坏映射继续等待以及完整 OCR 到达后只激活一次。

```sh
yarn vitest run test/native-pdf test/webview-host-message-channel.test.ts
yarn typecheck && yarn typecheck:host
yarn host:check
```

## Mac 最小复测

在同一个交付 SHA 上构建并核对 WebView 资源，重开原含高亮的扫描 PDF。应先看到 `reader-pdf-web-ready`，再看到 RN `ocrText` 与 Web `reader-pdf-ocr-cache`（本样本 utf16=13）。点一次已有高亮应走 `reader-pdf-activate-canonical source=ocr-cache`、`materialize-result`，最终出现非空 `web-popover-value` 和编辑按钮。

若 activate 先到，应依次出现 `activate-pending` → RN `reader-pdf-canonical-refill` → `ocr-cache` → `activate-pending-replay`，无 `activate-wait-timeout`。随后改色并重开验证颜色、A/B 往返再次编辑、最后删除并重开确认 ranges=0。失败保留首次完整时间线，不重复点击修正。

本轮另补两条交替保存：原生画矩形 → Web 新增/修改高亮 → 重开，以及 Web 修改高亮 → 原生画矩形 → 重开；两次都必须同时保留最新高亮和矩形。再从第一页点击未访问远页及跨页高亮，允许先出现页级导航和 OCR refill，最终必须到目标 offset 并显示编辑菜单，全程不得出现 `activate-wait-timeout`。

第二轮补充：原生画矩形后做 Web 新增/改色，撤销必须只去矩形；undo 后再做 Web 删除/改色，重做只能恢复矩形，不能复活或回滚 ranges。跨页样本补文字—空白—文字及扫描端点夹空白页，空白页无 OCR 也应能打开编辑菜单；只有端点扫描映射不完整时才允许等待回填。

## P4 自绘色板与裸页面探针

`391f4dd` 在 iPhone 18 Pro 模拟器 / iOS 27.2 的完整 App 中，单击 `Highlight color` 只保留原 ColorWell，没有系统取色器。公开资料对 iOS WebView 的支持报告并不一致，因此不能据此断言所有 WKWebView 都不支持；本修复只确认该任务的内嵌环境没有可用取色器。`webview/color-input-probe.html` 是不含 React、toolbar 或 `preventDefault` 的裸 `input[type=color]` 页面，Mac 应在同一个 WKWebView 环境单独加载、点击并保存截图/AX 结果；Linux 未执行该探针。

正式 popover 已改为 4 列自绘色块，不再依赖系统取色器。色块是原生 button，组名为 `Highlight color`，每块通过 `Highlight color #rrggbb` 访问，支持 Tab/Enter 和当前色 `aria-pressed`。预设包含默认色、既有常见色及 pdfjs 底栏的六个柔和色；历史自定义色作为额外当前色保留。toolbar 的 `mousedown.preventDefault()` 保留，回归验证后续 click 与键盘提交仍会进入原 `onUpdateRange` 链路。

`test/default-popover-color.test.tsx` 覆盖色块可访问性、当前/自定义色、toolbar mousedown 和键盘提交；`test/native-pdf/color-persistence.test.tsx` 覆盖改色 revision 递增与重开、A/B 两轮往返后再次编辑、删除重开 ranges=0。Mac 先记录裸探针，再按 `Highlight color #00ff00` 点击色块，核对磁盘 revision 和新颜色，完成 A/B 与删除步骤。

Linux 测试证明 JS 两侧的真实接线和时序处理；WKWebView 的跨进程投递、真机菜单位置及持久化操作仍需 Mac 完成上述检查。
