# HAM-91 集成交付汇总

日期：2026-10-24。仓库 `HamsterNote/reader`，分支 `agent/ham-91-integration`。
本文汇总 HAM-103（浏览器）和 HAM-105（iOS）的已验收结果，并记录默认路由收尾。
Android 按修勾 2026-10-23 的“安卓不测”指示豁免，未执行项不记为通过。
本次不创建 PR，交由父任务安排人工评审。

## 默认入口与兼容边界

- Demo 不再读取 `engines` 查询参数。选择 EPUB 后直接使用 Foliate，两种模式均走
  EPUB 引擎；PDF Layout 使用官方 PDFViewer，PDF Text 保留兼容文本视图。
- 删除 Demo 的 EPUB/PDF 旧主展示路由分支；原解析器仍生成公共 `page-N`、offset
  及 Text 模式所需的兼容文档。原始字节只保留于 `engineSource`，不写入 ReaderData。
- Expo WebView 已经默认使用同一新引擎，本次没有改动原生或 WebView 阅读代码。
- 共享 IntermediateDocumentViewer 仍服务 TXT/Markdown/DOCX/图片和旧库消费者的
  `document` API，不能整体删除。库消费者可显式传 `engineSource`，旧调用不必新增
  原始字节。`style.css`、公开端点、回调与 JSON 格式继续兼容。
- 单测在现有格式分流表中断言：EPUB/PDF 默认传入原始字节，其他格式不传引擎；
  浏览器交互脚本改为访问无查询参数的 `/`，验证真实默认路由。

## 验收矩阵

| 范围 | 结果与证据 |
| --- | --- |
| 5.1 接线、工具与格式分流 | HAM-103 完成 EPUB/PDF 标注工具及桌面/移动宽度回归；本次默认入口回归和旧消费者打包检查另记于下节 |
| 5.2 旧数据往返 | EPUB/PDF 各 v2/v3/v4：导入、编辑、旧读入器读取、重开；比较 ID、createdAt、端点、坐标单位、样式、绘图、评论、书签及进度，仅按原规则补齐版本缺省值 |
| 5.3 仓库检查与浏览器 | HAM-103 的 Chromium 兼容 13/13、交互 4/4、安全 2/2 通过；HAM-105 新增离线 file:// 12/12 与高亮字形像素负向对照；本次检查见下节 |
| 5.4 iOS | HAM-105 已由修勾确认完成，具体设备、版本和不同轮次的证据如下 |
| 5.4 Android | 人工豁免，未验证；不阻塞本次评审 |
| 5.5 默认路由、兼容与运维 | 默认路由已切换，必要兼容索引/API 保留；启动、资产、备份与回滚说明见下文 |

旧 JSON 读入器已移至 `src/storage/highlightStorage.ts`，Demo 重新导出；
与基线 `237c0d5` 比较只有类型导入路径变化，读取规则保持一致。
`test/reader-snapshot-compat.test.ts` 使用此读入器做完整结构比较。
浏览器真实引擎用例补充可见恢复、编辑和重载证据，不把结构测试当作视觉证明。
基线交互矩阵位于 `openspec/changes/migrate-reader-to-expo-webview/contracts/interaction-matrix.md`，
各工具、旧选择回调、拖拽、隐藏页和回收的详细结果见 `docs/ham103-acceptance.md`。

## iOS 接受基线

设备：iPhone 17 Pro / iOS 26.5 Simulator；macOS 26.3.1 arm64；
Xcode 26.6 (17F113)，Bundle ID `com.hamsternote.reader`。
最终原生接受提交为 `16a8ebfc8f75ce565e9085861c46de52d5f9e1ed`，
资源 buildId `132660d461844846`，293 文件校验通过。

