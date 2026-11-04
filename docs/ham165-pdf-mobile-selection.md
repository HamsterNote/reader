# HAM-165：PDF 移动选择实现与验证

本次在 reader Web 适配层管理 PDF Layout 的触摸 Range，抑制该路径的原生选择、系统手柄及 touch callout；自绘起止圆柄和活动选区。长按命中 PDF.js 已增强 textLayer 后开始选词；普通平移、多指和非文字工具不启动长按候选。没有复用依赖分页列的 PdfTextHandle。

RangeHandleCircle 共享文字模式的 20 CSS px 圆柄视觉和不透明手柄颜色；引擎控件复用已有 RangeMagnifier。拖动修正圆心抓取偏移，采用 pointer capture/document 收尾；取消、失焦、第二指、会话替换或节点回收不提交。已保存高亮的调整只更新对应成员并保留 ID/样式，不连续分组按原成员预览和序列化，避免把间隙合并进去。

PDF Layout/Text 的草稿预览、新建高亮使用底栏 resolvedHighlightColor（包括 alpha）；PDF 的独立 selectionColor 不再覆盖底栏色。活动草稿换色保留端点，历史标注保留原色。这是 PDF selectionColor 的行为调整，无持久化格式迁移。

## 改动文件

- `src/pdf/pdfTouchSelection.ts`：PDF 文字命中、500 ms 长按候选、移动/多指取消、受管 Range 和节点失效清理。
- `src/pdf/PdfDocumentViewer.tsx`：受管选区的获取、清除、恢复、确认和序列化；分组成员预览及端点调整；PDF 预览颜色变量。
- `src/pdf/pdfSelectionSerializer.ts`：支持直接序列化 Range，保留原页字符锚点。
- `src/pdf/PdfPageOverlayLayer.tsx`：分组选区沿用已存颜色。
- `src/components/EngineDocumentViewer.tsx`：PDF 触摸手柄接线、选择回调和高亮更新事务。
- `src/components/EngineSelectionControls.tsx`：圆柄、SVG 预览、命中纠偏、捕获/取消/收尾和放大镜。
- `src/components/IntermediateDocumentViewer/RangeHandle.tsx`：共享 RangeHandleCircle，文字模式保持原拖动适配。
- `src/components/Reader.tsx`、`src/styles/pdf-viewer.scss`：PDF 两模式颜色统一及仅限 PDF 触摸路径的原生选择抑制。
- `test/engine-selection-controls.test.tsx`、`test/pdf-viewer/pdf-document-viewer.test.tsx`、`test/pdf-viewer/pdf-selection-serializer.test.ts`、`test/reader.test.tsx`、`test/engine-pdf-progress.test.tsx`：长按、取消、双端调整、离屏端点、分组、序列化和颜色回归。
- `scripts/check-web-selection.mjs`、`scripts/check-pdf-mobile-selection.mjs`、`test/browser/review-regressions.tsx`：真实 CDP touch 输入及跨模式颜色验证；脚本自动启动临时 Vite 服务并在 finally 中关闭。修正原浏览器脚本对旧存储键和旧 div 背景色的断言，按当前 V5/SVG 实现检查。
- `README.md`、本文件、`openspec/changes/fix-pdf-mobile-selection-handles/`：行为说明、验证记录和任务状态。

## 已执行的验证

使用仓库原有 yarn.lock 安装依赖：`yarn install --frozen-lockfile`。遵照实现交接要求，以下检查通过 npm 调用 package.json 中已有脚本（与任务文档的 yarn 命令等价）：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:run` | 105 个文件，1435 项测试全部通过 |
| `npm run test:run -- test/engine-selection-controls.test.tsx test/engine-selection-transactions.test.tsx test/pdf-viewer/pdf-document-viewer.test.tsx test/pdf-viewer/pdf-selection-serializer.test.ts test/engine-pdf-progress.test.tsx` | 最终整理后再次通过：5 个文件，67 项测试 |
| `npm run build:webview` | 通过，生成宿主资源包 |
| `npm run verify:webview` | 通过，293 个资源文件完整 |
| `npm run check:web-selection` | 7 组浏览器回归通过，结果与截图写入 test-results/web-selection |
| 对本次核心交互文件执行 `npx eslint` | 通过 |
| `openspec validate fix-pdf-mobile-selection-handles --strict` | 通过 |

浏览器：Playwright Chromium，430×900 移动视口、hasTouch/isMobile，使用 DevTools Protocol `Input.dispatchTouchEvent` 产生触摸输入。验证长按后选中 beta、原生 Selection 为空、textLayer 的 user-select 为 none、起止圆柄均可拖动并跨行选择、20 px 视觉尺寸、活动换色后确认只创建一个高亮，以及再次拖动历史高亮只更新一次且 ID/颜色保留。另检查 50%/100%/200% 缩放和 PDF Text 活动选区由绿变玫红。

完整浏览器脚本还验证 PDF 桌面选择、缺少 randomUUID 时选择、带标签 PDF 的链接/目录、历史高亮颜色和矩形操作、滚轮及触摸滚动、自定义进度跳转，以及 EPUB Layout/Text 的目录导航。自动化检查结束后关闭全部由本脚本创建的浏览器和临时服务；未启动常驻 dev server。

构建保留已有 PDF.js 图片路径、OpenCV 浏览器 externalization 和大包体提示；WebView 资源校验通过。测试保留已有 React act/PDF 字体警告，未把这些警告描述为设备验收结果。

## 未覆盖：iOS / Android 真实 WebView

OpenSpec 4.3 保持未勾选，当前为 11/12；浏览器触摸模拟不能替代真机验收。请分别记录设备型号、OS/WebView 版本及以下实际结果：

1. 长按文字后双端扩展/缩短与跨行调整；确认只生成一次高亮，历史高亮调整后重开保留 ID、评论关联与原色。
2. 系统选择手柄、复制/查询/分享菜单及 iOS touch callout 全程不出现；拖柄放大镜显示与取消后消失正常。
3. PDF Layout/Text 底栏 A/B 换色和透明度；独立 selectionColor 不覆盖底栏色。
4. 50%/100%/200% 缩放、页面滚动后、旋转页与裁切页的命中和圆心对齐；离屏端点不生成替代手柄。
5. pointercancel、失焦、多指、切工具/模式/书籍和页面回收后的回滚及后续选择。
6. 普通触摸滚动、双指导航/缩放、链接点击和无文字扫描页。

未进行真实 iOS/Android WebView 操作；旋转/裁切的低层几何已有测试通过，但本轮没有逐设备验证旋转/裁切页上的触摸拖柄。未新增拖到视口边缘自动滚动或翻页。
