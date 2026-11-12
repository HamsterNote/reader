# HAM-226：清理 PDF 文字高亮调整后的旧片段

在 WebBase 的实际 ReaderEditorPane、受控 ranges 和侧车持久化路径上复现：源字符顺序与显示顺序相反的 PDF，创建高亮、取消选中、重新选中，再扩大与缩小范围后，旧片段仍留在宿主中。主线受管手柄修复了拖动时的预览生命周期，但没有解决只使用逐范围回调的宿主里的片段清理。

## 多定位文字组的新选区入口（2026-11-12）

报障人的截图提示多组独立定位文字。回归样本现已加入
`test/fixtures/pdf/positioned-runs.pdf`：两条标题、九组各三字符的正文，
每组都有独立的 BT/Tm/Tj/ET，共 11 次定位与绘制。短选区跨越四个定位组。

在 f21d590 构建上，选中文字、两端反复扩大和缩小、松手、点击工具栏“高亮”，
保存为四条范围（断言原始输出 `4 !== 1`）。草稿移动和释放期间没有保存中间态；
四条范围其实仍共享 selectionGroup，不能把这个复现归因于逐帧创建或逻辑 ID 丢失。
PDF.js 在各组之间产生空白源项，Text 排版省略这些项并补展示空格；
canonical 转换把这些源空白误当成不连续选区，逐组发给 WebBase 的 upsert 回调。

修复让转换同时检查真实页文本：只跨过确认为纯空白的正向源间隔，保留一个范围。
逆序、未知间隔或包含未选中文字的间隔仍拆为同一逻辑高亮的多个 canonical 片段。
上一轮 onRemoveRange 清理退出分组成员的逻辑保持。没有修改 WebBase 或 Spec。

```sh
POSITIONED=1 WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' WEBBASE_TEST_OUTPUT=test-results/webbase-positioned-after node scripts/check-webbase-pdf-draft.mjs
WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' WEBBASE_TEST_OUTPUT=test-results/webbase-positioned-normal-regression node scripts/check-webbase-pdf-draft.mjs
REORDERED=1 WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' WEBBASE_TEST_OUTPUT=test-results/webbase-positioned-reordered-regression node scripts/check-webbase-pdf-draft.mjs
```

每份样本四组（Chromium 148.0.7778.96），每组两端各调整三次，每次往返 25 次。
逐帧、逐次释放检查草稿未持久化中间范围，只有一个预览和一对手柄；
确认后只保存最终一条，核对文本、页号和 canonical 端点；取消并重选不增加条目。
多定位样本最终是 `mno pqr stu v`，page-1 的 [38,51)，Text 中四个合法绘制片段。
还切换到 WebBase 实际使用的 Layout 叠加层，检查只列一条高亮，绘制数量对应四组
文字与三个源空白的几何；逐组点击选中同一条，切回 Text 再选中后条目与节点不增殖。
普通长 run 最终为 mnopqrstuv 的 [34,44)；逆序样本最终为 m 的 [35,36)。

初始选择用鼠标建立，触摸用 Chromium CDP 模拟，未覆盖系统长按建立选区；
跨模式往返的附加点击用鼠标。等待新持久化写入后 300ms 静默并非队列严格清空的证明。
尚未取得报障人的原始 PDF，修复的是可重复的多定位组/源空白误拆分路径，仍需人工复核。

## 复审：显示空格端点的往返（2026-11-12）

审核在 47d0a9a 上发现：源组间有多个空白而 DOM 只有一个显示空格时，
从显示空格起选会保存前一组源末尾，反向映射找不到锚点却把源 offset 当作 DOM offset。
3 个源空白会还原成 hi jkl，11 个源空白会还原失败。

现在共享端点转换按 side 向选区内部归一：起点取后方的可见锚点，终点取前方的锚点，
同时裁掉对应的显示空白。反向映射失败返回 null，禁止把无法映射的源 offset 当作 DOM offset；
端点按页挂载情况逐端转换：未挂载的固定端保留 canonical 坐标，
已挂载端正常转为 DOM 坐标；保存时可见端转回 canonical，固定端原样保留。
已挂载页面上的非法偏移仍拒绝转换，失败的已有条目保留原分组，不能写成删除快照。
没有改动 WebBase、onRemoveRange 清理或已确认源空白的内部合并条件。

`test/pdf-selection-offset-boundaries.test.ts` 覆盖 3 / 11 个源空白，输入 DOM [7,15)，
保存分别为 page-1 [12,21) / [28,45)，均还原为 DOM [8,15) 的 ghi jkl；
再缩小到 ghi 后保存 [12,15) / [28,31)，逻辑 ID 和页号保持。
另覆盖结束端位于显示空格、无法映射的源端点以及未挂载页面。

反例的具体排除条件为：

