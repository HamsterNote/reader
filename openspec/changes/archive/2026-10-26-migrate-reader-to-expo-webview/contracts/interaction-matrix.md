# 交互矩阵契约（任务 1.2）

基线：`237c0d51a4fc76d8c6f233bd2598ac7a14d12500`。本矩阵固定格式 × 模式 ×
工具的交互契约，后续 EPUB/PDF/Expo 三条主线 MUST 保持每项的 UI、回调与存储
断言不变；标注「不适用」的项不得为兼容而新增实现。

- 模式：`layout` / `text`（`ReaderRenderMode`，`src/types/readerOptions.ts:1`）。
- 工具：`text-selection` / `rect-selection` / `drawing`
  （`ReaderPageTool`，`src/types/readerOptions.ts:3`）。
- 统一数据通道：`data: ReaderData` + `onDataChange(nextData)`
  （`Reader.tsx:170-172`）；`data` 字段优先于同名扁平 props
  （`src/types/readerData.ts:58-62`，断言 reader.test.tsx:2674-2716）。
- 存储键前缀（demo 宿主）：高亮 `hamster-reader-demo:highlights:{fileName}`、
  书签 `hamster-reader-demo:bookmarks:{fileName}`、进度
  `…:text-reading-progress:{fileName}` / `…:layout-reading-progress:{fileName}`
  （demo/App.tsx:294-299,446-468）。Expo 宿主 MUST 保存相同 JSON 内容与文件归属，
  存储介质可替换（design.md 决策 2）。

## 1. 高亮（text-selection）

- 模式：Layout + Text 均适用。EPUB/Text 的 `rectsBySelectionId` 可为空，按字符
  锚点实时计算（`src/types/selection.ts:31-39`）；EPUB Layout 矩形只实时计算、
  不写入持久化。
- UI：原生 `Selection` 绘画 + `selectionColor` 着色；鼠标圆形端点手柄、触摸用
  原生手柄；激活已持久高亮时临时隐藏 overlay 并物化原生选区；选中态矩形无描边；
  放大镜 `showSelectionMagnifier` 默认开（DESIGN.md §8/§9）。
- 回调：`onHighlight(range)`、`onSelect`/`onSelectRange(id|null)`、
  `onUpdateRange(range)`、`onRemoveRange(id)`、`onHighlightColorChange(color)`、
  `onCommentHighlight(highlight) => Promise<range>`；ref：
  `highlight()/confirm()/clear()/scrollToRange(id)`（`src/types/selection.ts` 的
  `ReaderSelectionRef`）。
- 存储：`ranges: ReaderSelectionRange[]`，字段
  `id/text/start/end/createdAt/overlayRectType?/rectsBySelectionId/markerStyle?/selectionStyle?`；
  端点 `selectionId` 必须是 `page-N`（`/^page-[1-9]\d*$/`，见
  `demo/highlightStorage.ts:34`），运行时 scoped ID 不得持久化
  （`src/types/selection.ts:14-21`）。
- 断言：新建高亮只产生一个 history checkpoint（source `'highlight'`），
  `onSelect`/`onHighlight` 各 1 次（reader.test.tsx:3844-3890）；range 自带
  `markerStyle.backgroundColor` 优先于全局 `highlightColor`
  （reader.test.tsx:3152-3192）；`scrollToRange` 平移但不改受控 scale
  （reader.test.tsx:2899-2907）；Text 模式实时重算矩形且不回写持久化矩形
  （text-highlight-adapter.test.ts:93-151）。
- 基线缺口（保持现状，不新增断言）：`onRemoveRange` 仅有 demo 透传覆盖
  （demo.test.tsx:195,427）。

## 2. 矩形框选（rect-selection）

- 模式：仅 Layout；Text 模式不转发 rect props（reader.test.tsx:1296,1349-1355）。
- UI：手柄沿用依赖的圆形渲染与拖拽（DESIGN.md §8 末条）。
- 回调：`onCreateRect(rect)`、`onSelectRect(id|null)`、`onUpdateRect(rect)`、
  `onRemoveRect(id)`；ref：`confirmRect()/scrollToRect(id)`。
