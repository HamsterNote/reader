# 阅读进度持久化验证记录

实现沿用 `fix-reading-progress-persistence` 的四份规格增量。2 CSS px 容差、裁切/旋转后按新显示框投影均未修改。没有新增依赖、存储键或标注格式，旧快照只读规范化，无初始化迁移回写。

## 五个行为切片

| 切片 | 实现与验证 | 结果 |
| --- | --- | --- |
| 1 旧记录 | `reading-progress-compat`、`reader-snapshot-compat`、`reader`、`host-reader-data-store`：旧锚点/比例/纯变换、当前模式优先、非法比例与偏移、损坏权威快照 | 通过 |
| 2 PDF 首行 | `pdf-document-viewer`：同 span 两位置、半露行、跨页、横向/下方离屏、未知层；真实 PDF.js 320/1280px × 50/100/200% | 通过；文字与比例恢复数值误差最大 0.3125 CSS px |
| 3 无字比例 | ready/pending/failed；40% 与近页尾实际采集→防抖保存→重开；旋转90°及上下裁切后新框投影；页间隙/零尺寸/格式回归 | 通过；PDF Layout 浏览器共28场景 |
| 4 分页 | EPUB/PDF Text 同屏重开、改字号/窗口/横竖屏后包含原锚点；混排图片屏比例12.5%重开及按新片段数投影；固定版式；隐藏页与页范围 | Chromium 通过；EPUB 5场景、PDF Text 2场景、隐藏/范围2场景 |
| 5 离开前保存 | `reading-progress`、`progress-close`、`reader-surface-history`、`webview-bridge-client`、`bridge-contract`：100/1000ms、同页去重、双队列合并、同批绘图、迟到A回调、慢写入、flush/close竞争、失败/超时保留会话、PDF Text加载屏障 | 自动化通过；iOS/Android后台实测未完成 |

## 项目检查

- `yarn test:run`：104个文件，1419个用例通过。
- `yarn typecheck`、`yarn typecheck:host`、`yarn lint`：通过。
- `yarn build:all`、`yarn host:check`：通过；资源校验293文件。构建保留既有大块/第三方资源提示。
- `openspec validate fix-reading-progress-persistence --strict`：通过。
- `git diff --check`：通过。

复跑实际几何检查：先 `yarn build:webview`，再运行 `node scripts/check-reading-progress.mjs`、`node scripts/check-progress-epub.mjs`、`node scripts/check-progress-pdf-text.mjs`、`node scripts/check-progress-restrictions.mjs`。每个脚本在 finally 中关闭自己的浏览器和服务；Vite检查使用独立缓存。数值与源偏移见同目录 `validation.json`。

## 尚待设备验收

任务5.3、6.2保持未勾选：Linux环境没有xcrun（MobileBuildMCP返回`spawn xcrun ENOENT`），也没有adb/emulator。WebKit启动因缺少ICU、libxml、flite等系统库失败；Chromium不能替代真实WebView后台行为。

- EPUB：在iOS/Android阅读宿主导入附件 `progress-fixture.epub` → 第1章连续点两次下一页并记住首行 → 翻页后100ms内返回书架 → 重开应同屏；进入第2章图片屏再退出重开，应仍在该图片屏。改字号为特大、横竖屏切换后应包含原锚点；后台往返后会话保留，再关闭重开核对进度。
- PDF：导入附件 `progress-fixture.pdf` → 第1页重复文字滚到中段并记住首行 → 100ms内返回再重开，首行完整出现；第2页空白分别停40%和近页尾，退出重开核对比例。旋转/裁切后按新显示框投影；切到Text翻页后改字号并重开。后台往返、切书A→B后重开A分别核对，不将未确认写入当作成功保存。

另需在慢存储/失败注入环境中确认关闭失败保留阅读页且可重试；强杀仅核对最后一次实际落盘位置。记录源字符offset/页内比例、重开位置、设备系统及应用版本。验收完成后再勾选5.3、6.2。

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
- `test/viewport-position.test.ts`
- `test/webview-bridge-client.test.ts`
- `webview/src/ReaderSurface.tsx`
- `webview/src/bridgeClient.ts`
- `webview/src/main.tsx`
