# Spec Delta

## MODIFIED Requirements

### Requirement: Preserve interaction contracts

系统 SHALL 保留既有适用的高亮新增、激活、调整、样式、删除、跳转、拖拽回调、撤销重做、矩形、绘图、评论关联，以及书签、进度、裁切和隐藏页；鼠标与触摸各遵循现有 UI 契约。PDF Layout（含 iOS 原生）及 PDF Text MUST 使用自绘选区、手柄和 Popover，不显示系统选区 UI 或操作菜单，遵循 `reader-text-selection-interaction`；EPUB 保持其既有初始选字及后续自绘端点流程。原生/Web 互读 MUST 保持已有字段语义，仅允许新增可选字段，不得要求平台专有必填数据。

#### Scenario: Complete annotation workflow
- **WHEN** 用户在 EPUB 或 PDF 执行基线支持的标注流程并重开文件
- **THEN** 控件和回调语义保持一致，已确认操作按既有历史规则可撤销重做，持久化内容与界面一致

#### Scenario: Native touch selection
- **WHEN** 用户在移动设备的 EPUB 或 PDF Layout 长按选字并激活已有高亮
- **THEN** PDF Layout 使用自绘文字选区、手柄及既有 Popover 流程；EPUB 保留既有初始选字及自绘端点交互，两者均不与滚动或矩形工具产生重复操作

#### Scenario: PDF Text touch selection
- **WHEN** 用户在移动设备的 PDF Text 长按选字或调整已有高亮
- **THEN** 使用自绘圆形端点手柄及既有 Popover 流程；只显示当前可视列内的源端点，拖动保留原页字符映射，不触发正文滚动、自动翻页或系统编辑菜单

#### Scenario: Native and Web data exchange
- **WHEN** 同一 PDF 先在 Web 创建高亮、矩形、绘图及评论，再在 iOS 原生编辑并交回 Web
- **THEN** 使用相同的 V5 标注与宿主快照，原页号、规范端点、坐标单位、ID、样式及关联保持其语义，不要求旧记录迁移为 iOS 专有结构，未编辑字段和未知可选字段保留
