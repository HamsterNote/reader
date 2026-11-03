# Tasks

## 1. 可视分页与导航状态

- [x] 1.1 在 `src/epub/foliateEpubEngine.ts` 暴露相邻可视页操作及 canPrevious/canNext/busy 状态，默认启用单栏 paginated，保持 goToPage 的旧逻辑页语义；扩展 `test/epub/fakeView.ts` 与 `test/epub/engine-session.test.ts`，验证操作调用 renderer.next/prev、忙碌期间不重入且失败可恢复。
- [x] 1.2 完成跨章、补封面、隐藏逻辑页/可读范围与全书首末边界判断；在引擎测试中验证章节首尾、封面不重复、隐藏项跳过和端点不循环，并用真实浏览器的单个长章节验证连续翻至少三页仍在同章、前后翻返回原页且无空白尾页。
- [x] 1.3 在 `src/components/EngineDocumentViewer.tsx` EPUB 入口接入 paginated 与新状态；真实浏览器验证重排 EPUB 单页显示、图片适配不丢失，以及固定版式 EPUB 每次切换一个原始单页，不影响 PDF 路由。

## 2. 仅按钮顺序翻页

- [x] 2.1 移除适配层滚轮/触摸边界翻章，为 `vendor/foliate-js/paginator.js` 添加显式禁用手势和选区自动翻页的配置，更新 `view.d.ts`/`paginator.d.ts` 及 PIN/MANIFEST 差异记录；验证引擎测试和 `test/epub/foliate-assets.test.ts`，真实浏览器验证拖选到页边也不触发翻页。
- [ ] 2.2 在 EPUB 正文 iframe、外层视图和空白区域限制滚轮、触控板、触摸平移与滚动按键，随文档复用/销毁清理监听；通过真实浏览器与 iOS/Android WebView 验证这些输入均不改变正文位置或外层滚动，页内长按选字、高亮和绘图仍可用，侧栏可滚动，切书无残留事件。

## 3. 右下角按钮与底栏避让

- [x] 3.1 在 `EngineDocumentViewer.tsx` EPUB 分支接入仅两个翻页按钮，复用现有底栏 Button/Popover 风格，提供“上一页”“下一页”可访问名称、焦点及 busy/边界禁用态；组件测试验证按钮仅 EPUB 可见、点击/Enter/Space 一致，加载和快速连点不跳页，首末页对应按钮禁用。
- [x] 3.2 在 `src/styles/engine-viewer.scss` 和必要的底栏布局接线中右对齐按钮组并统一底部基准，测量底栏/绘图面板实际占用，正文与交互叠层共享扣减后的视口；浏览器在 320px 窄屏、桌面宽屏、横竖屏及绘图展开状态检查按钮无重叠、与底栏对齐、最后一行及图片完整可见，并验证高亮和选区手柄坐标正确。

## 4. 阅读进度与重新分页

- [x] 4.1 按钮操作开启 progressEnabled，成功 relocate 后即使逻辑页号未变也按字符偏移发布现有进度；扩展 `test/reading-progress.test.tsx` 和引擎测试，验证同章连续翻页 offset 更新、text/layout 两种现有进度路径兼容且不新增 CFI/临时页号公共字段，失败翻页不保存虚假进度。
- [x] 4.2 处理 ResizeObserver、字体、图片加载、底栏占用变化的重排周期，冻结稳定锚点、屏蔽中间进度并在新分页中恢复；真实浏览器验证窗口从宽到窄、字号变化及底栏展开后原锚点仍在当前页，继续翻页使用新边界，零尺寸及连续 resize 不回到首屏或无限重排。
- [ ] 4.3 验证既有持久化链路 `webview/src/ReaderSurface.tsx`、`app/src/screens/ReaderScreen.tsx`、`src/host/readerDataStore.ts` 无需数据格式变更即可保存按钮产生的进度；浏览器及 iOS/Android 在同章翻两页后关闭重开，核对恢复页包含最后锚点，加载中间值不覆盖旧记录，封面/无文字页回退正确，A→B 切书不串进度。

## 5. 集成回归与交接

- [ ] 5.1 扩展 `scripts/check-reader-browser.mjs` 或同级真实布局用例，记录 specs 中每个场景对应的验证结果；运行 `yarn test:run`、`yarn typecheck`、`yarn lint`、`yarn build:webview`、`yarn verify:webview`、`yarn check:browser`，失败须定位修复后交付，并标明设备验证结果及未完成项。
- [x] 5.2 完成目录/书签/高亮显式跳转、标注保存重开、隐藏页范围、鼠标/触摸选择、绘图、PDF 及一种其他格式的回归；验收其行为符合原契约，PDF 无 EPUB 按钮和滚动限制，将首末页、重排、进度和正文避让的截图/证据及设备信息写入本 change 的实施验收记录。