- 存储：`rects: ReaderSelectionRectangle[]`（v3 起），字段
  `id/createdAt/overlayRectType('px'|'percent' 必填)/start/end/rect/selectionId?/markerStyle?/selectionStyle?`。
- 断言：`confirmRect()` 后 `onCreateRect` 收到公共 `page-N` ID
  （reader.test.tsx:3016-3064）；`onUpdateRect` 保留并更新 `markerStyle`
  （reader.test.tsx:3249-3252）；history source `'create-rect'/'update-rect'`
  （reader.test.tsx:3668-3675,3784-3811）；非受控矩形 redo 不支持、返回 `false`
  （reader.test.tsx:4101-4125）。
- 不适用：Text / EPUB Text。

## 3. 绘图（drawing / pagePaintings）

- 模式：仅 Layout；Text 不转发绘图 props（reader.test.tsx:1359-1363,1406-1412）。
- UI：底栏色板 Layout 同时更新绘图色与高亮色（DESIGN.md §14）；第二指加入取消
  当前笔划（page-drawing-layer.test.tsx:61-167）。
- 回调：`onPagePaintingChange(pageId, nextValue, nextPaintings)`、
  `onPagePaintingsChange(nextPaintings)`、`onDrawingStrokeColorChange`、
  `paintingTool`/`onPaintingToolChange`。
- 存储：`pagePaintings: Record<'page-N', DrawingValue>`，v4 新增 `paintings`
  字段；demo 只过滤明显损坏条目，深度校验交 `sanitizeDrawingValue`
  （`demo/highlightStorage.ts:48-53`；截断规则：500 笔划、dashArray 32 项，
  reader.test.tsx:1015-1076）。
- 断言：绘图**不进 annotation history**（不触发 `onAnnotationHistoryChange`，
  reader.test.tsx:3893-3958），需独立持久化（demo/App.tsx:1356-1360 注释）。
- 不适用：Text。

## 4. 评论（comments）

- 模式：与高亮/矩形绑定；`onCommentRect` 因矩形仅 Layout 而仅 Layout。
- UI：demo 侧栏 CommentPanel + 高亮/矩形 popover 内评论入口
  （DefaultPopover/DefaultRectanglePopover）。
- 回调：`comments`（受控，库不修改）、`onCommentsChange(next, detail)`；
  `onCommentHighlight/onCommentRect` 返回 Promise，resolve 后关 popover 且
  `onSelectRange(null)`（reader.test.tsx:3330-3338）。
- 存储：`CommentStorageV2 { version: 2, comments }`
  （`demo/commentStorage.ts:3-8`）；`ReaderComment` 字段
  `id/highlightIds/content/createdAt/updatedAt?/parentId`；legacy v1
  （highlightId→数组/字符串）迁移为根评论并补 `id/createdAt`；
  `removeHighlightFromComments` 对 highlightIds 清零的评论连同回复子树级联删除。
- 断言：v2 往返无损（commentStorage.test.ts:39-43）；legacy v1 迁移
  （:46-92）；重复 id 拒绝返回 `[]`（:110-128）；孤儿回复回退为根、父环断裂、
  3000 条循环不爆栈（comments.test.ts:84-241）。

## 5. 历史（annotation history）

- 模式：undo/redo 命令仅 Layout；快照结构（ranges/rects/选中态）与模式无关。
- UI：底栏 Undo/Redo 常驻紧凑图标按钮，不可用时禁用（DESIGN.md §14）。
- 回调：`annotationHistory?: boolean | { enabled?, resetKey? }`、
  `onAnnotationHistoryChange(next, detail)`；ref：
  `undo()/redo(): boolean`、`canUndo()/canRedo()`。
