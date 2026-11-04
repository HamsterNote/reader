# Proposal

## Why

HAM-160 反馈切换 pdfjs-dist 官方 viewer 后，页面浏览缩略图空白、高亮和书签定位失效，PDF 与文字模式来回切换也会丢失阅读位置。第 2 点截图是第 1 点的现象补充，合并为同一项缩略图回归处理。

## What Changes

- 恢复 Page Browser 的 PDF 缩略图、正确页面比例与点击翻页，覆盖未在正文中访问的页面及关闭重开侧栏。
- 高亮跳转定位到源文字范围，书签添加保存当前真实阅读位置、点击后恢复该位置；保留历史页级书签和字符锚点语义。
- PDF Layout → Text 优先使用安全可见视口内首行文字的源页和字符位置，打开包含该位置的文字可视页；Text → Layout 将文字模式首行对应源文字对齐安全视口顶部。仅视口内无可定位文字时按原页内纵向比例回退。
- 明确 SafeArea、实际工具栏占用和调用方边距只扣减一次；异步加载和快速切换不提交临时首屏或过期位置。
- 优先复用当前 pdfjs-dist 的页面渲染、文本层、坐标转换及目标导航 API，只补 reader 的锚点和界面适配。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pdfjs-web-reader`: 补充缩略图、高亮/书签精确导航、安全视口和无文字比例回退要求；细化现有 Text 稳定进度与兼容性要求中的双向切换行为。

## Impact

- 主要影响 `src/components/EngineDocumentViewer.tsx`、`src/pdf/PdfDocumentViewer.tsx`、`src/components/Reader.tsx` 的预览、定位与模式交接，以及 PageBrowser、PDF Text 分页和共享阅读视口测量。
- 使用当前固定依赖 `pdfjs-dist@5.4.530`，不预设升级；保持原页号、canonical 字符端点、历史高亮 ID/评论关联和现有公开回调。比例回退在既有进度字段中的表示需按 design 的兼容方案实施，不持久化临时列号。
- 范围限于 PDF 阅读回归；不改 EPUB/其他格式行为、不更换引擎、不新增 OCR 或重做书签界面。缩略图不要求绘入标注。
- 本次仅生成规划文档，验收对象为后续实现的可观察行为；不宣称已修复或已完成运行验证。
