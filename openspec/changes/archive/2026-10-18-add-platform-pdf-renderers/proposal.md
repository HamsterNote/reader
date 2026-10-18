# Proposal

## Why

PDF 需要固定页面、原生选文和页缩略图能力，不能继续依赖 EPUB 的重排或 IntermediateDocument 底层阅读逻辑。第一期通过独立 renderer 提供本地 PDF 阅读，同时复用外层入口、加载状态和 React 交互契约。

## What Changes

- 按内容检测后的文件类型分流：PDF 在 iOS 使用 PDFKit + 新增 Swift Expo Module，在 Android/Web 使用直接封装的 `pdfjs-dist`；EPUB 保持现有 renderer。
- 支持本地 PDF、总页数/当前页、左侧 Pages 页码与缩略图栏及点击跳页。
- PDF 文本选中后显示自定义 React Popover，只有“高亮”占位按钮；点击不创建 annotation、不调用持久化或既有高亮回调。隐藏系统、浏览器及 WebView 的原生 Context Menu，同时保留拖选、长按和选区调整能力。
- Android 以受限 `https://appassets.androidplatform.net` origin 加载打包 PDF.js 资源及当前会话 PDF，不启用 `file://` 跨资源访问。
- 保留外层 source、加载状态、生命周期和样式入口；页码、缩略图、临时选区采用中立契约，PDFKit/PDF.js/Foliate 的定位、视口和选文实现相互独立。
- 本期非目标：实际高亮、annotation 数据结构迁移/持久化/同步、历史高亮展示、评论/书签新能力、OCR、PDF 重排、远程 PDF、密码输入/解密、编辑/导出。现有 EPUB 高亮行为不因 PDF 占位按钮降级。

## Capabilities

### New Capabilities

- `pdf-renderer-routing`: 内容检测、平台 renderer 路由、本地 source、状态和生命周期兼容边界。
- `pdf-pages-navigation`: 原始 PDF 页码、总页数、缩略图和左侧 Pages 导航。
- `pdf-selection-popover`: 临时文本选区、坐标转换、React Popover、无副作用按钮与原生菜单屏蔽。
- `android-pdf-asset-origin`: Android 限定 HTTPS origin、资源/PDF 会话授权、请求与 bridge 隔离。

### Modified Capabilities

reader 当前没有 `openspec/specs` 主规格，因此本 change 不伪造本仓已有 capability。跨仓冲突必须在实施时同步：native-reader 的 `local-multi-format-reading` 明确拒绝 PDF，`reader-component-api` 与 `foliate-reader-security` 将 source/预检约束绑定到原有 Foliate 路径；新 PDF 路由需要有明确独立前置检查，不能直接取消 EPUB 的安全门禁。具体同步项见 design 和 tasks。

## Impact

- 规划唯一来源：reader 的 `openspec/changes/add-platform-pdf-renderers/`，本次仅生成文档。
- reader：`src/components/Reader.tsx`、`src/types/readerData.ts`、`src/index.ts`、demo 上传分流及相关测试；新增 Web PDF adapter。保留旧 `document` 输入，不能从 IntermediateDocument 反向重建 PDF 原件。
- native-reader 必须参与，且不限于 Swift：`packages/native-reader/src/NativeReader.native.tsx` / `NativeReader.web.tsx`、`formatDetection.ts`、`types.ts`、`ReaderChrome.tsx`、原生 source/生命周期工具；新增 iOS Expo Module、Android PDF host 与 PDF.js 打包资源。现有 Expo/Foliate API 位于该仓，不能误称位于 reader。
- 新增直接 `pdfjs-dist` 依赖及同版本 worker/cMap/font/WASM 资源（按所选版本实际需要打包）；native-reader 增加 Expo Module 注册和 pod 打包。Android secure-WebView 的生成链、源 patch 与资源清单需要同步，不能只改带生成标记的输出。
- 保持 native 32 MiB 本地 source 上限、host source 所有权、远程 URI 拒绝以及原有 EPUB 门禁。既有 native-reader 未归档的 `add-cross-platform-epub-reader` 属历史 EPUB 工作，本 change 不续写或覆盖其任务。
