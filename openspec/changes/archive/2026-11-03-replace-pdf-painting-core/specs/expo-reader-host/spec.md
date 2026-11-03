# Spec Delta

## ADDED Requirements

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
