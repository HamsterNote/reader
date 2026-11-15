# HAM-274 Web PDF 加载诊断

默认构建只增加采点，不修复进程终止，不调整 PDF 字节拷贝、会话数量、全页元数据并发、渲染队列或标注持久化。显式启用诊断实验时可限制元数据请求并发、在两个检查点手动暂停。适用于 reader Expo 宿主的 **Web PDF 入口**，不适用于原生 PDFKit。

## 采集方式

Mac 操作员确认构建后，在本提交运行 `yarn build:webview`、`yarn verify:webview`，记录输出的 WebView `buildId`、源码 commit、宿主构建号、设备与 iOS 版本。是否需要装包由操作员按实际宿主构建方式决定；仅更新 Metro 不代表已更新打包 WebView 资源。

从打开前开始采集 Metro/原生 console 和 WebView console，同时录制对应 WebContent PID 与宿主的系统内存 trace；保留同一时段 crash/Jetsam `.ips`。Web 日志以 `reader-pdf-load ` 开头；宿主镜像以 `reader-pdf-load-native` 开头。转发使用独立诊断消息，校验当前 session/token 后打印，不进入保存桥接、不改变握手状态。**应先确认宿主确实收到镜像**；异步 postMessage 在进程突然退出时仍可能丢失末尾消息，不能把“未收到”当作“未执行”。

每次打开/重试/重载生成新 `runId`。同次打开通过 `sequence` 排序，用 UTC `timestamp` 对齐系统日志/内存曲线，用单调时钟 `elapsedMs` 比较耗时。显示引擎的重挂载另有 `viewerId`；不要混合不同 run/viewer 的记录。

## 事件含义

| stage                                        | 已到达的位置                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `display-start`                              | 本次打开已进入 Web display，尚未等待旧资源释放                                        |
| `file-read-start` / `file-read-complete`     | 旧资源释放后，开始/完成整文件读取；完成带 `byteLength`                                |
| `worker-start` / `worker-ready`              | 打包 PDF worker 启动/就绪                                                             |
| `pdf-open-start` / `pdf-open-complete`       | 兼容文档 PDF 会话开始/打开成功；完成带 `pageCount`                                    |
| `metadata-start` / `metadata-complete`       | 兼容文档全部页对象与尺寸处理开始/完成；不代表全页文本提取或 canvas 渲染               |
| `viewer-open-start` / `viewer-open-complete` | PDF.js 显示引擎另一个会话开始/打开完成                                                |
| `pagesinit`                                  | PDF.js 发出 pagesinit，带页数和当时缩放；在应用初始适配前采样，缩放可能尚未初始化     |
| `pagerender`                                 | PDF.js 开始页面渲染，带页号和当时 viewer 缩放                                         |
| `pagerendered`                               | PDF.js 发出页面完成事件，带页号、viewer 缩放、`failed`、`cssTransform`、`renderCount` |
| `scalechanging`                              | PDF.js 缩放事件，带新缩放值（含初始适配和用户缩放）                                   |
| `viewer-open-error` / `display-error`        | 对应打开链抛错；不输出可能含私有路径/内容的错误对象                                   |
| `viewer-detach`                              | 显示引擎 effect 清理开始，不代表异步资源销毁完成                                      |

记录每一条 `pagerendered`，`renderCount=1` 是该 viewer 首个完成事件，终止前最后一条是“最后观察到的完成事件”，**不等待或要求渲染全书**。`failed=true` 不能算成功；`cssTransform=true` 也不能等同于新位图绘制。页号不要求递增，重复渲染照常记录，不缓存页面事件列表。`pagerender` 有而对应完成事件没有，可帮助识别渲染中断，但仍需系统证据。

收到 `onContentProcessDidTerminate` 时，宿主另打印 `reader-pdf-load-native-terminated`，含 UTC 时间与最近收到的一条诊断日志。点击“重载 WebView”清除该摘要；仅保留一个字符串，不缓存 PDF 或历史事件。

日志不含文件名、路径、fileId、正文、标注、令牌或 PDF 字节。没有用 JS heap 估算进程内存，也不把任何阶段停顿自动归因为 OOM。最后成功阶段、操作时间线、系统退出原因及 WebContent 内存 trace 齐备后再做归因；本提交不构成验收第 1/2/3/5 条通过的设备证据。

## 如何跑三组对照

### 构建开关与默认行为

