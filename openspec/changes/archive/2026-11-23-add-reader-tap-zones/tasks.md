# Tasks

## 1. reader 包仓实现

- [x] 1.1 修订共用正文指针规则和每栏显隐状态。用 `scripts/check-pagination-input-browser.mjs` 或等效 Chromium 入口验中段三分、单双栏阈值、轴向、消费优先级和尾随 click。
- [x] 1.2 将适用模式的底栏移出正文布局并接通遮罩，移除 PDF Text 与 EPUB 的底部翻页按钮及相关占位，保留导航与重试。用正文 Range 坐标确认显隐各态无排版位移。
- [x] 1.3 接通 PDF Text 相邻可视页导航及原始页码指示。扩展 `scripts/check-pdf-text-pagination.mjs`，用长原页、隐藏页、等待中导航、PDF Layout 和首尾边界检查正文与页码。
- [x] 1.4 接通 EPUB 章节内外输入和章内页码。扩展 `scripts/check-epub-pagination.mjs`，验证可重排章、固定版式、换章、内容重排、链接与高亮，以及遮罩拦截。
- [x] 1.5 运行 `yarn typecheck`、`yarn test:run`、此次新增或变化的 Chromium 断言和 `yarn build:lib`。生成本地候选包，记录源码提交、候选版本和包校验值。

## 2. 集成 WebBase 本地验证

- [x] 2.1 安装 1.5 的本地候选包，接通 Web 标题栏浮层和活动栏会话。验证标题栏与底栏联动，显隐不改变 iframe 盒或任一栏正文布局。
- [x] 2.2 复用 HAM-343 的 `filechooser` 样本导入，执行提案全部 Chromium 冒烟断言，用 `pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web` 做 Web-only 验收。记录命令、浏览器环境、执行时间和原始结果，交修勾验收候选。

## 3. 发布 reader 新版本

- [ ] 3.1 候选通过第 2 步与人类验收后，按既有发布流程发 reader 正式包，确认包注册表可安装目标版本并记录对应源码提交。

## 4. 正式集成 WebBase

- [ ] 4.1 使用 3.1 的正式包更新根目录和 `webview/` 的依赖和锁文件，核对真实打包解析到正式版本。
- [ ] 4.2 使用正式包重跑 2.2 的 Web-only 验收，确认正式版本已发布且可安装、WebBase 复验通过后合并使用方 PR。
