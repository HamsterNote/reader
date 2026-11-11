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

### Requirement: Confirm new annotation storage after durable writes
宿主 MUST 将新版标注快照按文件写入独立的新存储键，原始旧 v4 blob MUST 原样保留且不再更新。Web 层 SHALL 在恢复完成后接收绘图提交，以新格式沿现有会话和 revision 协议发送完整快照；宿主 MUST 在持久化成功后才 ack，失败时保持最后确认快照并报告错误。界面可即时显示尚未确认的笔迹，但 MUST 不得把它标记为保存成功。初始化、重载及切换文件不得以空集合覆盖已确认数据。

#### Scenario: Migrate then restart the app
- **WHEN** 只有旧 v4 数据的 PDF 首次打开，迁移写入得到宿主 ack，随后重启 App 并打开同一文件
- **THEN** 从新键恢复迁移后的标注且不重复迁移，原旧 blob 保持字节不变

#### Scenario: Commit edit delete and undo operations
- **WHEN** 用户完成一笔绘图、编辑、删除，或执行绘图库支持的撤销/重做并收到保存确认，再重启重开
- **THEN** 恢复最后确认的新格式状态，包括确认的删除；临时移动点或被取消的手势未成为额外持久化对象

#### Scenario: A write fails before acknowledgment
- **WHEN** 迁移或绘图提交遇到文件写入失败、桥接中断，或重启发生在 ack 之前
- **THEN** 不显示虚假的保存成功，最后已确认数据与旧 blob 不被破坏；重开后若新键已完整落盘则使用该新键，否则可重试迁移或恢复最后确认快照，不产生半写数据或重复笔迹

#### Scenario: Repeat a message or switch documents
- **WHEN** 重发同一 requestId 的绘图快照，或从 A 切换到 B 后收到 A 的旧回调/迁移结果
- **THEN** 同一提交最多应用一次，B 的新旧存储与页面均不受 A 的结果影响

#### Scenario: Open upgraded data in an old app
- **WHEN** 升级后新增绘图并保存，然后用旧版 App 打开同一旧记录
- **THEN** 旧版仍可读其原有 v4 数据并显示升级前状态；新版新增绘图只存在于新键中，不向旧记录投影或双写

### Requirement: Reading progress is saved at bounded intervals
系统 SHALL 在用户有效阅读位置改变后以 100ms 尾部防抖合并进度，连续移动时从首个待保存位置起最长 1000ms 提交最新稳定位置。成功翻页或显式导航也 MUST 触发该策略，即使源页码未变。系统 MUST 保留初始化、重排或恢复前最后确认的位置；失败导航不得变成新进度。

#### Scenario: Continuous scroll and stop
- **WHEN** 用户在 PDF Layout 连续滚动超过两秒，然后停止
- **THEN** 每段连续待保存期最长 1000ms 向保存链路提交最新稳定进度，停止后 100ms 提交尾部位置；相同完整位置不重复提交

#### Scenario: Failed navigation during restore
- **WHEN** 恢复未完成或一次新导航加载失败，系统短暂显示默认页
- **THEN** 不提交默认页位置，不覆盖最后已确认进度

### Requirement: Leaving a reader drains progress before closing
系统 MUST 在正常离开、替换文档或关闭阅读器前，先等待当前输入/导航稳定并采集、冲刷最新 Reader 进度，再等待桥接队列与宿主持久化完成后才允许销毁。仅桥接队列为空不得宣称所有进度已保存。保存失败或超时 MUST 报告未确认并保留可重试会话。切模式 SHALL 冲刷原模式稳定位置。后台/页面隐藏 SHALL 触发非销毁式尽力冲刷并保留会话；强杀时只保证最后实际落盘数据。

#### Scenario: Close before debounce expires
- **WHEN** 用户在一次有效滚动或翻页后不足 100ms 即点击返回，正常关闭成功，然后重开
- **THEN** 恢复最后稳定位置，Reader 待保存进度已在关闭确认前到达宿主并落盘，不回到上次定时保存位置

#### Scenario: Storage failure on close
- **WHEN** 关闭前进度写入失败或确认超时
- **THEN** 不显示保存成功、不卸载当前文档，保留最后确认快照并允许重试；成功重试后重开恢复最新位置

#### Scenario: Hide and resume the app
- **WHEN** 阅读进度尚在防抖窗口内时页面隐藏或 App 进入后台，且运行环境允许完成冲刷，随后返回
- **THEN** 最新进度经过正常持久化确认，会话未被销毁且可继续阅读；若环境提前冻结则不虚报确认，下次打开使用最后实际落盘位置

#### Scenario: Late callback after file or mode switch
- **WHEN** 文件 A 或旧模式的延迟文字层/进度回调在切换到 B 或新模式后返回
- **THEN** 不覆盖当前文件/模式的稳定位置，旧任务只能在其有效所属会话内结束，完整快照仍保留其他最新数据

### Requirement: 可选的持久 WebView 会话替换

宿主 MAY 使用 createReaderHostWorkspace 在同一 WebView 内更换文档。替换 MUST 先通过原会话 close/ACK 保存屏障，再发送校验 sourceToken、previousSessionId 和全新 sessionId 的 reader:replace-session。Web 入口 SHALL 保持 React root、串行释放旧引擎和 worker，新会话继续 v1 ready/open/restore，并在位置恢复完成的 document-ready 后才提交当前项；旧会话消息 SHALL 被拒绝。新文档失败 SHALL 报告 stage=document 的 ENGINE_FAILURE，并仅对当前会话执行一次宿主重载；关闭保存失败不属于文档重载条件。

#### Scenario: 旧消息与失败回退
- **WHEN** 新会话已建立时旧会话进度或错误迟到，或新会话重复上报加载错误
- **THEN** 旧消息不影响新文档，新会话仅发起一次宿主存储重载，v1 旧宿主继续兼容

#### Scenario: 替换后恢复 PDF 文字模式
- **WHEN** 同一 WebView 从 PDF 文字模式切到 EPUB 并返回 PDF
- **THEN** PDF 文字视图完成字体、分页布局和原位置恢复后才发 document-ready；宿主随后提交且容器不变，目标页或布局失败发送统一文档错误并触发宿主重载