三个开关只由 `vite.webview.config.ts` 读取并固化到 WebView 资源，不是 Expo 运行时开关。必须重建资源、运行 `yarn verify:webview`，并让宿主 JS 与资源都来自同一交付 SHA。仅重启 Metro、修改手机上的 env 或切原生 PDFKit 入口不会启用此实验。

| env                                    | 未设置时                    | 显式诊断设置                                             |
| -------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `VITE_READER_PDF_METADATA_DIAGNOSTICS` | `0`，实验入口关闭           | `1` 启用实验控制                                         |
| `VITE_READER_PDF_METADATA_ONLY`        | `0`，继续正常阅读路径       | `1` 启用两个手动暂停点，完成后释放资源，不进入阅读树     |
| `VITE_READER_PDF_METADATA_BATCH_SIZE`  | `0`，原有全页 `Promise.all` | 仅接受 `0` / `8` / `1`；8 或 1 限制同时在途的 getPage 数 |

不开总开关却设置 ONLY=1 或 BATCH_SIZE=8/1 会在构建时报错；非法值也报错。未设置任何 env 时仍调用原有 `Promise.all`，没有暂停 UI、不改变加载路径。普通构建不包含实验控制面板。开关只影响 Web 宿主的兼容文档元数据，不影响 PDFKit，不修改显示引擎渲染策略或其它文档的默认消费者。

三组均使用 metadata-only；每组先构建、验证并记录 buildId，再由 Mac 操作员按既有方式部署/采集这一组，**不要先连续覆盖三次资源后只装最后一组**。三组 buildId 应不同；分别保留每组的资源包、清单、SHA、命令、设备/PID、原 PDF SHA-256、录屏与原始 trace。

| 组  | DIAGNOSTICS | ONLY | BATCH_SIZE | 要验证的对照                            |
| --- | ----------- | ---- | ---------- | --------------------------------------- |
| A   | `1`         | `1`  | `0`        | 原有全页并发元数据路径                  |
| B   | `1`         | `1`  | `8`        | 最多 8 个在途请求；最终仍保留全页元数据 |
| C   | `1`         | `1`  | `1`        | 串行请求；最终仍保留全页元数据          |

在 repo 根目录构建 A：

```bash
VITE_READER_PDF_METADATA_DIAGNOSTICS=1 VITE_READER_PDF_METADATA_ONLY=1 VITE_READER_PDF_METADATA_BATCH_SIZE=0 yarn build:webview
yarn verify:webview
```

采集 A 后，以同样方式构建 B：

```bash
VITE_READER_PDF_METADATA_DIAGNOSTICS=1 VITE_READER_PDF_METADATA_ONLY=1 VITE_READER_PDF_METADATA_BATCH_SIZE=8 yarn build:webview
yarn verify:webview
```

采集 B 后，构建 C：

```bash
VITE_READER_PDF_METADATA_DIAGNOSTICS=1 VITE_READER_PDF_METADATA_ONLY=1 VITE_READER_PDF_METADATA_BATCH_SIZE=1 yarn build:webview
yarn verify:webview
```

### 每组操作与事件

1. 使用同一设备、同一 PDF、同一 **Web 阅读入口**，从打开前采集宿主和可归属的 WebContent PID 内存曲线。每轮关闭/重开会话，记录 PID 复用情况，不清除用户数据。A/B/C 至少做 3 组配对复现，保持其它条件一致。
2. 确认同一 `runId` 的 `metadata-experiment-config` 显示正确 `batchSize` 和 `metadataOnly=true`，且宿主收到 `reader-pdf-load-native` 镜像。否则此轮无效。
3. `pdf-open-complete` 后出现 `metadata-only-open-paused`，屏幕显示“开始元数据”。此时 **尚无 `metadata-start`**。手动保持暂停，记录 open 后的稳定占用和 UTC 时刻；没有计时自动继续。
4. 点击“开始元数据”，观察 `metadata-only-open-resumed` → `metadata-start` → `metadata-complete` → `metadata-only-complete-paused`。用 `metadata-start`/`metadata-complete` 对齐该阶段高水位，而不是只比较暂停后的两个数。metadata-complete 后会话与全页元数据仍保留，便于比较稳定保留量。
5. 此时阅读树没有挂载，标注迁移/保存未执行，也没有第二个显示会话。**同一 runId 若出现 `viewer-open-start`、`pagesinit`、`pagerender` 或 `pagerendered`，此轮不符合 metadata-only 实验条件。**
6. 完成保留量观察后，点击“结束实验并释放”，依次出现 `metadata-only-complete-resumed` → `metadata-only-releasing` → `metadata-only-released`。最后一个事件表示文档会话 dispose 已等待完成、打包 worker 已终止；资源占用何时回落仍由系统决定。重新打开文件才能开始下一轮。
7. 暂停时“取消实验”、宿主关闭冲刷、dispose 或会话替换会解除暂停并清理资源，输出 `metadata-experiment-cancelled`，不会继续进入阅读树；取消轮不能算完成轮。设备重载整个 WebView 后旧上下文退出，新轮获得新 runId。