- 多栏：视觉选中左栏 LeftA、LeftB，源顺序在两者之间包含右栏可见 RIGHT，
  及其两边的空白。必须保留 [0,5) 和 [18,23) 两个片段，排除 RIGHT 的 [8,13)。
- 跨行：选中正文 Top、Bottom，源顺序夹着独立旁注 NOTE 和空白。
  必须保留 [0,3) 与 [14,20)，排除 NOTE 的 [6,10)。
- 跨页：只选 page-1 的 Tail 到 page-2 的 Head，明确排除 page-1 的 NO1 前缀
  [0,3) 和 page-2 的 NO2 后缀 [7,10)。保存端点必须是 page-1:6 到 page-2:4。

每条反例均检查未选中可见字符不被 canonical 区间覆盖、独立高亮 ID 不合并、
各端点和页号往返准确。前两条还逐片段检查同一 selectionGroup 的边界。
跨行或跨页本身不是禁止合并的理由；一条选区覆盖的可见内容与源顺序是否连续才是条件。

```sh
yarn test:run test/pdf-selection-offset-boundaries.test.ts test/text-highlight-adapter.test.ts test/pdf-text-content.test.tsx test/pdf-text-viewer.test.tsx test/pdf-text-selection-geometry.test.ts test/pdf-text-managed-controls.test.tsx test/pdf-text-handle-library.test.tsx test/intermediate-document-viewer.test.tsx
yarn typecheck
yarn build:lib
```

## 复审：只挂载跨页高亮的一端（2026-11-12）

3c45ee3 把缺少页面和当前页无法映射混为一谈：只挂载终点页时，
跨页编辑被转换为 [] 并从完整快照删除；另一条快路径则在起点离屏时
连终点也不转换，导致 source offset 不等于 DOM offset 的终点手柄消失。
现按 PdfTextSelectionControls 的既有固定端契约逐端转换，并为快照增加转换失败保护。
原 onRemoveRange 清理与多定位组的合并/排除条件保持。

`test/pdf-text-cross-page-edit.test.tsx` 用真实 Viewer 和受管手柄的 pointerdown/up，
分别验证非受控内部状态与吃快照的受控宿主：仅 page-2 挂载，page-1:0 固定不变；
普通 abcdefg 的终点 canonical 7 → DOM 7 → 拖至 DOM 6 → 保存 canonical 6；
abc def 的 anchors 0/14，终点 canonical 17 → DOM 7 → 拖至 DOM 6 → 保存 16。
断言完整快照、更新通知、页号、端点、文本、逻辑 ID、唯一终点手柄及没有删除通知。
另测失败转换保留原保存条目，及仅起点挂载时的对称转换。

```sh
yarn test:run test/pdf-text-cross-page-edit.test.tsx test/pdf-selection-offset-boundaries.test.ts
node scripts/check-pdf-text-cross-page.mjs
```

浏览器脚本与组件测试共享两页 IntermediateDocument 样本，使用真实 selection 依赖、
Chromium 命中测试和鼠标手柄拖动，在编辑提交后的所有完整快照中检查条目没有被删。
这验证的是分页 PDF Text 的生产组件路径，不依赖“两页同时挂载”的替代场景。
该定向浏览器用例不走 PDF 解析器；既有 WebBase 浏览器矩阵继续覆盖真实 PDF 导入。

## 验收边界：真实两页 PDF 从空选区新建（2026-11-12）

`two-page-positioned-runs.pdf` 包含两页、十组独立定位文字。
`PDF_CROSS_PAGE_CREATE=1 WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' node scripts/check-pdf-text-cross-page.mjs`
从真实 WebBase 导入、零标注开始拖选第一页最后一行，松手、调整两端后再尝试到第二页。
该项当前失败，不能以已有跨页高亮的四项编辑通过替代。

原因在选择入口：`getPdfVirtualItems` 只返回当前原页，Text 禁止边缘滚动/自动翻页，
`usePdfTextPagination.turn` 调用 `onTurn`，继而 `pdfClearDraftRef` 清空选区及草稿。
因此点击下一页后只有 page-2 挂载，手柄从 2 变成 0，持久化条目仍为 0；
在第二页再次拖选并确认只产生 page-2 的一条高亮。
脚本继续检查这条真实生成的单页高亮在 Layout、取消、重选后保留相同 ID，
最终仍以起点必须在 page-1 的断言失败，不把单页结果算作跨页创建成功。

当前 `pdfjs-web-reader` 的 Text 分页契约明确禁止正文滚动或自动翻页，原分页设计也
明确不跨原页拼接。支持新建跨原页范围需要确定续选交互；它不是上述 canonical
编辑修复已经支持的操作。本轮保留生产逻辑与 Spec，记录能力缺口，PR 继续 Draft。

## 构建身份与根因

