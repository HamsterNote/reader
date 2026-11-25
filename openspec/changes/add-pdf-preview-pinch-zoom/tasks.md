# Tasks

## 1. reader 手势与浏览器自测

- [ ] 1.1 在 PDF Layout 接入 reader 自研双指识别，禁用 PDF.js 自带手势，连接现有比例、裁切和渲染路径。以 Chromium C1、C2 验证倍率夹取、实时中点和叠层对齐。
- [ ] 1.2 实现放大平移、边界回弹和 1× 落点。以 C3、C4 记录内区位移、回弹时限、原页号和落点误差。
- [ ] 1.3 接入选区手柄、长按、绘图、矩形、拖拽与导航的输入仲裁，清理取消和会话切换状态。以 C5、C6 检查动作次数、对象状态、两栏矩阵及模式切换。

## 2. reader 预发布

- [ ] 2.1 更新至未占用的 `3.1.0-ham414.N`，将该后缀映射到 `ham414` dist-tag。在打标签前核对匹配分支，运行 `yarn build:all` 与 `yarn pack:check` 并记录发布前的 `latest`。
- [ ] 2.2 通过与包版本匹配的 Git tag 触发 reader 发布。按 C7 核验 npm 精确版本与 `ham414` 指向，确认 `latest` 仍指发布前版本。

## 3. WebBase 正式集成

- [ ] 3.1 将 WebBase 根目录及 `webview/` 的清单和锁文件更新至同一精确版本。分别冻结安装并核对解析值，运行 `pnpm typecheck` 与 `pnpm build:web`。
- [ ] 3.2 复用 WebBase 的 `e2e-app` 正式编辑器夹具，以 Playwright Chromium 与 CDP 运行 C1–C6 和 C7 的常规路径检查。记录几何读数、输入序列及 trace。

## 4. WebBase 开发预览与交付验证

- [ ] 4.1 在 `?demo=1` 增加一键 PDF 缩放样例，以已安装的新 reader 包进入正式 Layout 编辑器。记录 `pnpm webview:demo` 启动方式，运行 C8 的开发入口及生产构建检查。
- [ ] 4.2 在实际交付平台的 WebBase 开发构建运行 D1、D2，交付平台、版本、录像和测试结论。以 C1–C8 的 Chromium 结果和发布证据完成整链验收。
