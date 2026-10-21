# Expo 宿主（HAM-90, tasks 4.1–4.5）

reader 的 Expo dev client 宿主与 WebView 桥接。Web 阅读层仍是原 reader 库的
消费方；宿主只负责选文件、受控缓存、文件级持久化、WebView 生命周期和安全边界。
EPUB/PDF 引擎由主线 A/B 通过 `ReaderEngineAdapter` 接入，本分支提供契约桩与
资源自检页。

## 固定版本

| 组件                               | 版本                                           |
| ---------------------------------- | ---------------------------------------------- |
| Expo SDK                           | 54.0.37                                        |
| React Native                       | 0.81.5                                         |
| React                              | 19.1.0                                         |
| expo-dev-client                    | ~6.0.18                                        |
| react-native-webview               | 13.15.0                                        |
| expo-file-system                   | ~19.0.17                                       |
| pdfjs-dist（worker/字体/CSS 来源） | 5.4.530（`@hamster-note/pdf-parser` 传递依赖） |
| foliate-js                         | `78914aef4466eb960965702401634c2cb348e9b1`     |

`npx expo install --check` 无过时依赖。foliate-js 源文件与本机 pin 记录在
`vendor/foliate-js/`（MIT，见同目录 `LICENSE`、`PIN.md`）；`pdfjs-dist`
（Apache-2.0）的 `LICENSE` 一并打包到 `webview-dist/pdfjs/`。

## 构建命令

```bash
yarn install --frozen-lockfile

# 1. 构建 Web 阅读入口 + Foliate ESM + PDF worker/字体/CSS，
#    生成清单与 app/assets/webreader.zip
yarn build:webview

# 2. 校验清单（缺任一必需资源即退出码 1）
yarn verify:webview

# 3. 生成原生工程（首次或配置变化后）
cd app && npx expo prebuild

# 4. 构建并安装 dev client
yarn host:android   # 需要 Android SDK + JDK 17
yarn host:ios       # 需要 macOS + Xcode
```

`yarn build:webview` 的产物：

- `webview-dist/`：`index.html`、`assets/webview.{js,css}`、`foliate/*`、
  `pdfjs/{pdf.worker.min.mjs,pdf_viewer.mjs,pdf_viewer.css,standard_fonts,cmaps}`。
- `webview-dist/asset-manifest.json`：每个文件的 SHA-256、大小、Content-Type，
  以及 `buildId` 和必需资源列表。
- `app/assets/webreader.zip`：同一批文件的压缩包；Metro 只打包这一个资产。

应用启动时把 zip 解压到
`documentDirectory/webreader/<buildId>/`，WebView 从该目录加载；版本变化时
重新写入。阅读入口不依赖开发机 Vite 服务或 CDN。

## 数据与桥接

- `src/host/readerHostSession.ts`：绑定 HAM-87 契约状态机，固定
  `open → restore` 顺序，重载后重发最后确认快照。
- `src/bridge/hostSession.ts`：增加异步持久化入口
  `handleWebMessageAsync`；ack 在落盘后返回，落盘失败回滚快照。
- `src/host/readerDataStore.ts`：每个文件一个键
  `reader.host.v1.doc.<fileId>`，索引单独存放；单文件索引损坏不影响其他文件。
- 文件 ID 由文件名、大小、修改时间经 SHA-256 生成，不把用户文件名拼进路径。
- 旧 JSON 导入支持 v2/v3/v4 顶层结构；原对象保留在 `snapshot.data.highlights`
  交给 Web 层现有 `parseHighlights`。
- 大文件只传递受控本地 URL；桥接消息上限 1 MiB，不会整包 base64 复制文档。

## 安全边界

- WebView 每个会话注入随机 `sourceToken`；宿主只接受带正确 token 的
  postMessage，伪造/缺失 token 不进入状态机。
- 包络、类型、会话、版本、revision 由契约状态机校验；未知类型和旧会话拒绝。
- 顶层导航仅允许阅读资源目录内的 `file://` 和 `about:blank`；http(s) 交给
  系统浏览器，`javascript:`/`data:`/`intent:`/`content:` 一律拦截。
- WebView 设置：`allowFileAccess=true`、`allowFileAccessFromFileURLs=true`、
  `allowUniversalAccessFromFileURLs=false`、`mixedContentMode=never`、
  `setSupportMultipleWindows=false`、`javaScriptCanOpenWindowsAutomatically=false`。
- 页面 CSP 禁止 object/表单/外部顶层提交；`frame-src` 限制为自身资源。
- 出版物脚本隔离由引擎适配层实现（Foliate sandboxed iframe）；本分支
  不直接渲染出版物 HTML，宿主只加载受控外层入口。

## 本地已验证

- `yarn test:run`：62 个文件、959 例通过（含新增 43 例宿主/桥接测试）。
- `yarn typecheck`、`yarn typecheck:host`、`npx eslint .` 通过。
- `npx expo config --type public` 通过。
- `npx expo export --platform android` 成功，bundle 内含 `webreader.zip`。
- `npx expo prebuild --platform android` 成功生成原生工程。
- `yarn build:webview` 生成 233 个资源、`webreader.zip` 约 2.0 MiB。
- 删除 `foliate/epub.js` 后 `yarn verify:webview` 以退出码 1 失败。
- Chromium（HTTP 静态服务）加载阅读入口：ready/open/restore 状态更新正常；
  6 项资源自检全部通过（清单、PDF worker 脚本、viewer CSS、标准字体、
  Foliate ESM、PDF module worker 启动）。
- Chromium `file://`（`--allow-file-access-from-files`，对应 WebView
  `allowFileAccessFromFileURLs`）加载 `index.html?selftest=1`：classic 主脚本、
  CSP、相对资源、`file://` 模块读取与 Blob module worker 全部通过。PDF worker
  以 Blob URL 启动，避开 `file://` 下 module worker 被浏览器拒绝的问题。
- Android debug dev client：`./gradlew assembleDebug` 成功（Gradle 8.14.3、
  JDK 17、`compileSdk` 由 Expo 预构建生成），产物
  `app/android/app/build/outputs/apk/debug/app-debug.apk`（约 139 MB）。
- Android release APK：`./gradlew assembleRelease` 成功，`assets/index.android.bundle`
  与 `res/H_.zip`（2,016,518 B，SHA-256 与 `app/assets/webreader.zip` 完全一致）
  均在 APK 内，证明资源随应用交付。
- iOS 工程：`npx expo prebuild --platform ios` 成功生成工程；Linux 无 Xcode，
  未编译。

## 未验证 / 阻塞

- **Android dev client 真机/模拟器**：本机无 `/dev/kvm`、`adb devices` 为空，
  无法安装/启动 APK；设备上的 file:// 资源读取与真实文档引擎仍需实机验证。
- **Release APK 离线资源**：release 构建结果见交付评论；未在设备上断网验证。
- **iOS**：Linux 环境无法运行 Xcode，未构建、未验证。
- **真实 EPUB/PDF 打开**：依赖主线 A/B 的引擎适配器；当前 Web 入口为契约桩，
  尚未渲染真实文档。
- **伪造消息/外部导航的设备测试**：策略层与单元测试已覆盖；Android
  WebView/WKWebView 实机样本未运行。
- **大文件分块传输**：当前只传本地 URL，未实现/验证内存受限时的分块回退。