WebBase 基线为 `aec5e60b22314129edb27314dbcf4b0a2b9a4519`。`webview/pnpm-lock.yaml` 与 frozen install 确认实际安装 reader 2.0.0、selection 0.3.0。npm 元数据中的 reader gitHead 为 `fce3193e132f6e288ae0df1e5856f420845afe22`，安装后的 `dist/index-2LyCXV-x.js` SHA256 为 `3416b009319e5ebe591fb91dec963f894c3f5be3caa3a2907c782d406ca2618d`。

该发布构建使用 PdfTextHandle 和 selection 库，每次 pointermove 发送范围更新；主线使用 PdfTextSelectionControls 和 EngineSelectionControls，复用单个预览并在释放时提交。两者都需要把视觉连续的 PDF 选区转换成多个源字符片段；片段 ID 包含源端点，调整时会改变。

WebBase 的 onUpdateRange 按 ID upsert，未接入 onLinkedDataChange 全量快照。原 reader 只发送当前片段的更新，没有通过 onRemoveRange 删除退出选区的成员。逆序样本扩大后有 16 个片段，缩到 6 个字符后仍保存 16 个；主线基线同样失败。普通 PDF 连续范围保持一个稳定 ID，没有触发这个问题。

修复在 handleLinkedUpdateRange 中比较旧分组与新片段 ID，通知宿主删除退出选区的片段，并让非受控状态完整替换该分组。保留原逻辑高亮 ID、其他高亮及既有完整快照接口；转换失败时不删除数据。不改 WebBase，也不更改 Spec。

## 在 WebBase 验证

准备相邻的 WebBase checkout，并在其根目录与 webview 目录运行 pnpm install --frozen-lockfile。从 reader 执行：

```sh
yarn build:lib
WEBBASE_DIR=../WebBase WEBBASE_PORT=6229 node scripts/serve-webbase-reader.mjs
```

该服务加载 WebBase 自己的 Vite 配置，只把 reader 包和样式别名到本 checkout 的构建，不修改宿主依赖或 pnpm store。另一终端运行：

```sh
WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' node scripts/check-webbase-pdf-reselection.mjs
```

脚本通过真实文件导入、原生 Selection、菜单、鼠标或 CDP 触摸事件操作宿主。监听真实 bridge 的文件写入，等到新的提交写入出现并经过 300ms 无写入窗口后检查保存内容；此静默窗口不是持久化队列已完全清空的严格证明。普通与逆序 PDF、鼠标与触摸、起点与终点手柄、三次重选，共 24 组，每组连续往返移动 25 次。

每次先创建第二个独立高亮，并在目标高亮创建和每轮调整后比较其完整保存对象（包括文本、页号、canonical 起止偏移）。目标范围的每个片段都按固定 PDF 绘制/源字符顺序独立计算预期页号和 canonical 起止偏移，不调用生产映射函数或从实际结果推导预期。终点调整为 16 → 6 → 1 个片段，起点调整为 14 → 6 → 1 个片段，覆盖多片段收缩为单片段；普通样本始终是单范围。另检查单个预览、取消选中时清空预览和手柄、原逻辑 ID、唯一片段 ID 和绘制数量。

样本每个字符唯一，比较前按字母显示顺序排列片段，避免宿主 upsert 的插入顺序影响逐片段端点比较。本回归不验证 selectionGroup.index 的正确性：WebBase 的 mergeRangeById 比较未包含该元数据，扩大起点时观察到旧 index 被保留。该宿主行为未在本次只补强测试的改动中修改。终点落在前一字符右边缘以排除重排文本插入的显示空格；包含这些空格的选区端点也不在本轮断言范围内。

生成的 normal.pdf、reordered.pdf、逐次写入、截图和报告在 test-results/webbase-reselection。人工导入 reordered.pdf，切换文字模式，在第三行标记 i 到 r；取消并重选后，把终点扩大到 x，再缩回 n，预期仅 i 到 n 保持高亮。

修复前主线与原 npm 构建均在缩小范围时失败；修复后 Chromium 148.0.7778.96：

```text
PASS: 24 WebBase PDF reselection/drag cases
```

## 其余回归与验证边界

```sh
node scripts/check-pdf-text-reselection.mjs
READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-release.mjs
yarn test:run test/pdf-text-viewer.test.tsx test/pdf-text-selection-geometry.test.ts test/pdf-text-managed-controls.test.tsx test/pdf-text-handle-library.test.tsx
yarn typecheck
```

分别为 24 组完整快照/非受控重选拖动、40 组释放/取消、14 项组件与几何单测以及类型检查。所有检查通过。

本次证明并修复了可重复的旧片段残留路径。报障人的原始 PDF、设备与浏览器仍未提供，尚不能认定覆盖所有“高亮大量叠加”表现。Linux WebKit 因缺少 libicudata.so.74 无法启动，Safari/WKWebView 未验证。触摸为 Chromium CDP 模拟。WebBase 原 lockfile 仍使用旧 npm 构建；主线修复合入并发布、宿主更新依赖后才能进入原应用，验证服务通过本地别名使用修复构建。
