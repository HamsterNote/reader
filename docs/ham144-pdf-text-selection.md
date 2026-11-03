# HAM-144 PDF Text 选区手柄策略与 5.2 证据补充

2026-11-03：PDF Text 的预期是 **selection 组件的长按选择 + Reader 自绘圆形端点手柄**。HAM-142 看到的灰色圆形 Web 按钮符合该实现，不是 iOS 原生手柄失效后的回退路径。本次按 HAM-144 授权修正 PDF Text 的验收及主规格；不修改业务代码、WebView 配置、依赖或 UIScene 检查。

原 `reader-data-compatibility` 的 Native touch selection 场景与任务 5.2 笼统要求“原生手柄”，确实与 PDF Text 实现不一致。现明确 PDF Text 例外，保留 EPUB / PDF Layout 原有要求，不把自绘实现称为系统原生能力。本记录补充 HAM-130 的验收文档和已归档任务，不将历史记录改写为曾经通过。

## 代码依据

核对基线：`main@c23327a445e5226204e429eb547f02f7c38062e9`；HAM-142 验证的是 PR #39 `f8b14e3e2b8e2f2a96abae2fe23d10c5c48efd56`，下述 Reader 手柄文件及 Text viewer 在两者间无差异。`PdfTextHandle` 自 HAM-130 实施提交 `a0de8dd` 引入。

| 路径 | 实际职责及策略 |
| --- | --- |
| `src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer.tsx` | `isPdf` 时明确把 `HamsterSelection.renderHandle` 设为 `PdfTextHandle`；非 PDF Text 不走此渲染器。 |
| `src/pdf/PdfTextHandle.tsx` | 草稿取 `linkedData.activeRange`，已保存高亮按 range ID 查找；用源 offset 判断端点所在列。端点不在当前原页/可视列时返回 null，不在裁切边缘伪造端点。 |
| `src/components/IntermediateDocumentViewer/RangeHandle.tsx` | 渲染 20 CSS px 的圆形 HTML button，沿用 selection 的 class / aria-label / onPointerDown，接入 Reader 拖动校正和放大镜。颜色来自传入样式，不固定为 iOS 系统蓝色。 |
| `@hamster-note/selection@0.3.0` | `dist/index.js` 在 `(pointer: coarse)` 下安装自己的 touchstart/move/end/cancel 监听，以 450ms 长按创建选区，并在手势期间添加 suppress-native-selection 类。不是仅依赖 WKWebView 的系统长按 UI。 |
| `src/components/reading/buttonOnlyInput.ts`、`src/pdf/usePdfTextPagination.ts` | 限制正文 wheel、touchmove 和滚动按键；不拦 touchstart，不选择手柄渲染器。正文 overflow clip 也阻止选区自动滚动。手柄通过 pointer 事件调整源端点，不能通过放开滚动来“恢复原生手柄”。 |
| `app/src/components/ReaderWebView.tsx`、`patches/react-native-webview-13.16.1-ios-edit-menu.patch` | 抑制系统编辑菜单；没有原生/自绘手柄切换开关。保留原生 DOM Selection 能力与应用实际使用系统手柄是两个不同结论。 |

采用自绘渲染器有具体的分栏约束：源选区可能跨可视列或原页，裁切后看到的矩形边缘不一定是真实源端点。`PdfTextHandle` 根据原页字符位置决定哪些端点可操作，避免用户从伪端点修改持久化范围。不能简单删除 renderHandle 来满足旧措辞。

## 改写后的可观察判据与已有证据

证据来自 HAM-142 附件 `HAM-142-macOS-evidence.zip`（attachment ID `01a1a117-722a-7601-bf47-c65170f0b567`），根目录 `HAM-142/`。环境为 Xcode 27.2 / iPhone 18 Pro / iOS 27.2 模拟器，Release 构建。HAM-144 通过认证 CLI 下载、查看原图及解析原始 AX JSON，未重新运行模拟器。

