# HAM-182 PDF Text 手柄错位验证

问题发生在已保存的普通 PDF 高亮：背景按 canonical 源字符范围绘制，`combinePdfTextSelectionGroups` 却对单条高亮提前返回，未把端点转换成重排 DOM offset。`PdfTextHandle` 因此测量了错误字符。分组高亮已经转换，未保存草稿本来就是 DOM offset，所以只测草稿/简单文本无法覆盖这个错误。

修复删除单条高亮的例外，统一 runtime 端点契约。`pdfTextDomOffsetRect` 测量当前 DOM 字符；分页、书签和高亮导航仍使用 canonical 源锚点，不套用 PDF 页面矩形或旧版面缓存。

## 可重复验证

```sh
yarn test:run
yarn typecheck
node scripts/check-pdf-text-handles.mjs
yarn build:webview
yarn verify:webview
openspec validate unify-pdf-text-selection-handles --strict --json
```

浏览器脚本需要 Playwright WebKit 及其系统依赖；可通过 `WEBKIT_EXECUTABLE_PATH` 指定本机浏览器启动器。脚本自动启动并关闭 Vite/浏览器，输出到仓库同级 `ham182-webkit/`。

- 使用真实 `IntermediateDocumentTextViewer`、`PdfTextContent` 和 selection 库，fixture 模拟 PDF 提取顺序与阅读顺序不同的中文书单；没有 mock `Range`、字体布局或 caret 命中。
- 初始化普通已存高亮；覆盖 402/320/740px 宽度、1/1.5 字号、px/percent、组件重开及草稿，共 20 个几何检查。
- 在 WebKit 内发送 `pointerType: touch` 的合成 PointerEvent，从末手柄圆心外 9px 角落抓取，在下一帧前移动并释放；断言范围缩短两个源字符、另一端不变，ID/颜色保留，更新后的手柄仍贴合首末字符。
- 用 DOM Range 初始化草稿并确认，检查没有重复执行 canonical/DOM 转换。
- 分别补充单条高亮的展示空白、源顺序重排往返，以及分页源锚点恢复的单元回归；三项在修复前失败，修复后通过。

## 实测结果

402×874 CSS px，字号“大”（1.5，实测 24px），文字重排开启。以下坐标均为 WebKit viewport CSS px；约定起点圆心在字符上缘外 10px，终点在下缘外 10px。

| 测量项 | 修复前 | 修复后 |
| --- | --- | --- |
| 首字符 Range (left, top, width, height) | (311, 67.5, 15, 33) | 相同 |
| 末字符 Range (left, top, width, height) | (99, 175.5, 24.453125, 33) | 相同 |
| 起点圆心 (x, y) | (262.984375, 93.5) | (311, 57.5) |
| 终点圆心 (x, y) | (119.984375, 254.5) | (123.453125, 218.5) |
| 起点偏差 (dx, dy) | (-48.015625, 36) | (0, 0) |
| 终点偏差 (dx, dy) | (-3.46875, 36) | (0, 0) |

仅恢复旧的单条高亮提前返回，即可在同一 fixture 上重新触发断言失败；再次应用修复后全部通过。完整回归 118 文件 / 1549 项通过；typecheck、改动源码/测试及检查脚本 ESLint 通过（仓库 ESLint 未配置 `.jsx` harness）；WebView 构建和 293 个资源校验通过。

## 验证边界

这是 Linux Playwright WebKit 的实际排版和合成触摸事件验证，不是 iOS WKWebView 或 UIKit 原生长按/点击验收。已保存高亮由受控状态初始化，草稿由 DOM Range 初始化；不以此宣称真机长按、系统菜单抑制、首末行裁剪或 Android 通过。用户原 PDF 未在本环境获得，原文件 + iOS WKWebView + 大字号仍需设备复验。
