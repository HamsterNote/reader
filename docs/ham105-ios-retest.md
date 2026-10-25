# HAM-105 iOS 修复与复测

基线：`9fbcf2280a536c3c26ff844eb2311cc5cb7b35b7`，开发线
`agent/ham-91-integration`，仓库为 `HamsterNote/reader`。
本次修复不等于 iOS 验收通过，Android 已按用户要求豁免。

## 修复范围

- `ReaderWebView` 将 `isTopFrame`、`mainDocumentURL` 传给导航策略。
  仅当主文档是当前本地阅读入口且明确为子帧时，允许本地 file/null origin
  的 UUID blob 章节；顶层 blob、远端 blob、外部 HTTP 子帧仍拒绝。
  出版物清洗、脚本禁用、CSP 和文件级读取根继续生效。
- PDF 高亮使用 0.35 透明度作为混合失效时的兜底，不修改保存的颜色、
  端点或矩形；即便 WebKit 的独立合成层不与底层 canvas 混合，也能看到文字。
- `menuItems=[]`、显式 `suppressMenuItems` 与宿主 `-webkit-touch-callout: none`
  抑制重复菜单。显式列表覆盖 Fabric 把初始空数组视为默认值、跳过 setter
  的情况。保留系统文本选择和选区，不禁用长按或 `user-select`。

## 自动回归

```bash
yarn install --frozen-lockfile
yarn test:run test/host-navigation-policy.test.ts test/epub/publication-security.test.ts test/pdf-viewer
yarn typecheck
yarn typecheck:host
yarn lint
yarn build:webview
yarn verify:webview
READER_BROWSER_CASE=chromium yarn check:browser
READER_BROWSER_CASE=chromium READER_BROWSER_OFFLINE=1 yarn check:browser
```

浏览器检查新增恢复后高亮截图与无高亮截图的字形像素对照，不能仅凭标注数量
判定显示正确。离线模式把打包入口和真实文档复制到同一本地目录，使用新的
浏览器上下文，加载前即切断网络，从 `file://` 打开、编辑、保存并重载；
同时要求没有 HTTP 请求。Chromium 授予本地文件访问权限以模拟宿主文件读取。
这些是 Web 层回归，不是 WKWebView 或原生冷启动证据。

本次 Linux 验证结果（2026-10-24）：

| 检查                              | 结果                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 全量单测                          | 83 文件 / 1132 项通过                                                                                 |
| typecheck / typecheck:host / lint | 通过                                                                                                  |
| WebView 构建与清单校验            | 293 文件，buildId `132660d461844846`                                                                  |
| Chromium HTTP，桌面与移动         | 13/13，通过保存恢复、端点/矩形操作及出版物脚本探针                                                    |
| Chromium 断网 file://，桌面与移动 | 12/12，EPUB/PDF v2/v3/v4 保存恢复；全部零 HTTP 请求                                                   |
| PDF 高亮截图像素                  | 所有样本原有深色字形像素保留；临时去掉生成 CSS 中的透明度，负向对照按预期失败，随后恢复且清单校验通过 |
| iOS 生产 JS 导出                  | 成功，609 modules，Hermes 约 1.91 MB；导出资产 zip 与构建 zip 逐字节一致                              |
| Playwright WebKit                 | 无法启动，缺 ICU74/libxml2/libevent 等运行库，未记通过                                                |
| iOS 原生及完整离线冷启动          | Linux 无 Xcode/Simulator，待 Mac 操作员复测                                                           |

导出 zip 的 SHA-256：`f0462a7afb674f1cc679eb9ddc211a263a7f39993d8fd1fedf278d0df3613dd6`。

## Mac 操作员复测

保持 Bundle ID `com.hamsternote.reader`，先备份导入文件和宿主 JSON，
不要卸载应用、清空应用数据或重置 Simulator。

1. 拉取本次提交，运行 `yarn install --frozen-lockfile`。
2. 在线调试复测可运行 `yarn host:ios --device <Simulator UDID>`；
   重新打包资源后必须重载原生 JS，确保导航策略和菜单配置一起更新。
3. 使用 `cover-and-image-order.epub` 和 `two-column.pdf` 走真实 DocumentPicker。
   EPUB 从封面继续到实际章节，确认非空正文、页面条目和跨章跳转。
4. 两种格式分别长按选词，确认没有系统 Copy/Look Up/Translate 菜单遮挡，
   自定义高亮按钮可完整点击；保存后退出阅读页重开，确认文字可读且标注恢复。
5. 两种格式分别验证横竖屏、后台恢复、恢复文件后的错误重试，并记录真实结果。

## 完整离线矩阵

Debug dev client 冷启动依赖 Metro，停止 Metro 后同进程重开不足以证明自包含。
用内置 JS 与 zip 的 Release 构建测试，保持相同 Bundle ID 与应用数据：

```bash
yarn host:ios:offline --device <Simulator UDID>
```

该脚本先构建 WebView 资产，再用 Expo `--configuration Release --no-bundler`
编译、安装并启动；需要 Mac/Xcode，不在 Linux 上宣称构建通过。
也可 `yarn build:webview`、`cd app && npx expo prebuild --platform ios` 后，
用 Xcode 的 Release 配置构建（不要启用跳过 JS bundling 的环境变量）。
确认 `.app` 包内有 `main.jsbundle` 和 webreader zip 后再执行离线验收。

- 先在线导入本地 EPUB/PDF 并保存标注，记录宿主 revision 和范围 ID。
- 关闭应用和本次测试用 Metro/样本服务器，禁用 Simulator 的实际外网通道。
  记录采用的断网方法，并验证测试 HTTP 地址确实不可达。单纯停止开发服务
  或设置弱网都不能记作完整断网。
- 断网后从桌面冷启动 Release App，逐个打开两种格式、翻页/跨章、长按、
  新增高亮、关闭阅读页重开，接着终止 App 再冷启动，确认新旧高亮均恢复。
- 对尚未打开的新样本执行离线 DocumentPicker 导入，确认新的文档级资源目录
  能在离线时建立，不能只验证已经解压过的会话。
- 每项附截图、关键日志、构建 SHA、系统/设备、资源 buildId；任何未执行项
  继续标记未验证。全部通过后再建议父任务人工验收。

回滚时恢复此前构建并保留宿主数据；本次不改变 JSON 格式，不切换默认引擎路由。
