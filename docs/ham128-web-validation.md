# HAM-128 Web 验证

浏览器：Playwright Chromium 148.0.7778.96，1440×1000；服务：`http://192.168.0.145:5577/`。原文件为附件《JavaScript二十年.pdf》（11,457,680 字节、158 页）。之前用 EPUB 推断第 3 项的结论作废，以下使用原 PDF 验证。

## 根因与修改

- 文字高亮最初在局域网 HTTP 下因 `crypto.randomUUID` 不可用而失败。PR 中已增加时间戳加计数器后备路径。
- 原文件的正文在 PDF.js 嵌套的 `span.markedContent` 内，旧映射只遍历 text layer 的直接子节点，无法序列化正文选区，因此文字 popover 消失。另一个问题是 `textlayerrendered` 的 `source.div` 实际为整个 PDFPageView，包含 canvas 和注释层；将它当文字层增强会删除有效选区上下文。现在只增强实际 `.textLayer`，按叶级 span 映射，并清除 DOM 重组遗留的端点属性。测试改用真实的事件容器，覆盖嵌套文字和重复增强。
- 文字、矩形和矩形草稿使用一个活动选区状态；新文字选区撤销矩形选中态，保留已保存的标注。此轮保留该互斥逻辑，修复导致正文选区为空的文字层映射。
- 第 3 项并非 EPUB 或 reader 拼出了错误 base URL。原 PDF 的 `getOutline()` 为 null、命名 destinations 为空，目录是页面内 `/Link` 注释，其 `/URI` 已经是 `https://undefined/part-2.html#浏览器博弈论`。文件来自网页阅读模式打印合并，各章节 `§` 链接保留了包装在 `chrome-extension:` URL 中的原始网页地址；章节内部分原生 `/Dest` 页引用在合并后也已失效。
- 新增 `pdfSourceLinks.ts`：仅遇到 host 为 `undefined` 的 HTTP(S) 链接时，懒加载文件内源地址和 `§` 标题位置，按源路径与规范化标题锚点恢复 PDF 内部 XYZ 跳转，使用物理页码而非失效的 `/Dest`。只有唯一内部目标可跳转；目标缺失、歧义或无效锚点均阻止导航。正常外链与原生 PDF destinations 不变，切换文件时取消索引及点击处理。没有硬编码原文件域名。

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

## 验收后的取消选中与颜色修复

原三项验收后，新增“点击空白无法取消选中”和文字/矩形颜色问题：

- 原 PDF 实测：保存文字高亮后点页内空白，popover 仍显示。PDF 标注只处理命中，空白指针事件没有取消选中路径；仅清理原生选区也没有清除持久标注的选中 ID。现在在 viewer 的主按钮 pointerdown 中检查文字/矩形标注命中；空白位置统一清除文字、矩形、草稿及原生选区，保留保存数据。命中其他标注时保留原有切换流程，排除 portal popover 与手柄，且不阻止浏览器的新拖选手势。
- 文字高亮的工具栏颜色已经包含 alpha（例如蓝色为 `rgba(125, 158, 192, 0.35)`），PDF CSS 又乘 `opacity: 0.35`，实际透明度降到 0.1225。移除额外 opacity，精确使用工具栏颜色及其 alpha，保留 multiply 混合以便看清文字。
- 矩形保存时此前未写入颜色，显示又由固定蓝色覆盖。现在确认时把工具栏颜色写入 `markerStyle.backgroundColor`，边框默认跟随自身背景色，预览和无旧样式的标注也使用当前颜色；选中边框仅在显式提供 selectionStyle 时使用专用样式。后续换工具栏颜色不会重染已保存标注。
- Popover 的颜色输入此前仅识别十六进制，工具栏 RGBA 会误显示成黄色。现在将其 RGB 分量转换为颜色控件所需的 hex 值，持久化和绘制仍保留原 RGBA。

同一命令的浏览器回归已扩展为 8 组，包括原始 PDF 和构造 PDF 的如下真实鼠标场景：

1. 工具栏选蓝色，拖选正文并保存；点空白后 popover/手柄为 0，原生选区折叠，蓝色高亮仍显示，computed opacity 为 1。
2. 工具栏换玫瑰色，框选并保存；点空白后矩形保留，边框为 `rgba(207, 156, 171, 0.35)`，popover/手柄为 0。后续验收要求矩形只描边，当前背景透明。
3. 文字标注 → 矩形标注 → 文字标注，点击切换时始终保留一个正确 popover；从已选矩形再拖选 `2009`，仍能显示文字 popover 并保存为玫瑰色，原蓝色标注保持不变。

新增截图：`original-pdf-colors-deselected.png`、`original-pdf-colors-rectangle-selected.png`、`original-pdf-colors-changed-and-dismissed.png`；报告同时记录实际 computed 颜色与取消选中后的 popover 数量。修改文件为 `src/components/EngineDocumentViewer.tsx`、`src/components/DefaultPopover.tsx`、`src/pdf/PdfPageOverlayLayer.tsx`、`src/pdf/PdfRectangleAnnotation.tsx`、`src/styles/pdf-viewer.scss`、浏览器脚本及本记录。PDF、Reader 及矩形手柄相关 9 个测试文件共 205 项通过，typecheck、修改文件 ESLint 和 demo 构建通过。