- 存储：历史本身不持久化；demo 从快照回写 ranges/rects/选中态并 persist，
  `source==='reset'` 不持久化（demo/App.tsx:1128-1160）。
- 断言：`ReaderAnnotationHistoryChangeSource` 十值枚举固定
  （`src/types/selection.ts:72-82`，types.test.ts:307-318）；结构相等不建检查点；
  undo 期间 `onCreateRect/onUpdateRect/onSelect/onUpdateRange` 不重放
  （reader.test.tsx:3684-3687）；resetKey 变化触发 `source:'reset'`。
- 基线缺口：无 maxDepth/截断断言。

## 6. 书签（bookmarks）

- 模式：Layout + Text 均适用。
- UI：Page Browser tabs——Layout 组 `页面/高亮/书签`，Text 仅 `高亮/书签`；
  精确书签捕获跨越容器顶边的文字，恢复 textId 优先、offset 兜底；空态
  `暂无书签`（DESIGN.md §7）。
- 回调：`bookmarks` + `onToggleBookmark(bookmark)`；deprecated
  `bookmarkedPageNumbers`/`onTogglePageBookmark` 仅保留页码书签能力。
- 存储：`ReaderData.bookmarks: readonly ReaderBookmark[]`；
  `ReaderTextAnchor { pageNumber, textId, text, offset }`（offset 为页内字符
  偏移，`src/types/readerData.ts:24-30`）或
  `ReaderPagePositionBookmark { pageNumber, verticalPercentage: 0..100 }`；
  demo 去重 key `'{pageNumber}:{textId}:{offset}'` /
  `'page:{pageNumber}:{verticalPercentage}'`（demo/App.tsx:368-372）。
- 断言：textId 失效后按页内 offset 兜底（text-anchor.test.ts:113-177）；
  无文字页 `{pageNumber, verticalPercentage}` 原样持久化
  （reader.test.tsx:2129-2153）；重复 toggle 移除且保留 `hiddenPages`
  （reader.test.tsx:2094-2127）。
- 不适用：无（EPUB 重排后 offset 语义不变，见 sample-manifest.md 坐标系约定）。

## 7. 阅读进度（progress / virtualPaper）

- 模式：Layout 与 Text 各持有独立进度 rail；缩略图预览仅 PDF Layout；
  `virtualPaper` 仅 VirtualPaper Layout；`layoutReadingProgress` 仅原生 Layout
  缩放模式。
- UI：rail 在模式容器右缘、VirtualPaper 之外；首个 scroll 立即显示页码，500ms
  空闲隐藏；Pointer Events + capture，pointer up 才 commit，cancel 不导航；触摸
  拖拽时 label/缩略图左移 1cm；ARIA vertical slider + 页值元数据
  （DESIGN.md §13）。
- 回调：经 `data`/`onDataChange` 往返；viewer 层
  `onLayoutReadingProgressChange` 携带 `{pageNumber, textId, text, offset}`。
- 存储：`ReaderData.layoutReadingProgress?: ReaderBookmark`、
  `textReadingProgress?: { currentPageNumber, anchor? }`、
  `virtualPaper?: { x, y, scale, anchor? }`；demo 持久化进度到 localStorage，
  `virtualPaper` 仅内存（demo/App.tsx:1063-1085）。
- 断言：commit-on-up、pointercancel 不跳页（reading-progress.test.tsx:20-105）；
  textId 优先 offset 兜底（同书签）；高亮刻度用 range 自带
  `markerStyle.backgroundColor`（reading-progress.test.tsx）。
- 基线缺口：触摸 1cm 偏移仅样式（reader.scss:1394-1396），无测试断言数值。

## 8. 裁切（edgeCrop）

- 模式：仅 Layout；进入 Text 模式强制退出裁切编辑（DESIGN.md §14，
  demo.test.tsx:1776-1781）。
- UI：裁切编辑中隐藏页保留原位虚线占位 `当前 第 x 页 已隐藏`；激活态按钮
  `aria-pressed=true`（DESIGN.md §14）。
