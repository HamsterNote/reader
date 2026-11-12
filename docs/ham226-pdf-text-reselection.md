# HAM-226：清理 PDF 文字高亮调整后的旧片段

在 WebBase 的实际 ReaderEditorPane、受控 ranges 和侧车持久化路径上复现：源字符顺序与显示顺序相反的 PDF，创建高亮、取消选中、重新选中，再扩大与缩小范围后，旧片段仍留在宿主中。主线受管手柄修复了拖动时的预览生命周期，但没有解决只使用逐范围回调的宿主里的片段清理。

## 新选区入口仍待复现（2026-11-12）

报障人确认“已有高亮重选后拖动”已正常，但报告“新选中文字 → 拖动手柄 → 点击高亮”仍会出现多余高亮，PR 暂不合并。本轮新增检查脚本，没有修改生产逻辑，也没有把检查通过视为新入口已修复。

```sh
WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' WEBBASE_TEST_OUTPUT=test-results/webbase-draft-touch-confirm node scripts/check-webbase-pdf-draft.mjs
REORDERED=1 WEBBASE_BROWSER_URL='http://127.0.0.1:6229/?demo=1' WEBBASE_TEST_OUTPUT=test-results/webbase-draft-reordered-touch-confirm node scripts/check-webbase-pdf-draft.mjs
```

在修复构建上，普通 PDF 和逆序字符 PDF 各 4 组均通过（Chromium 148.0.7778.96）。每组分别以起点或终点开始调整，两端各拖动 3 次，每次往返移动 25 次，包含扩大与缩小。逐帧、逐次释放检查草稿未持久化中间范围、只有一个预览和一对手柄；点击“高亮”后检查只保存最终一条、准确文本及页号/canonical 端点；取消并重选后检查没有新增条目和额外绘制节点。逆序 PDF 最终缩为一个字符，因此预期一条物理片段，而非错误地要求任意不连续源范围都只存一条。

普通样本最终文本为 mnopqrstuv，page-1 的 canonical [34,44)；逆序样本最终为 m，canonical [35,36)。原生初始选择通过鼠标建立，触摸拖动使用 Chromium CDP，确认/取消/重选使用触摸 tap；不覆盖 OS 长按建立选区。源字符顺序、PDF 文件和浏览器实现仍是未覆盖的变量，需要原始复现 PDF、设备/浏览器以及准确点击目标来继续定位。当前证据没有证明“草稿逐帧累积”或 WebBase 提交逻辑有缺陷。

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
