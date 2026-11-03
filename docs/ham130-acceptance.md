# HAM-130 PDF Text 可视分页实施验收

本地实现覆盖 OpenSpec `pdf-text-viewport-pagination`：共享翻页控件、正文矩形测量、输入限制和导航状态类型；PDF 使用自己的 DOM 分栏、原页加载和 canonical 字符端点，EPUB 继续使用 Foliate。TXT 保留虚拟滚动。公开数据继续保存 PDF 原页与字符锚点，不保存列号。

分支：`agent/agent/32b448bcafab`，起点 `3cc037460957bfe7c12c15f50476d4693d7cdc76`。未提交、未推送、未开 PR、未归档 OpenSpec。

任务进度 **14/15**。仅 **5.2 iOS/Android WebView 实机验收** 未完成；本地实现与自动化验收已完成。WebKit 环境缺失单独记录，未将未启动用例标记为通过。

## 实现与回归修复

- `src/components/reading/`：内部双按钮、导航状态、输入限制与测量；不增加公共 API。
- `src/pdf/pdfTextPagination.ts`、`usePdfTextPagination.ts`：实际 Range 片段识别非空列、源字符定位、串行翻页、稳定锚点重排和会话失效清理。
- `IntermediateDocumentTextViewer.tsx`：仅 PDF 分页，复用加载队列、选择/高亮/书签/进度；范围过滤、无文字页、失败重试和缓存淘汰沿用原页身份。
- `textHighlightAdapter.ts`、`PdfTextHandle.tsx`：仅绘制可视窗口内片段，不把离屏端点当作当前屏可调整端点；保留源偏移和历史标注 ID。
- `pdfTextModeDocument.ts`：绕过 `IntermediatePageMap` 对已拒绝 Promise 的永久缓存，允许重试；淘汰正文时同时释放 PDF canonical 索引。
- `Reader.tsx`：模式切换会替换底栏节点，测量器按模式重新绑定，避免把已脱离的底栏算成整屏占用、使 Text 正文变成零尺寸。
- `PdfDocumentViewer.tsx`：在 Layout 视口没有移动时保留交接进来的精确 Text 字符锚点；移动、缩放、显式跳页/范围定位和会话替换后失效。Layout 排版、翻页、缩放、链接、标注引擎保持原实现。
- `scripts/check-engine-interactions.mjs`：更新已过期的“滚轮/滑动切章”和可点击封面断言，使用按钮翻页；跨章手柄目标由稳定字符端点解析，避免依赖切章后会清空的 DOM 选区。

## 环境与证据

2026-11-03，Linux x86_64，Playwright 1.60.0，headless Chromium 148.0.7778.96。触摸场景为 Chromium 模拟，不能据此认定 iOS/Android WebView 已通过。

WebKit 无法启动，缺少 `libicudata.so.74`、`libxml2.so.2`、`libevent-2.1.so.7` 等系统库；完整错误写入各浏览器 `report.json`。当前环境没有可用的 iOS/Android 实机、`xcrun` 或 `adb`。

附件证据包内的路径：

- `pdf-text/report.json`、截图：PDF Text 和 TXT 真实布局场景。
- `epub-pagination/report.json`、截图：EPUB 重排、320px 触摸模拟、固定版式及工具栏避让。
- `reader-integration/report.json`、截图：PDF/EPUB v2/v3/v4 与安全回归。
- `engine-interactions/report.json`、截图：PDF Layout/EPUB 矩形、绘图、隐藏页、缓存回收及跨章高亮。
- `logs/`：执行日志；`implementation.patch`：含新增文件的完整未提交补丁。

PDF Text 单个原页含 1100 个词、8789 个 UTF-16 字符；960×700 时有 7 个可视页。同原页连续两次翻页的锚点为 `page-1-item-0` 的 offset 1306、2586。逐字符枚举每屏可见 Range，7690 个非空白字符各出现一次，未出现分页产生的空白尾页。完整原文、每屏首尾偏移、正文/底栏/按钮矩形在 JSON 中。

## Delta spec Scenario 对照

下表的“通过”指本地 Chromium/自动化范围；所有实机触摸结论仍待任务 5.2。

| Delta / Scenario | 结果与证据 |
| --- | --- |
| PDF / Long source page | Chromium 通过：7 屏、同页前进两屏/回退、跨列源 span、全文逐字符唯一覆盖；`pdf-text/report.json` 的 `screens`、`evidence`。 |
| PDF / Source page and range boundaries | 浏览器原页前进/反向末列、书末禁用通过；Vitest 覆盖隐藏页、pageRange、全隐藏范围和禁止循环。 |
| PDF / No extractable text | 浏览器第 2 原页空状态、返回 Layout 入口通过；组件测试覆盖整册扫描页逐原页导航，无伪造字符锚点。 |
| PDF / Inputs and selection | Chromium 滚轮/横滚、空白输入、全部滚动按键、CDP 滑动不翻页通过；按钮 Enter/Space、评论编辑、侧栏独立滚动、页边拖选通过。原生长按/手柄待实机。 |
| PDF / Responsive and busy controls | 960/320/横屏 740×320 的正文/控件矩形、字号变更和连续 resize 通过；同步双击只前进一屏，单测覆盖 busy 门控与边界。 |
| PDF / Explicit navigation | 书签 offset 3000、历史/新增高亮定位、进度轨道 Home/End 的原页首列通过；selectionRef/页码接线沿同一导航方法。PDF Text 本来不提供独立章节目录。 |
| PDF / Resume and reflow within source page | 关闭重开恢复第三屏、字号中/特大/大、宽窄及连续 resize、临时零尺寸均保留锚点；每次重排检查锚点字符实际位于可视窗口。延迟字体 loadingdone 由受控单测覆盖。 |
| PDF / Mode switch and historic annotation | Layout/Text 往返保留列内字符；历史跨原页 v4 高亮恢复、可视片段裁切、离屏终点无手柄、新增/激活/调整/删除及评论关联通过；v2/v3/v4、连字/展示空格/重复 ID/两栏/旋转映射由 fixture 单测覆盖，仍输出 v4。 |
| PDF / Lazy navigation and retry | 100 页受控组件测试：只提取目标及限定邻页，maxLoadedPages=2，跳页/淘汰/重新加载和提取失败重试通过；PDF facade 测试确认 canonical 释放及拒绝后可重试，旧进度与已确认标注不清空。 |
| PDF / Replace a pending session | 受控延迟测试覆盖 A→B 的旧提取错误、分页帧等待时替换/关闭 Text/卸载，旧内容/按钮/错误/进度不落地；观察器、字体监听和待执行帧清理。 |
| EPUB / Responsive toolbar clearance | 专用 EPUB 浏览器脚本的 Chromium 宽屏、320px、横竖屏与绘图工具展开通过；正文末行/控件避让及固定版式覆盖。WebKit 未执行。 |
| EPUB / Busy and accessible controls | EPUB 控件组件测试和专用浏览器脚本：命名、焦点、点击/Enter/Space、busy/ready/首末禁用通过。 |
| EPUB / Format isolation | PDF Text 有双按钮；切至 PDF Layout 后消失；TXT 原滚动通过且无双按钮；EPUB 章节/固定版式/封面/锚点回归见专用及集成报告。 |

