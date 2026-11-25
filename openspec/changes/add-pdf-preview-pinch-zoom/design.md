# Design

## Context

`PdfDocumentViewer` 建立 `CroppedPdfViewer`，在 `pagesinit` 设置初始比例或适宽，已有 `currentScale`、`scalechanging`、裁切几何、锚点定位及选区叠层。WebBase 的 `ReaderWindowContent` 和 Web 宿主已阻止浏览器全页缩放。WebBase 的 `webview/src/main.tsx` 在 Vite DEV 的 `?demo=1` 加载浏览器桥；`BrowserDemo` 已通过同一个编辑器加载上传的 PDF。

## Goals / Non-Goals

- 保持 PDF 画布、文字层、标注、绘图和安全视口的坐标契约，支持常规挂载、两栏并排和模式切换。
- 手势倍率按文档与栏位会话管理。发布包沿用现有导出与数据契约，存储继续使用已稳定的原页号和纵向比例。
- 真机验收限于原生 WebView 分发和原生导航栏，几何与输入仲裁沿用 proposal 的 Chromium 用例。

## Decisions

1. **沿用正式 viewer 的缩放路径。** 在 PDF Layout 容器内注册 reader 触摸会话，捕获稳定触点 ID、原页点、起手比例和安全视口。通过现有裁切及旋转几何做原页到屏幕的双向投影，再按需写入 `currentScale` 并重对齐滚动。适宽先求无手势基准，再乘手势倍率（稳定画面为实际 PDF.js 比例）。现有受控缩放输入和显式设置缩放仍然有效，去重自身比例通知的同值回传，新的外部比例先结算手势状态再设基准。禁用 PDF.js 内建触控缩放入口或能力判定，避免同一输入被处理两次。
2. **合并缩放更新与叠层对齐。** 在动画帧内合并触点变化，协调 PDF.js 的布局更新与锚点补偿。尽量直接复用正式缩放与滚动；用于边界回弹的临时位移与页面内容共用变换，工具层继续用当前几何命中并保持手柄屏幕尺寸。稳定后清理临时样式并发布阅读进度，避免异步渲染和中间首屏抢写续读位置。可访问性设置要求减少动态效果时，释放后直接收回边界。
3. **以正文栏划定触摸归属。** 在移动触摸开始前设置局部 touch-action 策略，核对 1× 纵向滚动、2× 单指平移和先一指后两指的接管路径。保留 WebBase 根级的全页缩放防护，协调 PDF 自定义选区、绘图与宿主拖拽的既有认领和取消回调。以栏、文档和模式会话隔离缓存与待执行帧，防止残留事件触发跨栏、翻页或点击。
4. **沿用 WebBase 的开发入口及正式路由。** 在 `BrowserDemo` 的“示例文件”加入“PDF 缩放样例”，从本地 fixture 构造桥中的 PDF 文件，走 `ReaderEditorRoute` 与 `ReaderWindowContent`，初始进入 Layout。样例应可重复打开，无账号、网络资源或业务数据依赖。正式集成走宿主 `/editor?filePath=…`，与开发入口共享已安装的正式包。
5. **复用 Chromium 测试入口。** reader 复用现有 Playwright 浏览器 harness 和 PDF 几何辅助函数验证 C1–C6。WebBase 用 `webview/e2e-app/pdf-pane-touch.spec.ts` 的 CDP、父页坐标和 iframe 夹具做参考，把正式入口用例纳入 `playwright.app.config.ts`。开发入口用 Vite 开发服务单独驱动，测量页面的最终尺寸并纳入矩阵和滚动。把样例页的读数和触摸序列作为 trace 附件。

## Risks / Trade-offs

- 适宽、裁切和显式比例同时生效时容易产生基准反馈循环。以比例的来源区分外部变更、初始适宽和本手势回传，待布局可用后才接管触摸。
- 原生触摸滚动可能在第二指加入之前取得序列。通过真实 CDP 触摸覆盖先一指移动再加第二指，也在原生 WebView 验证宿主命中与透传。
- 旋转、裁切和跨页时只对当前栏的原页锚点与稳定状态做补偿。画布或文字层异步更新后，用已有叠层测试核对持久化坐标和可见对齐。

## Migration Plan

1. reader 更新包版本为 `3.1.0-ham414.N`，为 `.github/workflows/publish.yml` 增加 `ham414` 分流。当前未识别后缀会落入 `latest`，发标签前须验证分类。运行 `yarn build:all` 和 `yarn pack:check`，由匹配版本的 Git tag 触发既有 npm 流程，以精确版本及 dist-tag 核对发布结果。
2. WebBase 同步更新根和 `webview/` 的 `package.json` 与 `pnpm-lock.yaml`，冻结安装，检验 npm 包版本与实际产物，运行两侧类型检查和 Web 构建，再验证正式入口。
3. 交付现有 `?demo=1` 下的样例与启动方式，执行 C8 及真机白名单。集成如需回退，以 WebBase 上一可用版的两套清单和锁文件复建宿主及开发预览，已发布的版本供追溯，修订包递增 `N`。
