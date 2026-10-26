# expo-reader-host Specification

## Purpose

使 reader 作为 Expo 应用在 iOS 和 Android dev client 中运行，以嵌入的 Web 阅读层承载本期 EPUB 和 PDF，并在文件载入、应用重启、文档切换及异常恢复时保证可用和数据隔离。

## Requirements

### Requirement: Dev client reads bundled Web content
系统 SHALL 提供可构建安装的 iOS/Android Expo dev client；EPUB/PDF 阅读均 MUST 在 WebView 内完成，必要阅读资源随应用交付。

#### Scenario: Offline device launch
- **WHEN** 安装 dev client，启动运行所需的应用包后断开网络，用户打开本地 EPUB 和 PDF
- **THEN** 两种文件均能展示并完成高亮，不依赖外部 CDN 或开发电脑的 Web 阅读服务器

### Requirement: Durable data ownership
系统 MUST 按文件恢复已确认的阅读数据，Web 层初始化不能覆盖已有数据；桥接重复消息不得重复创建标注。

#### Scenario: Restart after saving
- **WHEN** 用户在 dev client 保存高亮、退出并重启后打开同一文件
- **THEN** 显示最后确认的数据和进度，初始化期间不回写空集合

#### Scenario: Duplicate delivery
- **WHEN** 同一会话的同一变更被重复投递
- **THEN** 宿主只应用一次并返回确认，持久化数据中不存在重复标注

### Requirement: Session lifecycle isolation
系统 SHALL 隔离不同文档会话，关闭或替换文档时取消旧任务、释放阅读资源，WebView 错误后可恢复最后确认数据。

#### Scenario: Stale change after switching files
- **WHEN** 用户从 A 切换到 B 后收到 A 的进度或高亮消息
- **THEN** B 的界面和存储均不被该消息修改

#### Scenario: Web content reload
- **WHEN** WebView 异常重载后用户重试
- **THEN** 当前文档从宿主最后确认快照恢复，并提示未确认操作的恢复结果

### Requirement: Restrict document access to host capabilities
系统 MUST 拒绝文档脚本或非受信来源调用宿主桥接，不允许文档导航触发任意本地文件读取或执行宿主命令。

#### Scenario: Publication attempts a host command
- **WHEN** 文档嵌入脚本或外部导航尝试提交伪造存储或文件命令
- **THEN** 命令被拒绝，其他文档数据及本地文件保持不变