| 判据 | 既有观测与结论 |
| --- | --- |
| 长按文字出现选区和高亮 Popover | `12-text-ready.png` 可见粉色选区、“高亮”和颜色控件；`18-text-ready.json` 有对应 Web 控件。模拟器支持。 |
| 可见源端点使用圆形自绘手柄，AX 可区分起点/终点 | `12-text-ready.png` 可见灰色圆形；`18-text-ready.json` 两个节点均为 `role=Button`、含 `WebContent`，名称分别为“拖动以调整选区起点/终点”。frame 宽 20、高约 20.02；起点 x=0、终点 x=71、y≈194.08。与 RangeHandle 的 20px 实现一致。模拟器支持。 |
| 拖动手柄可以调整选区；拖至页边不自动翻页 | HAM-142 报告记录从终点向右边缘拖动；`12-text-ready.png` → `13-edge-selection.png` 粉色区域扩大，仍为同一正文页且 Popover 保留。`19-edge-selection.json` 保留起点按钮，终点按钮已不在该 AX 快照中。此证据支持本次扩大/页边操作，不证明终点随后持续可见、双端所有拖动方向或精确源 offset。 |
| 系统复制/查询/分享菜单不出现，高亮工具可操作 | `12-text-ready.png`、`13-edge-selection.png` 和 HAM-142 报告未见系统菜单；`14-after-highlight.png`、`30-restored-highlights.png` 及报告支持保存与重开恢复。是这些操作的观测结论，不宣称穷尽所有系统菜单入口。 |
| 离屏源端点不在当前列边缘生成替代手柄 | 由 `PdfTextHandle` 的明确列判断和既有 HAM-130 Chromium 跨原页高亮回归支持；HAM-142 的 AX 不足以单独验证所有分栏边界，不能仅凭终点按钮消失推断其源 offset。 |

HAM-142 的其余 5.2 模拟器证据继续有效：

- 侧栏独立滚动：`28-sidebar-unique-before.png` / `29-sidebar-unique-after.png`、`40-sidebar-many-unique.json` / `41-sidebar-unique-scrolled.json`。
- 横竖屏：`18-landscape.png`、`27-landscape.json`。
- 同原页翻两屏后关闭重开：`21-long-text.png` 至 `24-long-reopened.png`、`long-reopened-snapshot.json`（原页 1、offset 960）。
- EPUB 共用外壳：`10-epub-page2.json`、`34-epub-restored.png`。

## 验证层级与剩余项

| 范围 | 状态 |
| --- | --- |
| PDF Text 手柄策略及“原生手柄”歧义 | 已明确并修正文档/规格；无须实现原生手柄补丁。 |
| HAM-142 iOS 模拟器已有操作 | 按上述可观察判据补记自绘手柄外观、扩大选区、页边不翻页及菜单抑制证据，不再保留“未确认系统原生手柄”这一不适用判据。 |
| iOS 真机 / Android WebView 真机 | 未执行；任务 5.2 仍为未勾选。后续按上述判据执行并记录设备、系统/WebView 版本和截图；补充双端扩大/缩小、保存后源端点及离屏端点检查。 |
| WebView 重载 | HAM-142 仅验证 LLDB 调用现有 WKWebView reload；错误浮层按钮的 React generation 重建不由本记录补记通过。 |

HAM-144 本轮只做证据复核和文档澄清。Linux 本地复跑 `yarn test:run test/range-handle-drag.test.tsx test/pdf-text-pagination.test.tsx test/pdf-text-viewer.test.tsx test/button-only-input.test.ts --maxWorkers=2 --minWorkers=1`：4 文件、13/13 用例通过；测试输出已有 React act 警告。这些测试不替代移动设备触摸验收。两份修改的主规格 `pdfjs-web-reader`、`reader-data-compatibility` 分别运行 `openspec validate <spec-name> --type spec --strict --no-interactive` 均通过。
