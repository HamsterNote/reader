# 阅读进度持久化验证记录

实现沿用 `fix-reading-progress-persistence` 的四份规格增量。2 CSS px 容差、裁切/旋转后按新显示框投影均未修改。没有新增依赖、存储键或标注格式，旧快照只读规范化，无初始化迁移回写。

## 五个行为切片

| 切片 | 实现与验证 | 结果 |
| --- | --- | --- |
| 1 旧记录 | `reading-progress-compat`、`reader-snapshot-compat`、`reader`、`host-reader-data-store`：旧锚点/比例/纯变换、当前模式优先、非法比例与偏移、损坏权威快照 | 通过 |
| 2 PDF 首行 | `pdf-document-viewer`：同 span 两位置、半露行、跨页、横向/下方离屏、未知层；真实 PDF.js 320/1280px × 50/100/200% | 通过；初轮文字与比例恢复误差最大0.3125 CSS px；iOS首行offset 1980顶对齐误差0 |
| 3 无字比例 | ready/pending/failed；40% 与近页尾实际采集→防抖保存→重开；旋转90°及上下裁切后新框投影；页间隙/零尺寸/格式回归；新增用户滚动后裁切重开/旋转/关闭采集回归 | `4223f4b` PDF Layout浏览器34场景通过，新增6场景最大0.373607243 CSS px；iOS复测最大1.613961951 CSS px |
| 4 分页 | EPUB/PDF Text 同屏重开、改字号/窗口/横竖屏后包含原锚点；混排图片屏比例12.5%重开及按新片段数投影；固定版式；隐藏页与页范围 | Chromium 通过；EPUB 5场景、PDF Text 2场景、隐藏/范围2场景 |
| 5 离开前保存 | `reading-progress`、`progress-close`、`reader-surface-history`、`webview-bridge-client`、`bridge-contract`：100/1000ms、同页去重、双队列合并、同批绘图、迟到A回调、慢写入、flush/close竞争、失败/超时保留会话、PDF Text加载屏障 | 自动化通过；iOS模拟器后台/切书及裁后关闭通过；Android按负责人决定不测；设备触控约0.84s不证明 <100ms |

## 项目检查

