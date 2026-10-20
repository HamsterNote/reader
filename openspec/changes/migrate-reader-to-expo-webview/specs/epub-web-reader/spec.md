# Spec Delta

## Purpose

使 EPUB 在 Web 阅读层中保留文档自身排版、目录与图片，并在内容重排和跨端恢复时维持 reader 既有高亮、操作界面及历史数据的可用性，避免更换阅读引擎导致定位丢失。

## ADDED Requirements

### Requirement: EPUB content and navigation
系统 SHALL 在 Web 阅读层展示 EPUB 的章节、样式、封面及图片，支持目录导航、既有适用阅读模式和字体调整，并保留 reader 的工具栏及交互 UI。

#### Scenario: Open and navigate a publication
- **WHEN** 用户打开含封面、多章节、图片和目录的有效 EPUB 并跳转章节
- **THEN** 显示正确内容顺序和目标章节，字体调整后内容可读且阅读位置保持在同一文本附近

### Requirement: EPUB annotations survive reflow
系统 MUST 使用兼容的逻辑页与字符位置恢复和保存高亮；分页、字体和窗口变化 SHALL 仅改变显示几何，不改变持久化端点、标注 ID 或评论关联。

#### Scenario: Restore legacy annotations and resize
- **WHEN** 同一 EPUB 导入历史高亮并调整字体或横竖屏
- **THEN** 高亮仍对应原文，点击、调整、删除及跳转保持已有交互，保存后原标识及格式不变

#### Scenario: Ambiguous historic position
- **WHEN** 某历史位置不能唯一还原
- **THEN** 保留原数据并呈现可识别的不可定位状态，不把标注绑定到另一个相似段落

### Requirement: EPUB failure does not corrupt data
系统 SHALL 对损坏或不支持的文件给出错误和重试入口，切换文档后不显示上一个文档的异步结果。

#### Scenario: Replace a loading book
- **WHEN** EPUB A 加载中用户打开 EPUB B，A 随后返回结果或错误
- **THEN** 仅 B 可更新当前阅读界面及持久化状态
