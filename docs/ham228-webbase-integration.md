## 接入范围与版本门槛

HAM-228 的算法修复在 reader：PDF Layout 续读保存安全线的页内比例，模式互切独立采集当前安全视口的源字符。沿用既有 `ReaderData` 字段，不迁移存量数据。WebBase 实验性原生 PDF 的字符数比例互切不在本版范围，具体差异见 change 的 design。

下游必须在 reader 正式发布含修复的版本后，同时更新 WebBase 根目录与 `webview/package.json` 的 `@hamster-note/reader` 精确版本，以及各自的 `pnpm-lock.yaml`，执行 frozen-lockfile 安装并确认实际解析版本。当前 `2.0.0` 不包含本次未发布修复；正式版本接入和产品验证完成前，不得宣称 WebBase 产品已修复。本轮不发布依赖，不修改 WebBase。

另一个已核实的接入条件：当前 WebBase `ReaderEditorPane.tsx` 只传 `document` / `isPdf`，没有传 `engineSource`，走的是 document-only 的 `IntermediateDocumentViewer`，并非本次修复的 `PdfDocumentViewer`。因此正式版本升级本身不足以覆盖该入口：下游接入时必须确认 PDF loader 能向 Reader 提供稳定的原 PDF `engineSource`（原始字节及必要 worker 配置），并复用 reader 的引擎路径。接通前不得用本次 PDF.js 回归冒充 WebBase 实际产品已修复；本轮不在宿主复制算法，也不扩大为 document-only 渲染器重构。

## 宿主安全区契约

- `webview/src/window-content/reader/use-reader-contain-margins.ts` 读取壳层注入的安全区和 editorTop；同一区域重叠时取 `max(editorTop, safeAreaTop)`，不能累加。
- `ReaderEditorPane.tsx` 将结果传入 `containMarginTop`、`containMarginBottom`、`containMarginX`。这些参数表示 Reader 根容器内部的剩余遮挡；如果宿主已经把根容器移到安全区域，应传剩余量 0。
- 默认 Web/WebView 接线验证必须测量实际根容器和 PDF 滚动容器边界，分别注入 0 / 80 CSS px 遮挡，再验证外层已预留 80px 的布局。顶部安全线应分别为 root.top、root.top + 80、预留后的 root.top；不能二次扣除。

浏览器在挂载前或通过 `page.evaluate` 设置 `document.documentElement.style`：`--app-safe-area-top: 80px`、`--app-editor-top-inset: 80px`，以及 `--app-safe-area-bottom/left/right`。该 hook 用 MutationObserver 观察根元素 `style` 属性，因此动态修改这些变量会触发更新，无需自造事件。验证两个 80px 重叠变量只得到 top=80。外层已预留场景须将剩余重叠变量归零，再测量实际安全线；不要在宿主实现另一套 PDF 定位算法。

## 持久化与往返验收

检查 `use-reading-position.ts` 和 `sidecar-storage.ts` 的原有保存队列及文档 `reading_position` 往返：

1. 有字 PDF 同页分别停在 35% / 65%，立即关闭并重开，记录原页号及 `verticalPercentage`；不含文字 offset，不吸附到下一文字行。
2. 页面几何已就绪、文字层仍 pending 时允许保存比例；模式互切则保留当前模式，不能用几何或目标旧位置代替尚未就绪的首行。
3. 顶部遮挡行 X 不参与互切，当前可见 A 进入 Text，翻页后的首行 B 返回 Layout 对齐安全线。Text 保持按钮分页，正文滚动量为 0。无字页 60% 往返保持原页比例。
4. 旧 Layout 文字进度和 `virtualPaper.anchor` 继续读取；重开无操作不回写，主动滚动后再保存比例。文字书签和高亮仍按源字符导航。
5. 等待保存时新增高亮/绘图，然后立即关闭；最新进度、标注、另一模式进度和未知字段均保留。连续切书、切模式时旧回调不能串写。
6. 在 320px / 宽屏和 50% / 100% / 200% 缩放下核对裁切、旋转、页间隙、隐藏/范围外页、页面回收和末页夹取。保存比例按当前显示页框解释；可达目标对齐误差 ≤ 2 CSS px，末页按合法滚动上限比较。

## 下游验证命令

在 WebBase 根目录按其 Web-only 约定执行并记录结果：

```sh
pnpm install --frozen-lockfile
pnpm --dir webview install --frozen-lockfile
pnpm typecheck
pnpm test:run
pnpm build:web
pnpm test:e2e:web
```

E2E 除既有套件外应覆盖上述浏览器 safe area 注入和 sidecar 往返。reader 自身使用 `node scripts/check-reading-progress.mjs` 生成真实 Chromium 几何记录；它验证 reader 坐标，不能替代 WebBase 壳层接线验证。

验收只采用 Web 可执行手段，不以原生构建、Maestro、模拟器或真机作为本轮开发完成判据。下游不复制算法，不修改 node_modules，不新增 reader 依赖 patch，也不使用运行时 monkey patch。
