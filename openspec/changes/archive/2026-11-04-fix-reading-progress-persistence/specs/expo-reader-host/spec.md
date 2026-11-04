# Spec Delta

## ADDED Requirements

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