## 宿主数据链路

`ReaderSurface.tsx` 使用既有 `serializeReaderSnapshot`，将 `textReadingProgress` 原样放在 `readerData`；`ReaderScreen.tsx` 沿原入口挂载 `ReaderWebView`，后者的 `persist` 继续调用 `ReaderDataStore.saveSnapshot`。Store 不依赖临时列号，不需要数据迁移或宿主代码修改。

新增 Store/序列化联合回归，将同一 PDF 原页的 offset 1306、2586 分别保存后创建新的 Store，再由 `restoreReaderSnapshot` 读取；字符锚点和模式保留，持久化数据无 `column`。实际 WebView 构建在浏览器通过桥接消息保存/ack/reload；真实原生宿主重启仍待实机。

## 命令结果

| 命令 | 结果 |
| --- | --- |
| `yarn test:run --maxWorkers=4 --minWorkers=1` | 最终完整代码：90 文件、1205/1205 用例通过（72.25 秒），包含 `test/pdf-viewer`、`test/intermediate-document-viewer.test.tsx` 和所有受影响面。日志 `logs/all-tests-final.log`。 |
| `yarn test:run --maxWorkers=2 --minWorkers=1` | 90 文件、1204 用例通过；其后补充的显式跳页取消待恢复锚点用例在下列 PDF viewer 复测中通过。 |
| `yarn test:run test/pdf-viewer/pdf-document-viewer.test.tsx` | 21/21 通过，包括 Layout/Text 精确锚点及显式跳页取消待恢复锚点。 |
| `yarn test:run test/pdf-viewer test/intermediate-document-viewer.test.tsx test/pdf-text-content.test.tsx test/pdf-text-pagination.test.tsx test/pdf-text-viewer.test.tsx test/reading-progress.test.tsx test/epub-pagination-controls.test.tsx test/button-only-input.test.ts` | 13 文件、449 用例通过（增加最后一个取消恢复用例前的运行）；最终全量结果另列。 |
| `yarn test:run test/host-reader-data-store.test.ts test/reader-snapshot-compat.test.ts test/host-reader-session.test.ts` | 3 文件、29 用例通过。 |
| `yarn typecheck` | 通过。 |
| `yarn lint` | 通过；最后新增/修改的 PDF viewer、测试和浏览器脚本也单独运行 ESLint 通过。 |
| `yarn build:webview` | 通过，最终 build `9ad678f08911f1cc`。 |
| `yarn verify:webview` | 通过，293 个文件。 |
| `yarn typecheck:host` | 通过。 |
| `yarn check:browser` | Chromium 13/13 通过；WebKit 13 项因缺系统库未启动，总体 13/26，退出码 1。 |
| `node scripts/check-epub-pagination.mjs` | Chromium 3/3 通过；WebKit 3 项未启动，总体 3/6，退出码 1。 |
| `node scripts/check-pdf-text-pagination.mjs` | Chromium PDF Text、TXT 共 2/2 通过；WebKit 1 项未启动，总体 2/3，退出码 1。 |
| `node scripts/check-engine-interactions.mjs` | Chromium 桌面/触摸模拟 × EPUB/PDF 共 4/4 通过，退出码 0。 |
| `openspec validate pdf-text-viewport-pagination --strict` | 通过。 |

共享机器高负载时一次默认并发全量运行有 6 项超时；减少 worker 后全量通过。保留 `logs/all-tests-high-load.log`，未修改这些测试的业务断言或放宽产品行为。浏览器脚本曾使用旧的原生选区/滚轮翻页/可点击封面假设，其修复后的最终结果为上表的 4/4。

## 待补验收

- iOS：设备型号、系统版本、WebView 版本未取得，未执行。
- Android：设备型号、系统版本、WebView 版本未取得，未执行。
- 两端均需执行 PDF Text 长按、原生选区手柄、页边拖选不翻页、高亮 Popover、侧栏滚动、横竖屏、同原页翻两屏后关闭重开，并回归 EPUB 共享外壳。
- WebKit 的桌面/触摸模拟矩阵需在具备系统库的环境补跑；这不能替代上述实机验收。

按实际验证情况保留任务勾选；OpenSpec strict 校验只证明规划文档有效，不代表上述设备项目已通过。
