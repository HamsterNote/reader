# HAM-274 Web PDF 加载诊断

本提交只增加采点，不修复进程终止，不调整 PDF 字节拷贝、会话数量、全页元数据并发、渲染队列或标注持久化。适用于 reader Expo 宿主的 **Web PDF 入口**，不适用于原生 PDFKit。

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
