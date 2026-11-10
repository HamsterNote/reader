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

## 放大镜布局与内容采样

`node scripts/check-pdf-text-magnifier.mjs` 使用同一 PDF Text harness、真实 selection 库、html2canvas 和 Chromium 鼠标输入。从首末手柄热区角落（圆心外各 9px）抓取，各测 3 个拖动点，核对镜片是否保持 `17c3542` 的布局契约、canvas 采样是否对应原始鼠标，以及标记在画布内的投影位置；另用实际 Reader + PDF.js 预览的鼠标放大镜对照采样相对指针的偏移。

用户澄清后，镜片位置恢复 `06b2e46` 之前的行为：使用原有纠偏后的布局锚点，保留 18px 间距、上下避让和边缘约束。鼠标、笔和触摸的内容采样与插入线使用物理指针 clientX/clientY，并忽略 selection 层转发的纠偏事件；选区命中和保存本身仍保留原纠偏协议。白边内画布的比例定位修正保留，避免 120px 逻辑坐标直接用于实际 114px 画布造成约 3px 误差。

快照边缘仍限制采样源区域，此时实际裁剪中心可能离开指针，标记仍按同一次裁剪换算。常规区域的采样中心不应出现额外向上偏移。鼠标、笔、触摸、取消及纠偏转发另有单元回归；浏览器结果不代表真机触摸验收。

本轮 Chromium 实测：Text 首末端共 6 点的镜片布局均符合旧契约，采样及标记投影误差 < 0.1px；常规区域采样相对物理指针为 `(0,0)`。实际 Reader + PDF.js 预览在 50% 缩放、线中心热区抓取（无有意抓取偏移）后拖动 3 点，采样相对物理指针约 `(-0.0102,0)` px；两边均无额外向上偏移。Text 的源快照边缘样本另按裁剪规则检查，不与常规区域混为一谈。

## PDF 预览镜片垂直距离

预览与 Text 不能只比较共享的 18px gap：两边手柄端点及抓取纠偏不同。扩展同一 Chromium 脚本，从终点热区圆心外各 9px 抓取，再向下拖动 200/220px，测量 `pointerY - lens.bottom`；预览缩放为 50%，镜片均在指针上方。

| 模式 | 调整前 | 调整后 |
| --- | --- | --- |
| Text（两个样本） | 50.515625px | 50.515625px |
| PDF 预览（两个样本） | 43px | 51px |

仅 `EngineSelectionControls` 的 PDF 布局锚点上移 8 CSS px，鼠标 start/move 与触摸 publish 一致处理，采样、命中、保存和共享定位规则保持原路径。常量用于屏幕像素避让，不保证任意字号、缩放及抓取位置下与 Text 严格等距；既有左右钳制、上下翻转仍生效。

Text 原六点的完整 JSON（含镜片、采样及标记）调整前后精确相同，常规区域采样相对物理指针保持 `(0,0)`，Text 生产文件零改动。预览三点采样仍约 `(-0.0102,0)` px；最终脚本同时断言常规样本的两模式距离差小于 1px。鼠标/触摸控制器回归另验证布局与采样分离及取消清理，真机触摸仍待验收。

900px 宽预览的左右边缘鼠标拖动中，镜片左坐标分别为 8px 和 772px（宽 120px），保留 8px 边缘留白；靠近上边时均为 `below`。相关回归 7 文件 / 47 项通过，typecheck 和改动文件 ESLint 通过；本轮未重跑全量。

WebView 构建与 293 个资源校验通过，构建 `85c21fab6f9aed6b`；OpenSpec strict 通过，任务 15/15 完成，尚未进行原生设备验收。