这里只保留一份兼容文档会话。分批不会添加 cache cleanup，不会删除字节副本，不会改变最终页号/几何或提前提取文本。没有对 iOS 做人工强制 GC。短峰值可能被低频 Activity Monitor 采样漏掉，应保留能覆盖该阶段的系统内存/分配数据，不能以“没采到峰值”当作不存在。

### 如何解释结果

- **支持并发压力方向：** A 的 metadata-only 阶段可重复出现关联 WebContent 的内存高水位/终止，系统退出原因与内存证据吻合；B/C 明确降低这一阶段高水位，并在配对复现中避免同类终止，最终页数/几何和保留量接近。单次不崩、仅耗时变化、只有宿主 RSS 或最后一条桥接日志缺失，均不足以归因。
- **转查第二会话/渲染：** A/B/C 均完成并在 metadata-only 暂停保持稳定，而完整 Web 阅读路径的增长/终止始于 `viewer-open-start`、`pagesinit`、`pagerender` 之后。元数据仍可能贡献背景占用，但不能当作单独充分原因。另用同 SHA `DIAGNOSTICS=1 ONLY=0 BATCH_SIZE=0` 的完整路径对照；不要在 metadata-only 的第二个暂停点继续打开显示会话。
- **仍然未知：** 缺可归属的 WebContent PID、系统原因或阶段峰值，或者变体间还有其它代码/设备/文件差异。没有 Jetsam 日志也不能自动排除 OOM；3.3 MB、294 页或本地 Node 堆量均不能换算 iOS 阈值。

实验结束后恢复普通资源：在没有相关 `.env` 文件覆盖的情况下执行以下命令，再验证并记录新 buildId。普通包不应出现 `metadata-experiment-config` 或暂停面板。

```bash
VITE_READER_PDF_METADATA_DIAGNOSTICS=0 VITE_READER_PDF_METADATA_ONLY=0 VITE_READER_PDF_METADATA_BATCH_SIZE=0 yarn build:webview
yarn verify:webview
```

## 宿主 Metro 打包边界

React Native 的 Metro 会遍历动态 import。`NativePdfReader` 不可通过共享 OCR 工具引入浏览器的 ImageParser/PaddleOCR/OpenCV；其中 OpenCV 的 Node `fs` 引用会阻塞 iOS Release 打包，错误提示生成时还可能表现为 `Maximum call stack size exceeded`。

`ocrContent.native.ts` 由 Metro 的平台解析选择，只调用已配置的 `extraOCR` provider；原始 data URL、provider 返回的内容和异常都直接保留。未配置 provider 时明确抛错，经现有 `performNativeOcr` 的 `OCR_FAILED` / `onOcrError` 路径处理，不伪造空成功、不清除已确认标注。原生契约不新增默认识别服务；需使用原生 OCR 时必须注入 provider。Web 的 `ocrContent.ts` 继续保留 ImageParser 默认识别，两端共享纯函数 `ocrTextIds.ts`，页级 textId 和透明文字框语义不变。

在 repo 根目录可先独立检查宿主 JS 打包，无需设备或签名：

```bash
mkdir -p artifacts/host-js
cd app
node ../node_modules/expo/bin/cli export:embed --platform ios --dev false --entry-file index.ts --bundle-output ../artifacts/host-js/main.jsbundle --sourcemap-output ../artifacts/host-js/main.jsbundle.map --assets-dest ../artifacts/host-js/assets --max-workers 2
```

成功后检查 sourcemap 的 `sources`：应含 `ocrContent.native.ts` / `ocrTextIds.ts`，不含浏览器 `ocrContent.ts`、ImageParser、PaddleOCR 或 OpenCV。不要用 `fs` 空 shim、排除整段 OCR 或清空识别结果掩盖打包错误。

这一步只验证 Metro 模块图及 Release JS 资源导出；可安装 IPA、签名和设备行为仍由 Mac 操作员验证。源 SHA 变化后，每组宿主包必须与 WebView 资源来自同一新 SHA，并再次核对四组 buildId；不能把这份 JS bundle 或 `webreader.zip` 当成已完成的宿主包。
