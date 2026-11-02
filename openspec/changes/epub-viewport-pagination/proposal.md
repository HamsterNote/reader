# Proposal

## Why

HAM-129 要求 EPUB 从连续滚动改为逐个可视页阅读。当前 `reader` 的入口强制 `flow: 'scrolled'`，滚轮和触摸在章节边界还会触发切节，无法满足按钮逐页阅读。

## What Changes

- EPUB 根据正文实际可用宽度及高度重排为单个可视页；上一页/下一页移动一个可视页，同一长章节必须可连续翻多页，到章节边界才进入相邻可读章节。
- 底部右下角增加右对齐的两个翻页按钮，沿用现有底栏的边距、主题与控件风格；为工具栏和按钮留出正文空间，首末页禁用相应按钮。
- EPUB 正文禁止滚轮、触摸滑动、键盘滚动或选区越界产生滚动/自动翻页。顺序阅读仅通过按钮；目录、书签、高亮跳转和恢复仍可定位到目标所在可视页。
- 每次成功翻页以既有逻辑页及字符偏移保存进度，尺寸/字体变化后重新分页并显示包含原锚点的可视页。
- PDF、其他格式及 `native-reader` 独立组件不在本次范围。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `epub-web-reader`: 明确可视分页、仅按钮顺序翻页、底部按钮布局及重排续读行为。

## Impact

- 已 checkout 两仓库并核实：目标为 `HamsterNote/reader`（包名 `@hamster-note/reader`），不是 `native-reader`（独立包 `@hamster-note/native-reader`）。后者已有独立阅读组件和规格，本次不修改。
- `src/epub/foliateEpubEngine.ts`：分页适配、相邻可视页操作、边界状态、输入限制与锚点；`src/epub/epubCompatIndex.ts` 复用旧位置映射。
- `src/components/EngineDocumentViewer.tsx`：当前滚动入口、进度发布和恢复、EPUB 按钮与正文视口接线；`src/styles/engine-viewer.scss`：正文可用空间及输入约束。
- `src/components/Reader/DefaultBottomBar.tsx`、`src/components/Reader/DefaultBottomBarControls.tsx`、`src/styles/reader.scss`：参考现有底栏风格、底边距及堆叠布局，按需要接入测量/布局，避免覆盖正文。
- `vendor/foliate-js/paginator.js` 及其 `.d.ts`：已有 next/prev、重排和触摸处理；优先适配层控制，若必须禁用内置手势/选区自动翻页则用最小开关并记录 vendored 差异。
- 验证位置：`test/epub/engine-session.test.ts`、`test/epub/fakeView.ts`、`test/reading-progress.test.tsx`、`scripts/check-reader-browser.mjs`；宿主链路参考 `webview/src/ReaderSurface.tsx`、`app/src/screens/ReaderScreen.tsx`、`src/host/readerDataStore.ts`。
- 不新增依赖，不以可视页号替换旧逻辑页 ID，不把 CFI 写入既有公开数据或回调。不更改 `reader-data-compatibility` 的既有契约。
