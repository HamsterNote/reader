# Proposal

## Why

Reader 的 EPUB 章节目录位于页面浏览 Tab 上方，展开时挤占浏览区域。WebBase 的 PDF Layout 已加载 PDF.js 文档，但页面浏览没有展示文档内嵌书签目录，用户难以直接跳到章节。

## What Changes

- 将「章节目录」移入页面浏览 Tab，与「页面」「高亮」「书签」并列。每次打开侧栏时，提供「页面」的模式默认选中「页面」。保留现有 EPUB 目录跳转。
- 使用锁定的 `pdfjs-dist@5.4.530` 提供的 `PDFDocumentProxy.getOutline()` 接入 PDF Layout。保留目录顺序和层级，内部目标按原 PDF 页定位，兼容命名目标和显式目标。空目录和读取失败在目录面板内反馈。
- 本期范围假设为 EPUB 保留现有纯文字模式目录入口和「高亮」默认项，PDF 纯文字模式维持现有页面浏览能力。只有正文上排印的目录、缺少 PDF 内嵌书签树的样本按无目录处理。

## Capabilities

### New Capabilities

### Modified Capabilities

- `epub-web-reader` 的章节目录进入页面浏览 Tab。
- `pdfjs-web-reader` 的 PDF Layout 页面浏览支持内嵌目录及跳转。

## Impact

Reader 已初始化 OpenSpec，使用 `spec-driven` schema。改动涉及共享 `PageBrowser`、EPUB 目录和 PDF Layout 的文档会话。WebBase 根目录与 `webview/` 均依赖 npm 包 `@hamster-note/reader`，当前固定为 `3.1.0-ham373.1`。

### 交付顺序

1. Reader 通过下述 Web 自测及 `yarn build:lib`、`yarn pack:check` 后，在目标交付线上选择新的唯一版本。用与 `package.json` 一致的 `v<version>` tag 触发仓库现有 npm 发布工作流，并用 `npm view @hamster-note/reader@<version> version` 确认该版本可安装。
2. 发布可用后，WebBase 同步升级根目录及 `webview/` 的依赖声明和各自 `pnpm-lock.yaml`。检查直接引用 Reader 构建产物的测试，按新版产物调整受影响的引用。以更新后的锁文件安装，运行 Web 构建和宿主 Chromium 冒烟。

## 冒烟 / 自测用例

| 入口 | 执行步骤 | 期望结果 | 判定方式 |
| --- | --- | --- | --- |
| Reader Vitest | 构造树含显式页索引、页引用、命名目标、嵌套及坏目标，并分别模拟空结果、抛错和 A 延迟后切到 B。运行 `yarn test:run`。 | 树顺序和层级正确，内部目标得到预期的 1-based 原页号。坏目标不能跳转，空与失败可区分，A 的迟到结果不进入 B。 | 断言树结构、实际解析页码、无效项无导航回调和 B 的最终状态。 |
| Reader Chromium | 扩充 `yarn check:browser`。从含嵌套目录的 EPUB Layout 打开页面浏览，按方向键切到「章节目录」，点击子章节，关闭后重开。补测 EPUB 纯文字模式和现有高亮、书签入口。 | Layout 默认「页面」，目录仅在其面板内占空间，子章节定位正确。重开回到默认项，纯文字模式仍能访问目录和高亮。 | Playwright 检查同一 tablist、`aria-selected`、焦点、目录面板可见性、目标正文与重开状态。 |
| Reader Chromium | 在同一脚本打开带内嵌书签树的 PDF，分别选择命名和显式条目，再验证隐藏页、范围外目标以及仅有正文目录的 PDF。 | 两个有效目标各自定位到已知原页。受限目标不跳，正文目录样本显示无内嵌目录且页面及高亮依然可用。 | 以样本预先记录的原页码和唯一正文标记为准，断言受限目标前后原页一致。 |
| WebBase Chromium | 装入已发布的 Reader 版本，运行 `pnpm build:web`，通过 `pnpm --dir webview test:e2e` 的 `app-chromium` 项目从宿主文件入口打开同类 PDF 和 EPUB 样本并操作侧栏。 | 两处锁文件解析到目标版本，真实宿主中默认项、目录展示和章节跳转与 Reader 一致。 | 检查两处锁文件及安装结果，断言 Web 构建退出码为 0，并保留 Chromium 报告中的选中态、可见正文和 PDF 原页断言。 |
