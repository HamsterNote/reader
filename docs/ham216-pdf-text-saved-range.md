# HAM-216：PDF 纯文字已有高亮端点同步

已有高亮的受管手柄只调用 `onUpdateRange`，没有像选择依赖库一样同时发布 `onLinkedDataChange`。以完整 linked-data 快照为状态来源的受控宿主因此仍保存旧端点；拖动的临时预览看似正常，点空白关闭预览、再次点选后，手柄和保存的高亮就回到旧范围。

浏览器回归在修复前实际捕获：第一行起点从 8 拖到 3，单条更新通知报告 3，宿主完整快照仍为 8；取消选中再点选时，手柄位置断言失败。原 20 组脚本只验证单条更新通知，并且直接拖动确认后仍然选中的手柄，未覆盖完整快照宿主和重新点选。

修复在 PDF Text 的受管保存入口同时发布完整快照与一次更新通知。快照转换明确指定本次编辑的 ID，将其新 DOM 端点转换为源 PDF 坐标和几何；其他标注继续复用原始存储范围。取消拖动不提交。

另外修正同一触摸点击被处理两次的问题：PDF Text 在 pointerup 已完成命中与选中后，仅对这次点击的后续 click 标记 preventDefault，避免选择依赖库再次切换选中态。下一次 pointerdown 或取消会重置记录；按钮、菜单、拖动、鼠标点击及其他格式的入口保留。

## 回归

`scripts/check-pdf-text-release.mjs` 覆盖两种宿主：非受控，以及仅靠完整 linked-data 快照更新范围的受控宿主。两行、起终点、草稿/已有高亮、释放/取消及草稿拖动中确认，共 40 组。已有高亮先点空白再点选，拖动后再次点空白、点选，并检查：

- 完整快照与更新通知的端点、文本一致；每次有效拖动只发出一次更新通知。
- 点空白后没有手柄和受管预览，仅有保存的高亮，其矩形与预期文字范围相差小于 1 CSS px。
- 重新点选后两柄分别位于准确字符边界和文字行，相差小于 1 CSS px（0 行、0 字符偏移）。
- ID、创建时间、markerStyle、selectionStyle 保持不变；换工具颜色与宿主重渲染不回退范围。
- 草稿仍可通过唯一可见的“高亮”按钮确认，取消保持原范围。

初始 Selection 和拖动是合成事件；确认、取消选中、重新点选均通过浏览器 trusted tap 操作。输出在 `test-results/pdf-text-release/chromium.json`、`webkit.json`（兼容保留 `report.json`）。

```sh
READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-release.mjs
node scripts/check-pdf-text-release.mjs
```

本次本地结果：Chromium 148.0.7778.96 与 Linux WebKit 26.4 各 40 组通过；三面共享 Chromium touch/mouse/pen 矩阵 36 组通过。`yarn typecheck`、`yarn lint`、`yarn build:all`、改动文件格式检查均通过。全量单测为 128 文件、1,752 项，1,751 项通过，demo OCR 用例在 15 秒限制下超时；随后完整复跑 `test/demo.test.tsx`，119 项全部通过（18.99 秒），未修改该用例或超时设置。

Linux WebKit 如缺少运行库，可通过 `WEBKIT_EXECUTABLE_PATH` 指定兼容的 Playwright MiniBrowser 包装脚本。本机 iOS 工具调用报 `spawn xcrun ENOENT`，因此 iOS 模拟器、WKWebView 和真机长按/原生拖动仍需设备复验，不能用浏览器合成拖动结果代替。

设备复验步骤：PDF 文字模式高亮 → 点空白 → 点该高亮 → 分别拖起点/终点并松手 → 点空白 → 再点同一高亮；检查只保留调整后的高亮、无残留手柄、再次点选端点准确。补验缩短范围、跨行和再次拖动，以及草稿确认/取消。放大镜尺寸和放置策略属于 HAM-217，本次未调整。