| 项目 | EPUB / PDF 结果 | 证据版本 |
| --- | --- | --- |
| DocumentPicker、本地正文、封面/章节/页码、跳转 | 通过 / 通过 | `4af4838`，后续旧书库和新离线样本再验证 |
| 长按、原生选择手柄扩大、自定义高亮按钮中心保存 | 通过 / 通过 | `16a8ebf`；录屏未观察到系统 Copy/Look Up/Translate 闪现或遮挡 |
| 重复选择、横竖屏、后台恢复后再选择 | 通过 / 通过 | `16a8ebf`，6 次菜单检查 |
| 保存、关闭重开、杀进程 Release 冷启动 | 通过 / 通过 | `16a8ebf`，新旧范围 ID 均保留，高亮下字形可读 |
| 容器 UUID 改变后直接打开旧书库 | 通过 / 通过 | `16a8ebf`，旧绝对路径不存在；无需重选/修改 JSON/清缓存，初始快照、revision、ID 保留 |
| 可恢复文件错误、恢复源文件后重试 | 通过 / 通过 | `4af4838`；最终 SHA 未重复全部重试场景，不冒充新执行结果 |
| 实际断网、无 Metro、桌面 Release 冷启动 | 通过 / 通过 | `16a8ebf`；Wi-Fi 关闭，curl exit 7，Simulator Safari 显示断网错误 |
| 离线新增高亮、重开、再杀进程冷启动 | 通过 / 通过 | EPUB 2→3 条、PDF 3→4 条，旧/新增 ID 全部保留 |
| 新样本首次离线导入并创建资源目录 | 通过 / 通过 | `16a8ebf`；每份 293 资源的 SHA-256/大小校验通过，正文与 PDF 字形可见 |
| 相对路径保存与删除隔离 | 专用 EPUB 副本通过；PDF 未重复创建删除副本 | `16a8ebf`；原 EPUB/PDF 完整 JSON 不变 |

原生证据在 HAM-105：`ham105-ios-retest-results.md`、
`ham105-followup-native-results.md`、`ham105-offline-approved-results.md`，
以及对应截图、录屏和日志压缩包。最后离线报告保留自动化中途失败与后续复查，
不把封面页断言失败改写为全绿；首次导入事实由断网窗口内新记录和目录时间证明。
最终网络已恢复 HTTP 200，App、录屏及网络恢复保护进程已停止。

## 本次检查

环境：Linux、Node 24.15.0、Yarn 1.22.22。原生接受基线之后仅修改 Demo 默认分流、
其单测/浏览器入口和文档，本次未重新执行原生构建。

| 命令 | 结果 |
| --- | --- |
| `yarn install --frozen-lockfile --non-interactive` | 通过，无锁文件改动 |
| `yarn typecheck` / `yarn typecheck:host` / `yarn lint` | 通过 |
| 定向 Demo、PDF 生命周期、快照往返 | 3 文件 / 135 项通过 |
| `yarn test:run` | 86 文件 / 1143 项通过 |
| `yarn build` | 库 JS、类型、CSS 与 Demo 通过 |
| `yarn pack:check` | 通过，289 发布文件 |
| `yarn build:webview` / `yarn verify:webview` | 293 资源，buildId 仍为 `132660d461844846`，原生接受资产未变 |
| 无参数默认入口浏览器交互 | Chromium 1280×800 / 390×844，EPUB/PDF 共 4/4 通过 |
| `node scripts/check-delivery.mjs` | 发布包旧 API/CSS 的 Vite 客户端、打包 SSR 通过；移除必需 `openjpeg.wasm` 时正确失败 |

浏览器命令：

```bash
READER_BROWSER_OUTPUT=../ham91-final-browser node scripts/check-engine-interactions.mjs
```

覆盖矩形新增/确认/角点编辑/undo/redo、绘图保存、文本工具激活矩形、跨章节端点
及非空放大镜、隐藏页与裁切、拖出预览、EPUB iframe 回收及 40 页 PDF canvas
回收恢复。直接访问 `/` 并等待真实引擎 DOM，包含移动宽度触摸翻章。
截图人工抽查可见中文字形、放大镜内容、PDF 字形与恢复标注。
原有 act/font、OCR 大包、externalized 和 iframe sandbox 警告仍存在。
打包兼容检查只覆盖锁定依赖，不代表所有历史依赖组合；
发布包消费者的 Vite 客户端、打包 SSR 和缺资源负向校验日志随本次附件交付。