## 工具激活、首次手柄与滚动修复

- 标注命中原先只在文字工具下启用；矩形工具的 overlay 会先开始新框。现在非绘图工具均先对已有标注做几何命中，在 PDF 页的原生捕获阶段完成选择，早于 portal 的 React 框选处理，避免点击或轻微移动产生新草稿。手柄事件继续交给其原有拖动逻辑。
- 首次点文字高亮时，原生高亮拖动监听会停止冒泡；工具激活时，标注命中还会阻止事件到达 portal 的 React 捕获监听。原来在 React 冒泡阶段设置的鼠标状态因此未初始化，两个手柄被隐藏。现在在 viewer DOM 根的原生捕获阶段记录输入类型，刷新后第一次鼠标点击即可显示手柄。
- 矩形草稿、保存、选中及悬停均只描边。保存的 `markerStyle.backgroundColor` 继续作为标注颜色数据与默认边框颜色使用，但渲染背景明确透明，也覆盖旧数据的填充颜色；文字高亮仍保留工具栏颜色及其 alpha。
- 仅隐藏 PDF 滚动容器的原生滚动条，保留 `overflow: auto` 及原生滚动事件，继续由 PDF.js 和阅读进度条处理滚动位置。

`check:web-selection` 在构造 PDF 和原 PDF 的颜色/取消选中场景后，新增持久化恢复路径：分别保存文字工具、矩形工具状态并刷新，重新加载同一 PDF，第一次 viewer 鼠标输入直接点已有文字标注，断言两个手柄与删除 popover；矩形工具下再点击矩形并移动 2px，断言无新草稿、无重复 popover、保存数量不变、背景透明，再拖动角手柄验证可调整大小。随后检查原生滚动条隐藏、滚轮滚动同步进度、拖动自定义条定位，以及浏览器触控滑动后实际 scrollTop 增加。选区由鼠标生成，触控使用 Chromium CDP 的触摸事件。

本轮改动：`src/components/EngineDocumentViewer.tsx`、`src/pdf/PdfPageOverlayLayer.tsx`、`src/pdf/PdfRectangleAnnotation.tsx`、`src/styles/pdf-viewer.scss`、`scripts/check-web-selection.mjs`、本记录。

本轮在同一服务上完整运行 `yarn check:web-selection`，8 组全部通过，包含原 PDF 的新四项与此前文字高亮、单一 popover、目录第 46 页跳转、工具栏换色、点击空白取消选中。原 PDF 自定义进度条定位物理第 32 页，滚轮与触控均可继续滚动。PDF/Reader/矩形手柄 205 项测试、typecheck、修改文件 ESLint、Prettier 与 demo 构建通过。截图包括 `original-pdf-tools-first-click-handles.png`、`original-pdf-tools-active-text.png`、`original-pdf-tools-active-outline.png` 和 `original-pdf-tools-custom-scroll.png`；JSON 报告和截图回传 HAM-128。浏览器范围仍为 Chromium，Safari 未验证。

## 目录恢复失败分支审核修复

- 删除“源 origin 唯一时改写成外链”的回退与对应 origin 收集。索引期间的点击始终阻止浏览器默认导航；索引完成后只对唯一命中的内部目标调用 `goToDestination`，不再自动 `anchor.click()`，无法恢复时保持阻止。
- `fragmentKey` 返回 `null` 表示解码失败或非空锚点规范化后无有效字符；只有真正空锚点返回空串并可匹配章节起点。目标查找及源标题索引均处理无效状态，避免无效源锚点重复注册空键、把正常章节目标标为歧义。
- `test/pdf-viewer/pdf-source-links.test.ts` 新增 10 个参数化案例：同源缺失/重复目标在索引完成前后均不导航；两种非法编码、两种无有效字符锚点不误跳；无锚点及显式 `#` 仍正确跳章节；两种无效源锚点不污染章节键。已有有效目标的提前点击测试增加“不合成 anchor.click”的断言。
- 新测试在修复前复现 6 个失败分支；修复后链接测试 14 项通过，完整 PDF 测试 7 个文件、79 项通过，typecheck、修改文件 ESLint 和 Prettier 通过。同一服务再次运行含原 PDF 的 `yarn check:web-selection`，8 组通过，目录仍跳到物理第 46 页，无外部请求或新标签页，之前标注/工具/滚动场景也通过。

本轮改动：`src/pdf/pdfSourceLinks.ts`、`test/pdf-viewer/pdf-source-links.test.ts`、本记录。

## 人工验证服务

- 地址：`http://192.168.0.145:5577/`（本机也可用 `http://localhost:5577/`）。上传原 PDF 后点击“加载文件”，第 2 页可测试三个场景。
- tmux：`tmux attach -t ham128-reader`，pane PID `123682`。
- 日志：reader 仓库内 `.artifacts/ham128/dev-server.log`。
- 停止：`tmux kill-session -t ham128-reader`。

服务已通过 HTTP 就绪检查；tmux 已脱离本次运行，无系统 supervisor，长期存活为尽力保障。
