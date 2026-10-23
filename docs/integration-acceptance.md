# HAM-91 集成验收记录

日期：2026-10-23。基线 `237c0d51a4fc76d8c6f233bd2598ac7a14d12500`。
分支 `agent/ham-91-integration`，合入 EPUB `622befc`、PDF `233db4f`、
Expo `587f26f`。本记录交付可测试的集成实现，**不是完整矩阵通过声明**。
本文保留 HAM-91 当时的结果；HAM-103 的后续实现与验收见 `docs/ham103-acceptance.md`。
设备和完整交互门槛通过前不切默认路由、不删除旧展示链路。

## 接线与启动

- 公共 `Reader` 新增可选 `engineSource: { format, data, workerSrc?, documentOptions? }`。
  原始字节不写入 ReaderData；调用方应按文件 memoize source。
- EPUB 两种模式使用 Foliate，PDF Layout 使用官方 PDFViewer，PDF Text 使用兼容文本文档。
  不传 `engineSource` 的旧消费者，以及 TXT/Markdown/DOCX/图片，沿用原入口。
- Demo 手动选择新引擎：`yarn dev --host 127.0.0.1`，打开终端显示的地址并加
  `?engines=next`，再选择 EPUB/PDF。无参数默认使用旧入口。
- Expo 的 `webview/src/main.tsx` 已替换诊断桩：真实打开、restore、渲染、编辑、保存。
  原诊断源保留为 `webview/diagnostics.html`，不在当前生产资源包内。

```bash
yarn install --frozen-lockfile
yarn build:webview
yarn verify:webview
yarn typecheck:host
# 以下命令从仓库根目录运行，需对应 SDK/设备
yarn host:prebuild
yarn host:android
yarn host:ios
```

`host:ios` 要求 macOS/Xcode；Android 要求 SDK/JDK。生成的 zip 不提交，构建原生包前
必须重新执行 `build:webview`。运行时不依赖 Vite/CDN；设备断网验收仍未完成。

## 自动检查

环境：Linux Ubuntu 26.04、Node 24.15.0、Yarn 1.22.22。

| 命令                                         | 结果及边界                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `yarn typecheck`                             | 通过                                                                                                                                 |
| `yarn typecheck:host`                        | 通过，包含 Expo 严格索引检查                                                                                                         |
| `yarn lint`                                  | 通过                                                                                                                                 |
| `yarn test:run`                              | 81 文件、1118 项通过；既有 act/font 警告仍存在                                                                                       |
| `yarn build`                                 | 库、类型、CSS 与 demo 构建通过                                                                                                       |
| `yarn build:webview` / `yarn verify:webview` | 通过，293 个资源，zip 约 15.34 MiB                                                                                                   |
| `yarn pack:check`                            | 通过，281 个发布文件                                                                                                                 |
| `node scripts/check-delivery.mjs`            | npm tarball 的旧 `document` API、公共 CSS 导入、Vite 客户端构建及打包 SSR 通过；删除必需的 `pdfjs/wasm/openjpeg.wasm` 后校验正确失败 |
| `yarn check:browser`                         | 总退出码 1：Chromium 13/13 通过，WebKit 13 项 unavailable，详见下表                                                                  |

旧消费者检查使用 npm tarball 加本次安装的依赖版本，不代表所有历史依赖组合。
原生 Node ESM 直接运行打包入口仍会遇到现有 `@hamster-note/painting` 的无扩展名
内部导入问题；通过的是 Vite 打包后的 SSR，与仓库现有 SSR 测试工具链一致。
构建有既有 OCR/OpenCV 大包、Node 内置模块 externalized 和 PDF CSS 图片路径警告；
图片由构建脚本复制到对应 CSS 路径。未在此任务中重构 OCR。

## 浏览器证据

`scripts/check-reader-browser.mjs` 加载实际 WebView 构建入口和真实 Foliate/PDF.js，
模拟宿主协议而非原生 WebView。可用 `READER_BROWSER_CASE=chromium` 过滤，
`READER_BROWSER_OUTPUT` 指定产物目录。JSON 报告与截图随 issue 评论附件交付。

