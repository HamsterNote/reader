本记录保存实现自查阶段的证据，范围为 reader 的 PDF.js/Web 阅读链路，基线提交 `bc956dada20f00f222a7110c650461dd8d3528be`。自查结束时尚未推送或开 PR；后续交付阶段已归档此 change 并同步主 specs，提交及 PR 信息以仓库记录为准。未发布包、未修改 issue 状态，未修改 WebBase 源码。

## 改动文件

核心实现：

- `src/pdf/PdfDocumentViewer.tsx`：几何续读和独立文字交接采集；文字 ready/pending/failed 分开处理，继续使用既有安全矩形和恢复机制。
- `src/pdf/pdfReadingPosition.ts`：复用 canonical 字符几何映射，支持单字符多矩形的安全交集。
- `src/components/EngineDocumentViewer.tsx`：独立发布几何进度和安全首行文字；提供互切采集句柄。
- `src/components/Reader.tsx`：实时文字交接优先，未就绪时留在来源模式；卸载时按来源模式记录交接，隔离旧文档回调。
- `src/components/IntermediateDocumentViewer/IntermediateDocumentViewer.tsx`：兼容扩展可选互切句柄。
- `src/types/readerData.ts`：更新比例进度注释，不改变存储字段。

回归测试：`test/engine-pdf-progress.test.tsx`、`test/pdf-viewer/pdf-document-viewer.test.tsx`、`test/pdf-viewer/pdf-reading-position.test.ts`、`test/reading-viewport.test.ts`、`test/pdf-mode-handoff.test.tsx`。

浏览器脚本：`scripts/check-reading-progress.mjs`。

文档：`README.md`、`docs/ham228-webbase-integration.md`，以及本 change 的原始产物、更新后的 design/tasks 和本验证记录。

## 实际执行命令与结果

工作目录均为 reader。以下为最终有效结果；迭代期间失败的中间代码/夹具不列作通过证据。

| 命令 | 结果 |
| --- | --- |
| `yarn install --frozen-lockfile` | 通过，未变更依赖或锁文件 |
| `yarn typecheck` | 通过 |
| `yarn test:run` | 133 个文件、1774 项测试通过 |
| `yarn test:run test/pdf-viewer/pdf-layout-anchor.test.tsx test/pdf-mode-handoff.test.tsx test/reader.test.tsx` | 最终补查 3 个文件、170 项通过 |
| `yarn test:run test/pdf-viewer/pdf-document-viewer.test.tsx` | 50 项通过，含当前文字提取失败但几何仍可保存的回归 |
| `yarn build:demo` | 通过；仅有资源体积及上游依赖警告 |
| `yarn build:lib` | JS、声明文件与样式构建通过 |
| `node scripts/check-reading-progress.mjs` | 199 个真实 Chromium 场景通过；最大对齐误差 0.5 CSS px |
| `git diff --check` | 通过 |
| `openspec validate fix-pdf-safe-area-reading-progress --strict --json` | 通过，无校验问题 |

浏览器矩阵：320 / 1280px × 50% / 100% / 200% × 顶部 0 / 80px / 外层预留 80px。199 条记录中包括文本几何往返 72、无字比例往返 18、末页夹取 18、旋转 18、裁切 18、A→Text→B 安全文字交接 18、重复互切 18、无字模式往返 18、实际 PDF.js 页面回收后恢复 1。全部对齐误差为有限数且 ≤ 0.5 CSS px。

## 11 项任务的验证对应

1.1—3.2 的下列测试均由实际运行的 `yarn test:run` 覆盖，不将推荐的单文件重跑命令误报成已单独执行。

