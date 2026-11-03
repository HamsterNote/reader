# Tasks

## 1. 共享阅读外壳

- [x] 1.1 从 `EngineDocumentViewer.tsx` 提取内部 `ViewportPaginationControls` 和导航状态类型，保留 EPUB 适配器及公开 API；扩展 `test/epub-pagination-controls.test.tsx`，验证名称、焦点、点击/Enter/Space、ready/busy/首末边界以及非目标格式不可见。
- [x] 1.2 将 `src/epub/buttonOnlyInput.ts` 移到内部 reading 模块并更新 EPUB 调用，保留 iframe 生命周期接线；验证正文滚轮/键盘限制、输入控件与按钮豁免、卸载后监听移除，既有 EPUB 引擎测试通过。
- [x] 1.3 提取共享正文矩形测量并接入 Reader 现有 bottomBarInset、按钮与工具面板，调整局部样式；真实浏览器验证 EPUB 宽屏/320px/横竖屏/绘图展开不重叠、不遮末行，正文与标注叠层一致且未重复扣减空间。

## 2. PDF Text 分页适配

- [x] 2.1 在 `pdf/pdfTextPagination.ts` 建立原页/临时列/稳定锚点及串行导航状态，接入 Text viewer 的 PDF 分支，非 PDF 保留虚拟滚动；单元测试覆盖前后原页、隐藏页/pageRange、全书端点、全隐藏空范围、快速连点及失败后恢复。
- [x] 2.2 复用 TextPageContent/PdfTextContent 对活动原页建立单栏可视窗口的 DOM 分栏，以实际文字片段识别非空列；新增真实浏览器用例验证单原页至少三屏、同页连续翻/回翻、源 span 跨列、原页前后边界无丢字/重复/空白尾页，保存截图与原页/字符锚点证据。
- [x] 2.3 复用 `useLazyPageQueue` 及现有 maxLoadedPages 限额加载目标与邻页，不预提取全册正文；测试统计 getTextContent 调用与缓存释放，验证大 PDF 跳页、无文本原页单屏状态/返回 Layout、整册扫描页和提取失败可重试，不把空页当加载失败。

## 3. 交互与文本映射兼容

- [x] 3.1 PDF Text 接入共享按钮、正文矩形和输入限制，仅在目标模式启用；组件及浏览器验证底部双按钮、busy/边界、宽窄屏避让、正文及空白输入不滚动、侧栏独立滚动、按钮键盘激活和输入编辑正常。
- [x] 3.2 以可视窗口内 Range 片段捕获锚点、裁切高亮及命中几何，保留 textId/source offsets 和 pdfSelectionOffsets；扩展 `test/pdf-text-content.test.tsx`、`test/pdf-viewer/pdf-text-mapping.test.ts`、兼容 fixture 测试，验证重复字形 ID、连字、展示补空格、跨列 span 及旋转/两栏源页不新增端点漂移，历史 v2/v3/v4 保存仍为兼容 v4。
- [x] 3.3 接通既有目录/页码/书签/高亮/selectionRef 显式定位：原页到首列、字符到包含目标列，翻页清理未提交 DOM 选区；浏览器验证选择、高亮新增/激活/调整/删除、关联评论及既存跨页高亮恢复，页边拖选不自动翻页且不可命中离屏片段。

## 4. 进度、重排与会话隔离

- [x] 4.1 成功翻页后沿用 Text 进度回调保存原页及字符锚点，导航失败不发布，保持 Reader 原有 Layout/Text 桥接；扩展 `test/reading-progress.test.tsx` 验证同一原页连翻两次 offset 更新、关闭重开恢复中途、模式往返定位及无文本页原页回退，公开数据不含临时列号。
- [x] 4.2 对尺寸/字号/字体就绪/底栏变化冻结最后成功锚点，重排恢复后再发布并刷新边界；浏览器验证宽窄切换、横竖屏、连续 resize、临时零尺寸和面板展开仍包含原锚点，继续翻页使用新边界，旧进度不被首屏覆盖。
- [x] 4.3 将 PDF 分页异步结果纳入 Text viewer 的请求 token/documentGeneration，清理观察器、事件及待执行帧；受控延迟测试覆盖 A→B、Text→Layout、卸载期间加载/重排/失败，旧结果不得写当前内容、错误、按钮或进度，重试不丢已确认标注。

## 5. 跨格式与宿主验收

- [x] 5.1 在 `scripts/check-reader-browser.mjs` 或同级脚本串联新增 PDF Text 真实布局场景，回归 `scripts/check-epub-pagination.mjs` 对应的 EPUB 重排/固定版式/封面/进度场景，以及 PDF Layout 翻页/缩放/链接/选择/矩形/绘图和 TXT 原滚动；交付两个 delta spec 每个 Scenario 对应的执行结果与证据，设备缺失项单独标明。
- [ ] 5.2 在 iOS 和 Android WebView 验证 PDF Text 长按选择、原生手柄、页边拖选、高亮 Popover、侧栏滚动、横竖屏及同原页翻两屏后关闭重开；同时回归 EPUB 共用外壳，记录设备/系统版本与结果，不能用桌面触摸模拟替代实机结论。（2026-11-03 归档时挂起：本机无 iOS/Android 设备，未取得实机结论；浏览器证据见 `docs/ham130-acceptance.md`，实机验收待设备可用后补做。）
- [x] 5.3 验证 `webview/src/ReaderSurface.tsx`、`app/src/screens/ReaderScreen.tsx`、`src/host/readerDataStore.ts` 可沿原格式读写新进度，运行 `yarn test:run`、`yarn typecheck`、`yarn lint`、`yarn build:webview`、`yarn verify:webview`、`yarn check:browser` 及新增分页脚本；在实施验收记录中列出结果、失败/未验证项及跨格式回归证据，不以 OpenSpec 校验代替实现验证。
