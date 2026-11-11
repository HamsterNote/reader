# HAM-226：清理 PDF 文字高亮调整后的旧片段

在 WebBase 的实际 ReaderEditorPane、受控 ranges 和侧车持久化路径上复现：源字符顺序与显示顺序相反的 PDF，创建高亮、取消选中、重新选中，再扩大与缩小范围后，旧片段仍留在宿主中。主线受管手柄修复了拖动时的预览生命周期，但没有解决只使用逐范围回调的宿主里的片段清理。

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

脚本通过真实文件导入、原生 Selection、菜单、鼠标或 CDP 触摸事件操作宿主。监听真实 bridge 的文件写入，等待侧车异步队列结束后检查保存内容。普通与逆序 PDF、鼠标与触摸、三次重选，共 12 组，每组连续往返移动 25 次。检查单个预览、取消选中时清空预览和手柄、释放后原 ID、唯一片段 ID、准确文本和绘制数量。

生成的 normal.pdf、reordered.pdf、逐次写入、截图和报告在 test-results/webbase-reselection。人工导入 reordered.pdf，切换文字模式，在第三行标记 i 到 r；取消并重选后，把终点扩大到 x，再缩回 n，预期仅 i 到 n 保持高亮。

修复前主线与原 npm 构建均在缩小范围时失败；修复后 Chromium 148.0.7778.96：

```text
{"reordered":true,"input":"mouse","cycle":1,"expected":6,"actual":6,"text":"ijklmn","maxPreviews":1,"uniqueIds":6}
PASS: 12 WebBase PDF reselection/drag cases
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