| 任务 | 验证命令 / 覆盖文件 | 结果 |
| --- | --- | --- |
| 1.1 | `yarn test:run`；engine-pdf-progress、pdf-document-viewer | 有字页 35%/65%，文字 pending/failed，文字到达不改比例通过 |
| 1.2 | `yarn test:run`；reading-viewport、viewport-position | 80px 对应 20%，外层预留不重复扣除，零尺寸、缩放/裁切/旋转公式通过 |
| 1.3 | `yarn test:run`；engine-pdf-progress、pdf-document-viewer | 页间隙下一页 0%，隐藏/范围排除，恢复抑制、控制回显及关闭采集通过；浏览器补验页尾夹取 |
| 2.1 | `yarn test:run`；pdf-reading-position、pdf-document-viewer | 遮挡、部分可见、横向离屏、跨页/跨行、canonical/连字、文字 pending/failed 通过 |
| 2.2 | `yarn test:run`；pdf-mode-handoff、engine-pdf-progress | 存比例 35% + 当前 A + 目标旧进度采用 A，Text 返回 B，未就绪不切换通过 |
| 2.3 | `yarn test:run` + 浏览器脚本 | 安全线文字对齐，Text 字符所在分页、禁止正文强制滚动，重复互切及无字 60% 往返 |
| 3.1 | `yarn test:run`；reading-progress-compat、reader、engine-pdf-progress | 旧文字/virtualPaper 回退、重开不回写、有效移动后比例保存及非 PDF 行为通过 |
| 3.2 | `yarn test:run`；reading-progress、progress-close、review-progress-regression、reader | 同页最新比例立即 flush、并发标注合并、失败保留、切书/模式旧回调隔离通过 |
| 4.1 | `node scripts/check-reading-progress.mjs` | 记录原页号、保存比例、A/B 字符身份、安全线和对齐误差；199 个真实 Chromium 场景通过；最大对齐误差 0.5 CSS px |
| 4.2 | 上表类型、单测、构建与浏览器命令 | 类型、1774 项单测、Demo/库构建通过；199 个浏览器场景通过 |
| 4.3 | 只读核对 WebBase 接线与 `docs/ham228-webbase-integration.md` | 正式版本/锁文件、安全区变量和 sidecar 往返要求齐全，四项 WebBase 检查命令齐全 |

## 下游条件和验证边界

WebBase 当前 `ReaderEditorPane.tsx` 没有传 `engineSource`，document-only 入口不会仅因依赖升级自动进入本次修复的 PDF.js 引擎路径。下游须接通原 PDF 源、消费正式 reader 版本并更新两份锁文件，再运行 `pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web` 和真实壳层 safe area / sidecar 往返验收；上述 WebBase 命令本轮未运行，也不宣称 WebBase 产品已修复。

未执行原生构建、Maestro、模拟器或真机验证。实验性原生 PDF 字符数比例互切未改。浏览器回归使用 Linux headless Chromium，测试服务随脚本关闭，不交付持久 Dev Server。

## PR 评审后的受控入口补查

`renderMode` 与 `data.renderMode` 请求现在共用工具栏的 ready/pending/failed 交接事务。PDF 的请求模式与实际模式分开：pending 保留来源并等待就绪，failed 保留来源并提示重试；只有 ready 才卸载来源。撤销外部请求、换源和父组件未接受工具栏请求均有回归覆盖。句柄保留旧可选方法兼容性，新增判别联合结果传递失败状态。

引擎通过原生 capture 监听 wheel，保证 PDF 子层阻止冒泡时仍能解除“未交互不回写”门禁。回归同时确认未交互关闭不写回，以及被子层停止传播的滚轮之后可以采集最终 65%。

- `yarn typecheck`：通过。
- `yarn test:run test/pdf-mode-handoff.test.tsx test/engine-pdf-progress.test.tsx`：25 项通过。
- `yarn test:run`：133 个文件、1788 项通过（包含上述新增回归及下述选文回归）。
- `yarn build:lib`：JS、类型声明、样式通过。

下游真实鼠标 E2E 暴露 PDF Text 首行选中首字符即弹出浮层，挡住后续拖动的回归。`PdfTextSelectionControls` 在原生 `selectingText` 期间隐藏浮层和手柄，松开后展示，避免与原生选区竞争命中。`test/pdf-text-managed-controls.test.tsx` 覆盖拖选中/结束两个阶段；该文件 3 项通过。下游诊断复测中完整鼠标拖选、保存高亮文本包含 PDF、重开后高亮仍在均通过；最终 fresh-build 结果以下游记录为准。

补充 PDF 待互切时同一 Reader 换为非 PDF 的取消回归：scope 清理在格式分支前执行，旧请求不能切换新文件的模式。最终全量与库构建均包含此修正。

WebBase 接线和真实 sidecar 的产品验证证据单独保存在下游 `docs/testing/ham228-pdf-engine.md`；reader 单测通过不等于下游产品验证通过。
