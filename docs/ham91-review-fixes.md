# HAM-91 / PR #28 复审修复

基线：`agent/ham-91-integration` 的 `ce8c741e85ce3994e0ca5e2d5bc42d0487b85bc8`。
补丁仅在本地提交，由评审协调者应用到同一分支后推送，不另建 issue 或 PR。

## 修复范围

- PDF 公开文本严格拼接 pdf.js `TextItem.str`，删除额外 NFKC。兼容字符、
  组合字符及 UTF-16 偏移不再被改变；pdf.js 自身的连字处理保持原样。
  测试用真实旧 PdfParser 和 v2/v3/v4 读入器验证兼容字符后的高亮往返。
- 默认 EPUB/PDF 展示、导航和页码控件应用既有 `pageRange` 规则，EPUB 正文链接
  同样受范围约束，保留原始
  `page-N`。裁切编辑不会放开范围外页面；空范围不显示正文。
  PDF 初始化回调中仍可恢复范围内的位置。
- PDF Layout 复用既有 OCR 获取、ID 前缀和文字渲染逻辑，接通外挂/内置识别、
  自动/指定页、受控文字、成功/错误回调及调试模式。识别输入是 scale=1 的
  PDF 页面 PNG；文字按 viewport 变换叠加，追加在原生文本 offset 后。
  OCR 文字参与旧选择回调、高亮保存和恢复。关闭页或换文档时丢弃过期响应，
  外部识别请求串行执行；失败页可通过关闭再启用重试。

## 验证

Linux / Node 24.15.0 / Yarn 1.22.22。

| 检查                                                   | 结果                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| `yarn test:run`                                        | 86 文件，1159 项通过                                |
| 定向回归（PDF/EPUB 引擎与旧选择回调）                  | 5 文件，53 项通过；正文链接约束补充断言通过         |
| `yarn typecheck` / `yarn typecheck:host` / `yarn lint` | 通过                                                |
| `yarn build:all`                                       | 库 JS/类型/CSS 与 Demo 构建通过                     |
| `yarn pack:check`                                      | 295 发布文件通过                                    |
| `yarn build:webview` / `yarn verify:webview`           | 293 资源，buildId `6c17aeffe93faf80`                |
| `node scripts/check-delivery.mjs`                      | 旧 API/CSS 消费者 Vite/SSR 构建及缺资产负向检查通过 |
| `node scripts/check-review-regressions.mjs`            | Chromium 桌面 1280×800、移动 390×844 均通过         |
| `node scripts/check-engine-interactions.mjs`           | EPUB/PDF × 桌面/移动，4/4 通过                      |

新浏览器脚本使用真实 Reader、Foliate、PDFViewer、扫描图像 PDF 和确定性的外挂
OCR 返回值。检查范围过滤、兼容字符后的 `x` offset 2、OCR 栅格输入/透明叠字/
命中检测/旧选择回调/高亮恢复/调试/关闭，以及非空 PDF 画布。单测另覆盖内置
ImageParser 的接线、受控 OCR、失败重试、关闭页和换文档期间的异步响应隔离。

## 验证边界

- 外挂 OCR 的识别准确率和内置模型下载/推理未做端到端验收；浏览器使用固定
  识别结果，单测对 ImageParser 边界打桩。
- 本补丁改变 WebView 资产，旧 `16a8ebf` / `132660d461844846` 的 iOS 接受结果
  不能覆盖这些修改。需要在新资产上复测 iOS OCR 选择、高亮和范围导航；
  当前 Linux 环境未运行 iOS，Android 延续人工豁免。
- 新提交的远端 CI 与复审由补丁接收者推送后触发；PR 原有 5/5 CI 不代表本提交。
- 原有 act、字体、iframe sandbox、大包及 externalized 构建警告仍存在。
