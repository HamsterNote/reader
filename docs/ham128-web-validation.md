# HAM-128 Web 验证

浏览器：Playwright Chromium 148.0.7778.96，1440×1000；服务：`http://192.168.0.145:5577/`。原文件为附件《JavaScript二十年.pdf》（11,457,680 字节、158 页）。之前用 EPUB 推断第 3 项的结论作废，以下使用原 PDF 验证。

## 根因与修改

- 文字高亮最初在局域网 HTTP 下因 `crypto.randomUUID` 不可用而失败。PR 中已增加时间戳加计数器后备路径。
- 原文件的正文在 PDF.js 嵌套的 `span.markedContent` 内，旧映射只遍历 text layer 的直接子节点，无法序列化正文选区，因此文字 popover 消失。另一个问题是 `textlayerrendered` 的 `source.div` 实际为整个 PDFPageView，包含 canvas 和注释层；将它当文字层增强会删除有效选区上下文。现在只增强实际 `.textLayer`，按叶级 span 映射，并清除 DOM 重组遗留的端点属性。测试改用真实的事件容器，覆盖嵌套文字和重复增强。
- 文字、矩形和矩形草稿使用一个活动选区状态；新文字选区撤销矩形选中态，保留已保存的标注。此轮保留该互斥逻辑，修复导致正文选区为空的文字层映射。
- 第 3 项并非 EPUB 或 reader 拼出了错误 base URL。原 PDF 的 `getOutline()` 为 null、命名 destinations 为空，目录是页面内 `/Link` 注释，其 `/URI` 已经是 `https://undefined/part-2.html#浏览器博弈论`。文件来自网页阅读模式打印合并，各章节 `§` 链接保留了包装在 `chrome-extension:` URL 中的原始网页地址；章节内部分原生 `/Dest` 页引用在合并后也已失效。
- 新增 `pdfSourceLinks.ts`：仅遇到 host 为 `undefined` 的 HTTP(S) 链接时，懒加载文件内源地址和 `§` 标题位置，按源路径与规范化标题锚点恢复 PDF 内部 XYZ 跳转，使用物理页码而非失效的 `/Dest`。重复标题不任意取第一个；无法内部匹配时，仅在源 origin 唯一时修复外链。正常外链与原生 PDF destinations 不变，切换文件时取消索引及点击处理。没有硬编码原文件域名。

## 浏览器回归

在同一 dev server 上运行：

```bash
READER_BROWSER_URL=http://192.168.0.145:5577 \
READER_ORIGINAL_PDF=/path/to/JavaScript二十年.pdf \
yarn check:web-selection
```

所有选字、框选、工具切换和目录点击都使用 Playwright 的鼠标事件，没有通过 DOM Range 构造选区。原 PDF 的结果：

1. 在第 2 页拖选 `Modernizing JavaScript`，文字 popover 出现，点击高亮写入存储；开始框选后可见黄色文字高亮。
2. 框选产生一个矩形 popover；保存矩形后切回文字工具，鼠标点击已有矩形，再拖选 `2009`，只剩一个文字 popover，矩形取消选中但仍保存。继续高亮后存储中有 2 个文字标注、1 个矩形标注。
3. 单独重新打开同一 PDF，点击目录“浏览器博弈论”，停留在 reader，目标标题位于 PDF 物理第 46 页并在视口内；无 `undefined` 网络请求、无新标签页、无 pageerror。目录独立重开验证，避免前一场景仍存在的原生文字选区覆盖 PDF.js 注释层。

脚本还覆盖普通 PDF、无 randomUUID 环境、动态生成的带标签/失效源链接 PDF（包含合并后错误页引用），以及原有 EPUB Layout/Text 导航回归。默认无原文件时仍可运行构造样本；原文件不提交到仓库。截图及 JSON 报告默认生成到 `test-results/web-selection/`，可通过 `READER_BROWSER_OUTPUT` 指定目录。

其他检查：`test/pdf-viewer` 的 7 个文件、69 项测试通过；`yarn typecheck`、修改文件 ESLint、`yarn build:demo` 通过。测试仍有既有 React act 警告；构建仍有既有资源路径与大包提示。此轮仅验证 Chromium，未验证 Safari。

## 改动文件

本轮：`src/pdf/PdfDocumentViewer.tsx`、`src/pdf/pdfTextMapping.ts`、`src/pdf/pdfSourceLinks.ts`、`test/pdf-viewer/pdf-document-viewer.test.tsx`、`test/pdf-viewer/pdf-text-mapping.test.ts`、`test/pdf-viewer/pdf-source-links.test.ts`、`scripts/check-web-selection.mjs`、本记录。PR 还包含此前的 `src/components/EngineDocumentViewer.tsx` 和 `package.json` 修改。

## 人工验证服务

- 地址：`http://192.168.0.145:5577/`（本机也可用 `http://localhost:5577/`）。上传原 PDF 后点击“加载文件”，第 2 页可测试三个场景。
- tmux：`tmux attach -t ham128-reader`，pane PID `123682`。
- 日志：reader 仓库内 `.artifacts/ham128/dev-server.log`。
- 停止：`tmux kill-session -t ham128-reader`。

服务已通过 HTTP 就绪检查；tmux 已脱离本次运行，无系统 supervisor，长期存活为尽力保障。
