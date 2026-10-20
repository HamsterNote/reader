# Spec Delta

## Purpose

约束阅读引擎与应用宿主迁移时的公共数据和交互兼容性，使已有消费者与历史文件标注继续可用，并通过双向读写及固定交互矩阵避免格式不变但定位失效的隐性数据损坏。

## ADDED Requirements

### Requirement: Persisted annotation round trip
系统 MUST 读取现有 v2/v3/v4 高亮数据并保持现有 v4 写入格式，保留范围、矩形、绘图及其 ID、createdAt、端点、坐标单位、样式和评论关联。运行时专有定位标识不得泄露到公共数据或回调。

#### Scenario: Read legacy and write current data
- **WHEN** 同一文件加载合法 v2、v3 或 v4 历史样本后保存
- **THEN** 使用既有兼容规则补齐缺省字段，标注内容及定位不丢失，输出可由旧 v4 读入器读取

#### Scenario: New annotations remain backward readable
- **WHEN** 在新引擎创建跨页高亮或矩形并保存
- **THEN** 输出仍使用稳定公开页面 ID 和旧字段结构，旧读入器可读取且同文件重新打开定位一致

### Requirement: Preserve interaction contracts
系统 SHALL 保留既有适用的高亮新增、激活、调整、样式、删除、跳转、拖拽回调、撤销重做、矩形、绘图、评论关联，以及书签、进度、裁切和隐藏页；鼠标与触摸各遵循现有 UI 契约。

#### Scenario: Complete annotation workflow
- **WHEN** 用户在 EPUB 或 PDF 执行基线支持的标注流程并重开文件
- **THEN** 控件和回调语义保持一致，已确认操作按既有历史规则可撤销重做，持久化内容与界面一致

#### Scenario: Native touch selection
- **WHEN** 用户在移动设备长按选字并激活已有高亮
- **THEN** 使用原生文字选择手柄及既有 Popover 流程，不与滚动或矩形工具产生重复操作

### Requirement: Existing consumers and formats remain usable
系统 SHALL 保留现有 Web 库入口、公开数据类型与回调契约，以及非 EPUB/PDF 文档的原有阅读路径。

#### Scenario: Existing Web consumer imports the library
- **WHEN** 既有消费者导入库入口和 style.css，并传入原有 Reader 数据
- **THEN** 能构建、显示并接收兼容回调，不要求传入引擎专有定位字段

#### Scenario: Other formats are opened
- **WHEN** 打开基线支持的 TXT、Markdown、DOCX 或图片
- **THEN** 继续使用原有可用阅读与标注行为，不受 EPUB/PDF 引擎替换影响
