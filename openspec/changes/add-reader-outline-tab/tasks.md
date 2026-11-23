# Tasks

## 1. Reader 页面浏览

- [x] 1.1 将目录接入共享 `PageBrowser` 的 Tab 与面板，接通键盘操作、关闭重开和换书默认项。用 Playwright 断言同一 tablist、焦点、默认项、面板可见性以及侧栏顶部没有独立目录。
- [x] 1.2 迁移 EPUB 目录并保留章节 href 跳转。更新 `scripts/check-web-selection.mjs` 中的旧目录定位，运行 `yarn check:web-selection` 验证目录导航，并覆盖 EPUB 纯文字模式和无目录样本。

## 2. Reader PDF 目录

- [x] 2.1 从当前 PDF Layout 会话加载目录并解析内部目标，接入原页跳转和允许范围。通过 `yarn test:run` 验证命名、显式页引用与索引、坏目标、空树、读取失败和换书后迟到响应。
- [x] 2.2 扩充 `yarn check:browser` 的 EPUB 与 PDF 目录场景。使用内嵌树和仅正文目录的 PDF 样本，断言层级、已知原页与正文标记、隐藏和范围外目标不跳转，并回归高亮与书签入口。

## 3. Reader 发布与 WebBase 集成

- [ ] 3.1 Reader 完成第 1、2 组后运行 `yarn typecheck`、`yarn build:lib` 和 `yarn pack:check`。通过匹配包版本的 Git tag 走既有 npm 发布流程，确认 `npm view @hamster-note/reader@<version> version` 返回目标版本。
- [ ] 3.2 依赖 3.1。WebBase 根目录和 `webview/` 同步升级 Reader 精确版本及两处锁文件，检查测试中使用的 Reader 构建产物引用，并以锁文件安装。用 `pnpm test:run` 和 `pnpm build:web` 验证消费及构建正常。
- [ ] 3.3 依赖 3.2。为 WebBase `app-chromium` 项目补宿主目录冒烟，从文件入口打开 PDF 和 EPUB，断言默认 Tab、章节跳转及正文定位。运行 `pnpm --dir webview test:e2e` 的相应用例并保留报告与实际 Reader 版本。