- `yarn test:run`：初轮`418dc51`为104文件/1419用例；审核修复`c05b09a`为105文件/1426用例；裁切修复`4223f4b`为105文件/**1429用例通过**，既有用例保留。
- `yarn typecheck`、`yarn typecheck:host`、`yarn lint`：初轮均通过；`c05b09a`重新通过Reader/host类型检查及改动文件ESLint，`4223f4b`重新通过`typecheck`及改动文件ESLint。本轮仅更新文档，不重跑实现测试。
- `yarn build:all`、`yarn host:check`：初轮通过；`4223f4b`由小助手执行`yarn build:webview`，Mac操作员校验build `248f8b40f34086a1`的293项资源哈希通过。构建保留既有大块/第三方资源提示。
- `openspec validate fix-reading-progress-persistence --strict`：通过。
- `git diff --check`：通过。

复跑实现验证（Reader根目录）：`yarn test:run`、`yarn typecheck`；受影响用例可用 `yarn test:run test/pdf-viewer/pdf-document-viewer.test.tsx test/progress-close.test.tsx test/reading-progress.test.tsx test/review-progress-regression.test.tsx`（`4223f4b`：4文件/51项）。文档检查：`openspec validate fix-reading-progress-persistence --strict`、`git diff --check`。

复跑实际几何检查：先 `yarn build:webview`，再运行 `node scripts/check-reading-progress.mjs`、`node scripts/check-progress-epub.mjs`、`node scripts/check-progress-pdf-text.mjs`、`node scripts/check-progress-restrictions.mjs`。裁切专项可用 `READER_PROGRESS_WIDTH=320 READER_PROGRESS_SCALE=2 node scripts/check-reading-progress.mjs`，包含用户滚动后新裁切的重开、旋转和关闭采集。每个脚本在 finally 中关闭自己的浏览器和服务；Vite检查使用独立缓存。数值与源偏移见同目录 `validation.json`，各记录保留原执行版本，不将初轮检查视作本轮重新执行。

## 设备验收（已补齐，范围与限制）

任务5.3、6.2按负责人确认的范围勾选完成：**Android按负责人决定不测**（HAM-161评论 `01a1a4f4-6ed3-7d3e-93c4-8f1801f319c1`）；iOS由Mac操作员在 **iPhone 18 Pro / iOS 27.2模拟器** 上执行。不是物理真机验证。收尾授权见评论 `01a1a556-099d-7126-8db9-ee3bd12363c6`。Linux本机缺少xcrun/adb/emulator、WebKit缺少系统库的历史环境阻碍不再作为待验收项，设备结论来自独立Mac执行证据。

初验：`c05b09a`，Release WKWebView宿主，macOS 27.2 arm64 / Xcode 27.2；评论 `01a1a533-431d-74d4-8d98-793eb9ae3797`，附件 `ham161-ios-report.md`（`01a1a533-2316-7bf3-bedd-beefd3b18bac`）、`ham161-ios-evidence.zip`（`01a1a533-2cc1-7bf6-b32a-336e7fd361a1`）。

| 初验通过场景 | 实际结果 |
| --- | --- |
| EPUB首章连翻两页重开 | offset 294，同排版正文截图一致 |
| EPUB第2章图片屏重开 | 12.5%，正文截图一致 |
| EPUB特大字号及横竖屏 | 原offset 294仍可见 |
| EPUB后台及跨书重开 | 返回原进程PID 20697，锚点294保持 |
| PDF第1页中段首行 | offset 1980，部分露出首行重开后完整顶对齐，误差0 CSS px（停止惯性后的复测） |
| PDF第2页40% / 近页尾 | 40.029873% / 90.067214%，前后页框差0 |
| PDF横竖屏 | 按新框投影误差0.7805 CSS px；仅设备方向，未覆盖PDF页内独立旋转入口 |
| PDF Text翻页、字号、后台、重开 | offset 2871保持，同排版正文截图一致 |
| EPUB↔PDF切书、PDF Layout后台 | EPUB 294、PDF Text 2871 / Layout 1980独立；Layout固定裁切33.848018%后台保持 |

新裁切初验失败（42.835821%→45.149449%、28.85 CSS px）由`4223f4b`修复，不能将初验的失败记作通过。复测评论 `01a1a552-18c1-7acf-b56a-f63c5957891e`，证据包 **`ham161-ios-4223f4b-evidence.zip`**（附件 `01a1a552-168b-7d82-b275-9349e82d54b9`）。沿用原Release WKWebView宿主，仅替换ZIP、未重新构建原生宿主；实现提交 **`4223f4b`**，运行资源build **`248f8b40f34086a1`**，293项哈希通过，ZIP SHA256 `9bf46f4cc91ab4bef1b62ce668da14ba933f91702287205ca8e9b9178115fae4`。其余初验通过场景未在此复测中重跑。

两次新裁切均为底部0→5.1243782043%，裁前实际42.8358208955%。以下误差统一相对该裁前比例及当前裁后显示框计算（原始值见包内`evidence/final-geometry.json`）：

| 复测路径 | 实际保存值 | 投影误差（CSS px） |
| --- | --- | --- |
| 应用→退出编辑→返回书架重开 | 42.7897221194% | 1.180856714 |
| 裁后重开→横屏→竖屏 | 42.7897221194%保持 | 横屏1.613961951；回竖屏0.586684548 |
| 新裁切应用→退出编辑后连续返回→重开 | 42.7897221194% | 1.180856714 |

三条均在2 CSS px内，无45.15%漂移。第三条没有插入等待/采集；`final3-timing.json`记录退出触控0.843845167s、返回触控0.832225958s，只有“退出即关闭”的间接证据，**不作为 <100ms 证明**。小于100ms关闭的证明来自确定性自动化；初验EPUB连翻后约273ms返回也不满足设备端<100ms证明。慢写入/失败注入、并发标注、强杀及完整缩放组合没有在设备端验证，不扩大已有自动化结论。

Mac复跑：在`4223f4b`实现或后续仅文档提交上运行`yarn build:webview`，以既有`reader/app` Release WKWebView宿主接入ZIP（本项目`native-reader`独立引擎demo不消费该ZIP），确认运行资源build及哈希。使用`progress-fixture.pdf`第2页，先将旧裁切归零；编辑中滚至约42.835821%，底部新裁切5.124378%，应用→退出→返回→重开，核对快照和页框；再横屏→竖屏；再次从0开始新裁切后退出即关闭，重开核对。EPUB/PDF其余场景按上表及初验报告操作。

如使用证据包自动化，需Mac已安装`idb` / MobileBuildMCP、有运行中的相应模拟器、导入fixture并打开PDF第2页，且按本机修改脚本中的模拟器UDID/工具路径；以下为复跑命令，本轮文档收尾未执行Mac脚本：

```bash
multica attachment download 01a1a552-168b-7d82-b275-9349e82d54b9 -o ./ham161-ios-retest
unzip ./ham161-ios-retest/ham161-ios-4223f4b-evidence.zip -d ./ham161-ios-retest/run
cd ./ham161-ios-retest/run
python3 focused-qa.py final1
python3 focused-qa.py final2
python3 focused-qa.py final3
```

保存AX页框、`*-progress.json`、截图及计时，按`P.top + P.height × percentage/100`与正文顶部之差复核；原始页框先扣除裁切区域，容差2 CSS px。证据包中的`final-geometry.json`是既有测量结果，重跑时须用新采集页框重新计算，不能直接当作新结果。归档及`openspec/specs`同步留给合并阶段，本轮仅更新change内三份状态/验证文档。

## 验证边界与说明

旧的 `check-epub-pagination.mjs` / `check-pdf-text-pagination.mjs` 全流程脚本在读取已淘汰的 `data.highlights` 字段处失败，另有WebKit环境阻碍；本次没有改写这些无关标注脚本，以新增四个进度脚本核验本变更场景。

验证期间曾误终止另一并行检查的Chromium子进程，已在过程说明中承认并停止按进程名清理；没有将该并行检查结果计入本报告。

## 改动文件清单

- `app/src/components/ReaderWebView.tsx`
- `openspec/changes/fix-reading-progress-persistence/.openspec.yaml`
- `openspec/changes/fix-reading-progress-persistence/design.md`
- `openspec/changes/fix-reading-progress-persistence/proposal.md`
- `openspec/changes/fix-reading-progress-persistence/specs/epub-web-reader/spec.md`
- `openspec/changes/fix-reading-progress-persistence/specs/expo-reader-host/spec.md`
- `openspec/changes/fix-reading-progress-persistence/specs/pdfjs-web-reader/spec.md`
- `openspec/changes/fix-reading-progress-persistence/specs/reader-data-compatibility/spec.md`
- `openspec/changes/fix-reading-progress-persistence/tasks.md`
- `openspec/changes/fix-reading-progress-persistence/validation.json`
- `openspec/changes/fix-reading-progress-persistence/validation.md`
- `scripts/check-progress-epub.mjs`
- `scripts/check-progress-pdf-text.mjs`
- `scripts/check-progress-restrictions.mjs`
- `scripts/check-reading-progress.mjs`
- `src/bridge/hostSession.ts`
- `src/components/EngineDocumentViewer.tsx`
- `src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer.tsx`
- `src/components/IntermediateDocumentViewer/IntermediateDocumentViewer.tsx`
- `src/components/Reader.tsx`
- `src/components/Reader/useLayoutReadingProgressSave.ts`
- `src/epub/foliateEpubEngine.ts`
- `src/host/readerHostSession.ts`
- `src/index.ts`
- `src/pdf/PdfDocumentViewer.tsx`
- `src/pdf/pdfTextPagination.ts`
- `src/pdf/usePdfTextPagination.ts`
- `src/readingProgress.ts`
- `src/types/readerData.ts`
- `src/viewportPosition.ts`
- `test/epub-pagination-controls.test.tsx`
- `test/epub/engine-session.test.ts`
- `test/pdf-text-pagination.test.tsx`
- `test/pdf-text-viewer.test.tsx`
- `test/pdf-viewer/pdf-document-viewer.test.tsx`
- `test/progress-close.test.tsx`
- `test/reader-surface-history.test.tsx`
- `test/reader.test.tsx`
- `test/reading-progress-compat.test.ts`
- `test/reading-progress.test.tsx`
- `test/review-progress-regression.test.tsx`
- `test/viewport-position.test.ts`
- `test/webview-bridge-client.test.ts`
- `webview/src/ReaderSurface.tsx`
- `webview/src/bridgeClient.ts`
- `webview/src/main.tsx`