- 回调：`edgeCropEditing` + `onEdgeCropEditingChange`；
  `onEdgeCropApply(pageNumber|null, crop)`（null=所有页）；viewer 层
  `onEdgeCropHidePage(pageNumber)`，隐藏页经 `onDataChange` 追加
  （Reader.tsx:1197-1213）。
- 存储：`ReaderData.edgeCrop`：`ReaderEdgeCrop { top?, right?, bottom?, left? }`
  各 0..1；`ReaderPageEdgeCrop { all?, pages?: Record<'page-N', ReaderEdgeCrop> }`，
  页级覆盖全局、不叠加（`src/types/readerData.ts:10-21`）。demo 仅内存 state，
  不落 localStorage。
- 断言：对边钳制（top 0.9 → bottom ≤ 0.09，edge-crop-overlay.test.tsx:159-191）；
  页级覆盖 all（:52-76）；拖拽中受控草稿不让位、pointerUp 后让位
  （edge-crop-overlay-controlled.test.tsx:23-66）。
- 不适用：Text。基线缺口：Reader 级 `onEdgeCropHidePage` 传递链无直接断言。

## 9. 隐藏页（hiddenPages）

- 模式：Layout 与 Text 阅读均省略隐藏页；虚线占位仅 Layout 裁切编辑态。
- UI：见第 8 项占位契约（DESIGN.md §14）。
- 回调：无专用回调，经 `onDataChange({ ...data, hiddenPages })` 更新；元素形态
  同时接受数字与 `'page-N'`（Reader.tsx:1197-1213 去重判断两种形态）。
- 存储：`ReaderData.hiddenPages?: readonly (number | string)[]`；demo 仅内存。
- 断言：裁切 overlay 隐藏当前页只追加（reader.test.tsx:738-755）；进度 debounce
  flush 合入 `hiddenPages`（reader.test.tsx:1543-1591）；隐藏页不渲染页内容
  （intermediate-document-viewer.test.tsx:1064-1084）。

## 10. 拖拽（onDragHighlight / multi-drag）

- 模式：`onDragHighlight` 在 Layout 与 Text 均转发
  （reader.test.tsx:1330-1331,1372-1373）；画布平移暂停为 Layout/VirtualPaper
  相关。
- UI：demo 预览卡 `.hamster-demo-highlight-drag-preview`（fixed、偏移指针 14px、
  `translate3d`、单行截断兜底 `高亮内容`、忽略指针、up/cancel 消失）；候选阶段
  保留原生选择，激活后暂停；触摸长按成功还暂停画布平移（DESIGN.md §11/§13）。
- 回调：`onDragHighlight(highlight)`——每次手势仅触发一次，携带原始公开 range
  （text-highlight-drag.test.tsx:80,154-155）。
- 存储：无（纯手势）。
- 断言：位移阈值 `HIGHLIGHT_DRAG_MOVE_TOLERANCE = 4`、触摸长按
  `HIGHLIGHT_TOUCH_LONG_PRESS_MS = 500`（useHighlightDrag.ts:37-38）；仅主指针、
  鼠标限左键；第二指加入取消长按（text-highlight-drag.test.tsx:228,287-294）；
  手势路由：default 模式 mouse/pen 在文本上可起选、touch 否，stylus 仅 pen
  （gesture-routing.test.ts:21-166）。

## 跨项不变量

1. 公开数据里只允许稳定 `page-N` ID；引擎专有定位（CFI、DOM ID、PDF 文本项
   索引）不得进入 `ReaderData`、回调 payload 或持久化 JSON。
2. 重排/缩放/字体变化只改显示几何，不改持久化端点、标注 ID 或评论关联
   （design.md 决策 3/4；spec reader-data-compatibility）。
3. `onDataChange` 是宿主持久化的唯一入口；demo 键前缀见文首，Expo 宿主按文件
   保存相同 JSON。
