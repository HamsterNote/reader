# Design

## Context

`PageBrowser.tsx` 已管理 Tab、键盘导航与打开状态，当前在 Tab 列表上方直接渲染 `outline`。EPUB 由 `EngineDocumentViewer` 传入 `EpubOutline` 和章节跳转回调。同一 Viewer 的 PDF Layout 路径借助 `PdfDocumentViewer.onDocumentReady` 持有 `PDFDocumentProxy`，并已有会话与位置事务。另一路 IntermediateDocument 适配保留了 `getOutline()` 的结果，本期接入 WebBase 所用的 PDF.js 引擎路径。

## Goals / Non-Goals

复用侧栏 Tab、文档会话和原页导航，目录通过局部状态加载。发布沿用现有 npm 包接口和数据格式。原生 PDF change 独立推进。范围见 `proposal.md`。

## Decisions

1. 目录面板共用 `PageBrowser` 的 Tab 和焦点管理。目录 Tab 的可用性由调用方所支持的格式和模式决定，加载、空和失败状态均保留在面板内。EPUB 保留 `EpubOutline` 所用的树和 href 跳转，面板承担原顶部折叠容器的职责。打开侧栏和切换文档按当前可用 Tab 计算默认值。
2. 在现有 PDF Layout 会话中读取嵌入目录，按当前 `PDFDocumentProxy` 隔离异步结果。进入目录面板时触发有界读取，同一文档复用成功结果。命名目标用 `getDestination(name)`，显式目标首项为页引用时用 `getPageIndex(ref)`，首项为整数时直接当作零基页索引。统一转为一基原页号后校验范围和可见性，再走现有原页跳转回调。保持父子关系，无法跳转的父节点仍可查看其子项。外链和其他 PDF 动作按不可跳转条目呈现。本期定位粒度为原页。 [PDF.js v5.4.530 API](https://github.com/mozilla/pdf.js/blob/v5.4.530/src/display/api.js)
3. 书签树识别采用文档元数据。此前记录的一份网页打印合并 PDF 的 `getOutline()` 返回 `null`，其正文目录是页内链接。用一份原生书签样本和一份仅正文目录样本分别验证这两种情况。 [Reader HAM-128 记录](https://github.com/HamsterNote/reader/blob/master/docs/ham128-web-validation.md)

## Risks / Trade-offs

- 目录或目标解析晚于换书，或目标在解析中被隐藏。写入结果和发出导航前分别核对当前文档归属及允许的原页集合。
- 损坏分支或目录请求失败。保留可用条目和其他 Tab，目录读取异常显示在当前面板。
- 旧 EPUB 浏览器脚本在顶部找折叠容器。更新现有 `scripts/check-web-selection.mjs` 的目录入口，测试从 Tab 切换。

## Migration Plan

按 `proposal.md` 的发布依赖顺序交付。WebBase 用 npm 精确版本和更新后的双锁文件安装。回退时同步恢复两处 Reader 版本和锁文件，重新构建 Web 产物。

## Open Questions

已用构造样本覆盖：内嵌书签树样本经 PDF.js 返回命名目标、显式页引用及嵌套条目，仅正文目录样本返回 `null`，并已完成对应 Vitest 与 Chromium 用例。真实问题 PDF 尚未随 issue 提供，待拿到真样本后记录其 PDF.js 返回值并复核同一用例。发布版本号随目标交付线确定。
