# Tasks

本清单用于 apply 实现与自查；完成项以代码及验证证据为准。落盘及实现任务仅限 reader；WebBase 的正式依赖接入与宿主验收列为下游交接条件，不授权在 reader 的 repo-local change 中编辑其他仓库。范围按 proposal 的默认 Web/WebView 假设执行，实验原生 PDF 不计入完成声明。

## 1. 纯 PDF 按安全线保存与恢复

- [x] 1.1 在 `src/pdf/PdfDocumentViewer.tsx` 拆分页面几何与首行文字采集，使 PDF Layout 的 `captureReadingPosition` 始终输出原页号和安全线页内比例；扩展 `test/engine-pdf-progress.test.tsx`，验证有字页安全线 35% / 65% 的两个记录、文字层延迟时仍可保存、文字返回不改变比例。
- [x] 1.2 在现有 `readingViewport` / `viewportPosition` 与 PDF `viewportRect`、`pageRect`、`alignTop` 中统一采集和恢复坐标，复用现有几何工具而不增加固定补偿；扩展 `test/reading-viewport.test.ts`、`test/viewport-position.test.ts`，验证剩余遮挡 80px 的算例得到 20%、外层已预留不重复扣除、零尺寸不产生新位置。
- [x] 1.3 接通 PDF 几何恢复和 EngineDocumentViewer 的 Layout 发布，保留恢复抑制与同页位置去重；通过引擎回归验证页间隙选择下一允许页 0%、隐藏/范围外页不参与、100% 页尾夹取及待加载状态保留旧位置，不出现临时 0 覆盖。

## 2. PDF 预览与纯文字互切保持安全首行锚点

- [x] 2.1 让 PDF `captureTextAnchor` 独立调用已有可见字符 / canonical 映射，并为互切提供能区分 ready-without-text、pending、failed 的内部结果；扩展 `test/pdf-viewer/pdf-reading-position.test.ts` 及引擎测试，验证遮挡行、部分露出首行、跨行 span、左右离屏和跨页文字均按安全矩形筛选，文字 pending 不伪装为无字。
- [x] 2.2 调整 EngineDocumentViewer 的文字通知及 `Reader.tsx` 的 `handoffReadingPosition` / `handleRenderModeChange`，让已存 Layout 比例不抢占实时文字交接；通过 `test/review-progress-regression.test.tsx` 或邻近 Reader 用例，验证“存比例 35% + 当前首行 A + 目标旧位置”的互切选择 A，Text 返回使用其当前首行 B，pending/失败不跳到旧位置。
- [x] 2.3 接通 Text → Layout 的文字安全线对齐与 Layout → Text 的包含目标字符分页语义，保持无字比例回退；用互切回归验证顶部遮挡行 X 不被采集、B 对齐安全线、同位置反复互切不累计漂移、无字 60% 往返、Text 正文不被强制滚动。

## 3. 历史数据和关闭保存保持可靠

- [x] 3.1 保留旧 Layout 文字进度及 virtualPaper 回退读取，只有后续有效阅读移动/导航才保存比例，不改文字书签和高亮导航；扩展 `test/reading-progress-compat.test.ts`，验证旧记录重开不回写、滚动后比例续读、当前模式优先及非 PDF/EPUB/Text 原行为。
- [x] 3.2 将新比例路径接入既有保存队列和显式 flush，保持最新 ReaderData 合并与文档代次隔离；通过 `test/reading-progress.test.tsx`、`test/progress-close.test.tsx` 验证同页滚动后立即关闭保存最新比例、并发高亮保留、恢复失败不覆盖、连续切模式/切书的旧回调不串写。

## 4. Web 几何验收与下游交接

- [x] 4.1 扩展 `scripts/check-reading-progress.mjs` 的真实浏览器夹具，覆盖 0 / 80px 顶部遮挡、外层已预留、320px / 宽屏、有字/无字、50% / 100% / 200% 缩放、裁切/旋转、页回收和互切；运行浏览器回归，交付源页号、保存比例、目标字符身份、V.top 及最终对齐误差记录，可达位置误差 ≤ 2 CSS px，边界按合法夹取比较。
- [x] 4.2 在 reader 运行 `yarn typecheck`、`yarn test:run`、`yarn build:demo` 以及 4.1 的浏览器回归；记录结果及未覆盖项。开发时验收为 Web-only，native 构建、Maestro、模拟器和真机结果不作为完成判据。
- [x] 4.3 交付 WebBase 接入说明，明确需消费含修复的正式 reader 版本及对应锁文件，列出 `use-reader-contain-margins.ts` / `ReaderEditorPane.tsx` 的安全区参数和 `use-reading-position.ts` / `sidecar-storage.ts` 的往返验收；验收该交接文档包含 `pnpm typecheck`、`pnpm test:run`、`pnpm build:web`、`pnpm test:e2e:web` 与浏览器注入 safe area 的检查，说明未接入正式版本前不得宣称产品已修复，并且不包含宿主算法复制、node_modules 修改或运行时 patch。此项只交付说明，不在 reader change 内执行 WebBase 修改、发布或部署。
