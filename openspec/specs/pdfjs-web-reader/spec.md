# pdfjs-web-reader Specification

## Purpose

为 PDF 提供可靠的 Web 页面展示、文本选择与导航，同时让用户继续使用 reader 的既有工具、高亮、矩形及绘图能力，并在缩放、页面回收及历史数据恢复后保持标注与原文一致。

## Requirements

### Requirement: PDF display and text navigation
系统 SHALL 在 Web 阅读层提供 PDF 页面展示、缩放、翻页、链接和可选择文本，保留现有 Layout/Text 入口及 reader 控件；大文件页面 SHALL 按需加载和释放。

#### Scenario: Read a multi-page PDF
- **WHEN** 用户打开多页 PDF，翻页、缩放并切换既有文本阅读入口
- **THEN** 显示正确页面和文本，页码导航保持一致，返回页面展示后内容可继续阅读

#### Scenario: Revisit a released page
- **WHEN** 用户离开已标注页直到其被回收，再返回该页
- **THEN** 页面、文字及原标注重新显示，加载过程不改变已存标注

### Requirement: PDF overlay alignment
系统 MUST 保留原 PDF 页号、字符端点、px/percent 矩形及样式语义，标注 SHALL 在缩放、旋转及裁切后与原文或原页面区域对齐。

#### Scenario: Historic annotations on a rotated page
- **WHEN** 用户恢复带文字高亮、矩形及绘图的旋转页并改变缩放
- **THEN** 叠加层对应原页面区域，高亮点击及调整可用，保存不替换原 ID、端点或坐标单位

#### Scenario: Select text containing spacing and ligatures
- **WHEN** 用户选择含空白、换行或连字的文本并保存，再关闭重开
- **THEN** 同一文字范围被恢复，文字与端点符合旧数据契约，页外文本不被误选

### Requirement: PDF errors preserve state
系统 SHALL 对损坏、不可读或加载失败的 PDF 提示错误和可执行的重试操作，保留已确认数据。

#### Scenario: Rendering fails after annotations were restored
- **WHEN** 文档展示失败或用户关闭正在加载的 PDF
- **THEN** 已有标注不被清空，旧加载结果不更新后续文档