| 浏览器 / 视口                | EPUB v2/v3/v4    | PDF v2/v3/v4     | 额外检查                                                     |
| ---------------------------- | ---------------- | ---------------- | ------------------------------------------------------------ |
| Chromium / 1280×800          | 3/3 通过         | 3/3 通过         | v4 鼠标端点编辑；PDF 矩形确认、角点编辑、undo/redo           |
| Chromium / 390×844、hasTouch | 3/3 通过         | 3/3 通过         | Popover 真实 tap；不等价于原生长按                           |
| Chromium 出版物脚本探针      | 1/1 通过         | 不适用           | XHTML script/onerror/iframe/SVG 注入未执行，未产生初始化写入 |
| WebKit / 两种视口            | 未通过：无法启动 | 未通过：无法启动 | 缺 ICU74、libxml2、libevent、libflite 等发行版依赖           |

每个数据用例在真实文本层创建浏览器 Range，再点击高亮并重载；验证旧范围、矩形、
绘图、评论、书签未改变，初始化产生 0 次写入，新增端点仍为公共 `page-N`。
PDF 额外检查 canvas 像素包含实际字形。鼠标端点编辑保留 ID、createdAt 和起点。
这不代表全部选择手势、全部样本视觉定位或逐页回收已经验收。

`test/reader-snapshot-compat.test.ts` 另验证六组 v2/v3/v4 数据：导入、改样式、
交给旧读入器、再恢复，比较 ID/时间戳/端点/坐标/样式/绘图/评论/书签/进度，
并保留额外宿主字段。结构往返与浏览器编辑证据互补，不替代完整人工矩阵。

## 设备矩阵与未通过门槛

| 平台            | 环境事实                                 | 打开/保存/重开 | 横竖屏/长按/后台/重试 | 断网/安全边界 |
| --------------- | ---------------------------------------- | -------------- | --------------------- | ------------- |
| iOS / WKWebView | Linux，`xcrun ENOENT`，无可用 iOS 模拟器 | 未通过         | 未通过                | 未通过        |
| Android WebView | adb 可执行，设备列表及 AVD 列表均为空    | 未通过         | 未通过                | 未通过        |

前置分支的 APK 构建和诊断资源自检是历史证据，不是本次真实阅读集成的设备验收。
没有本次 dev client 截图或录屏；桌面移动视口截图不能替代设备证据。

HAM-103 已补齐 EPUB Layout 矩形/绘图/裁切、跨章节端点、放大镜与旧选择回调，
并提交隐藏页、标注拖出和页面回收的 Chromium 桌面/移动宽度证据，详见后续验收记录。
审核发现的放大镜出版物 DOM 越界已改为资源地址和属性均不传递的静态呈现树；
双宽度恶意 EPUB 回归检查宿主样式（含瞬时污染）、资源请求和非空截图，旧实现
负向对照能检出漏洞。自定义字体、背景图和内联 SVG 等快照保真限制见
`docs/ham103-acceptance.md`，该浏览器结果不替代设备安全验证。
仍需完成以下门槛：

- 所有原生设备操作、断网与跨文件读取/伪造消息的设备检查均未通过。
- 尚未切默认路由，尚未移除旧主展示实现。

## 资产、数据备份与回滚

资产清单记录文件大小、SHA-256、必需文件和 buildId。宿主把受信任资源与当前文件
分级复制到 `documentDirectory/reader-sessions/<fileId>/<buildId>/`，只给这个根读取权限；
完成标记在全部复制后写入，失败会重试。原始导入文件保留在 `reader-files/`。

切换默认值或导入旧 JSON 前，备份原 JSON、浏览器对应文件的 localStorage 和原生
`documentDirectory/reader-host/`、`reader-files/`。每个宿主文件记录为
`reader-host/reader.host.v1.doc.<fileId>.json`，业务数据位于 `snapshot.data` 的
`highlights`、`comments`、`readerData`。请备份整个记录，保留版本、revision 和其他字段。
`reader-sessions/` 是可重新生成的缓存，不能拿它替代原文件或数据备份。

浏览器回滚：去掉 `?engines=next`。库消费者回滚：不传 `engineSource`。
没有更改高亮 JSON v2/v3/v4 格式；回归测试已证明旧读入器可读取新输出。
代码回滚以基线 `237c0d5` 或原已发布版本重新构建，先备份数据再操作；
不要通过卸载应用清空数据，不要覆盖未经备份的旧 JSON。原生整包回滚及设备重开
仍需在可用 dev client 上验证，不能从结构测试推断已经通过。