## 启动与构建

```bash
yarn install --frozen-lockfile
yarn dev --host 127.0.0.1
# 直接打开 Vite 打印的地址，选择 EPUB/PDF，无需查询参数
yarn build
yarn pack:check
yarn build:webview
yarn verify:webview
yarn typecheck:host
```

原生构建从仓库根运行：Android 为 `yarn host:android`（未验收）；
iOS 为 `yarn host:ios`，完整自包含 Release 为 `yarn host:ios:offline`。
两者要求对应 SDK/设备，iOS 要求 Mac/Xcode。含 iOS 菜单源码补丁，
必须先执行 `yarn prepare:ios` 并确认 applied/already applied，再重新构建原生包；
仅重载 Metro 无效。上述 iOS 脚本已接入 prepare。直接 Xcode 构建同样要执行。
补丁固定 `react-native-webview@13.15.0`，版本或源码不匹配必须停止构建。

WebView 构建生成 HTML、Foliate ESM、PDF 核心/worker/CSS/字体/WASM 及 zip。
清单逐项验证大小、SHA-256、必需文件和 buildId；缺资源时失败，不允许运行时 CDN
兜底。宿主按文档复制到 `reader-sessions/<fileId>/<buildId>/`，全部完成后才写
完成标记，读取根限制为当前 session。zip 不提交，原生打包前必须重新构建校验。

## 数据备份与回滚

1. 操作前备份原 EPUB/PDF、历史 JSON、对应文件的所有
   `hamster-reader-demo:*:{fileName}` localStorage，以及原生 Documents 下完整
   `reader-host/`、`reader-files/`。文件记录在
   `reader-host/reader.host.v1.doc.<fileId>.json`，须连 revision、extra 字段一起保存；
   业务内容位于 `snapshot.data`。`reader-sessions/` 可重建，不能代替备份。
2. 仅回退本次 Demo 默认切换，可检出 `16a8ebf` 后重新构建 Web Demo，使用
   `?engines=next` 选新引擎、无参数选旧入口。保留其他分支工作，勿强制重置或清数据。
   库消费者不传 `engineSource` 可继续使用旧 `document` API。
3. 回退整次迁移应使用原已发布版本或 `237c0d5` 重新构建，并从备份读取原文件及
   JSON；新输出仍为旧 v4 结构，自动往返已验证旧读入器可读，原输入不被修改。
   新宿主书库的导入元数据不是旧 Web localStorage，需按原存储键恢复业务 JSON。
4. 原生回退不得卸载清空数据。优先回到已验收的 `16a8ebf`，保持 Bundle ID、
   原生菜单补丁与相对缓存路径修复；回到修复前版本可能再次遇到容器绝对路径失效。
   历史二进制降级并带数据重开的设备实验未执行，不宣称通过。

## 保留的验证边界

- Android 未测且已豁免；Linux Playwright WebKit 缺运行库，未通过。
  iOS Simulator 的 WKWebView 证据不代表全部 Safari、iOS 版本或真机。
- 原生恶意出版物伪造消息/跨文件读取的完整攻防矩阵未单独执行；有契约测试与
  Chromium 出版物脚本/放大镜安全探针，不能将其记为设备安全矩阵通过。
- 放大镜静态快照的自定义字体、背景图片、伪元素、内联 SVG/MathML 保真有限；
  出版物本身保留原排版。长章节捕获耗时和原生大文件内存峰值未测。
- 原生最终 SHA 的所有旧重试场景、PDF 专用删除副本及历史二进制降级未重跑，
  上述表格保留各自证据范围。当前范围依据 HAM-103/HAM-105 的人工接受结果收口。
