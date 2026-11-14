# 原生 PDF 绘图（S07）实现与风险

原生 PDF 阅读器的矩形与自由绘图入口，接的是既有 4.x 标注/绘图控制层，没有另造业务模型。

## 协议

| 方向        | 消息                                                       | 说明                                      |
| ----------- | ---------------------------------------------------------- | ----------------------------------------- |
| 宿主 → 原生 | `tool` `{ tool: 'none' \| 'rectangle' \| 'draw' }`         | 切换手势模式；`none` 保持只读导航         |
| 宿主 → 原生 | `inkStyle` `{ color, width }`                              | 原生落笔预览的笔刷，颜色为 `#rrggbb`      |
| 宿主 → 原生 | `annotations` `{ ranges, rects? }`                         | 高亮与矩形；`rects` 缺省时保留当前矩形    |
| 宿主 → 原生 | `ink` `{ objects }`                                        | 全部绘图对象（折线），全量替换原生渲染    |
| 原生 → 宿主 | `rect` `{ pageNumber, rect, phase, geometryRevision }`     | 矩形手势，`preview` / `commit` / `cancel` |
| 原生 → 宿主 | `stroke` `{ pageNumber, points, phase, geometryRevision }` | 一笔自由笔迹，只在 `commit` 带点          |

## 坐标契约

- 矩形与笔迹点全部是**页内 scale-one 像素**（旋转后的可视页，原点左上，y 向下），与 `overlayRectType: 'px'` 同一契约。
- 原生落笔用 `ReaderPdfViewport.contentPoint(at:)`（`scrollPoint` 的逆）从视口坐标反算内容坐标，再减去页面 `frame.origin`；不另写 `* zoomScale`。
- 渲染图层挂在会被缩放的 `content` 容器里，按页面 `slot` 裁切，因此滚动、缩放、裁切都不改样本坐标。
- 宿主侧 `src/nativePdf/strokes.ts` 把 schema3 对象拍平成折线：freehand 用持久化样本，line/rect/ellipse/bezier 走画库 `deriveShapeGeometry` 派生的命令（椭圆 48 段、二次贝塞尔 16 段），再套对象 `transform`。

## 持久化

- 只在既有 V5 `annotations` 容器上 patch `ranges` / `rects` / `paintings`，`readerData`、评论与未知字段原样保留（`withNativeAnnotationData`）。
- 写入走 `NativePdfReader` 的 `persist(transform)` → `ReaderDataStore.updateSnapshot`，在单文件队列里读最新权威快照后再 patch。
- 新笔迹通过 `appendStrokeDocument` 追加到该页的 schema3 文档，落笔前交画库 `readLayeredDocument` 校验；颜色与线宽写进 `brushSnapshot`，形状沿用对象自带的 `style`。
- 撤销/重做/清空本页全部走 `createNativeAnnotationController` 的 `undo()` / `redo()` / `clearPainting()`，一笔一个历史项。

## 已知限制

- 原生只渲染 `freehand` 与 `shape`（line/rect/ellipse/polygon/bezier 折线近似）；`image` 对象不画。
- 形状只描边，不还原 `fill` / `fillOpacity` / dash 与 `opacity` 以外的高级样式。
- 笔迹与形状都按折线渲染，曲线在放大后有轻微折线感（椭圆 48 段、贝塞尔 16 段）。

## 性能风险（S14 口径）

`updateVisible()` 每次滚动/缩放都会 `updateStrokes()` 重建全部笔迹图层与路径，与现有 `updateRects()` / `updateAnnotations()` 的做法一致。一笔 50 点、一页几十笔时，滚动每帧的路径重建开销会变成可见成本。

本轮现场观测点：每次 `updateVisible()` 完成页面可见性更新后都会进入同一轮 `updateStrokes()`；因此一次滚动/缩放几何更新至少对应一次全量绘图对象遍历和路径重建。当前没有采集到稳定的帧耗时或掉帧百分比，S14 验收仍需在真机按 60 秒滚动记录调用次数、对象数、平均/P95 帧耗时和掉帧数，避免把定性观察误报成性能指标。

优化方向（本轮未做）：按 `strokes` 版本 + 页面 frame 版本缓存图层，只在对象集合或布局变化时重建；或对不可见页跳过 `updateStrokes`。验收时按 S14 的「60 秒滚动渲染次数/掉帧」指标观察。
