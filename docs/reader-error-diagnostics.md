# Reader 白屏诊断（HAM-191）

这些改动用于收集现场异常；白屏根因仍未确认，绘图与 PDF 渲染逻辑未改变。
本次宿主与根边界改动可独立于 PR #56（逐页绘图边界）验证。

## 可见信息

| 失败模式                                          | 截图位置                                                          | console.error 标记                      |
| ------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| WebView `onError` 加载失败                        | 原生阅读页内的错误面板，含 description、code、domain              | `Reader WebView host error` + `onError` |
| WebView `onHttpError` HTTP 错误                   | 同一面板，含 HTTP 状态码和 description（平台提供时）              | 同上 + `onHttpError`                    |
| iOS 内容进程终止                                  | 同一面板，含 `onContentProcessDidTerminate`；系统没有提供具体原因 | 同上 + `onContentProcessDidTerminate`   |
| Android 渲染进程退出                              | 同一面板，含 `onRenderProcessGone` 和 `didCrash=true/false`       | 同上 + `onRenderProcessGone`            |
| 原生 React 应用渲染异常（包括书库、宿主页）       | 应用根兜底，含 `app-root` 和异常消息                              | `Reader app root render error`          |
| Web React 阅读树渲染异常（包括 PDF 页之外的组件） | 阅读入口根兜底，含 `web-root` 和异常消息                          | `Reader web root render error`          |

根边界仅在各自开发模式下显示 React 组件栈；生产只显示消息，日志始终保留错误对象和组件栈。
WebView 资源由 `yarn build:webview` 默认构建为生产模式，即使在 dev client 中也不展示 Web 组件栈。
原生日志在 Metro/设备日志中查看；Web 根日志需查看 WebView console，Metro 未必转发。

原生错误面板位于 WebView 之外，因此 WebView 进程退出后仍可显示。加载完成、迟到的桥接消息、握手超时均不会清掉原生诊断信息。
用户点击“重载 WebView”才清除信息；不会自动重载，宿主会话和已确认快照继续保留，未确认编辑仍可能丢失。
根边界也不会自动恢复，需重新加载应用/WebView。

## 仍不可见的情况

- 整个原生应用/宿主 JS 运行时崩溃、被系统杀死或卡死，无法保证任何兜底 UI 和日志送达。
- ErrorBoundary 不捕获事件处理器、计时器、ResizeObserver、Promise 拒绝等异步回调异常，也不捕获模块加载/根挂载前错误。
- 没有抛错或触发宿主回调的空白（例如样式/布局问题、空 canvas、引擎静默停滞）没有新的诊断信息。
- `onError` / `onHttpError` 的覆盖范围取决于原生 WebView。不能保证看到所有子资源、PDF worker、`file://` 读取失败；这些仍需资源/引擎自身日志。
- 进程退出回调本身不能定位底层崩溃原因；Android 只额外提供 `didCrash`，仍可能需要系统崩溃日志。

## 现场验证

1. 使用本 PR 的代码，运行 `yarn build:webview`，重启 Metro，重新加载 dev client。没有原生依赖或配置变更，本次无需 prebuild。
2. 打开 PDF，切绘图并复现。截取完整错误面板/根兜底文案（长文本可滚动、选择），同时提供平台、dev client 构建 commit 和代码 commit。
3. 若仍是纯白且没有任何文案，明确反馈这一点，并提供 Metro、WebView console、设备崩溃日志。

自动回归测试通过 mock WebView 事件检查回调绑定、可见文案、日志、迟到事件不覆盖诊断、显式重载保留宿主会话，以及两个根边界的开发/生产显示。它不能替代 iOS/Android 原生事件投递和真实进程崩溃的设备验证。
