# Spec Delta

## Purpose

使 reader 在宿主独立分栏中以可序列化事件交接已有高亮的长按拖动，保持高亮数据和公开位置的兼容性，避免 WebView 内浮层阻断跨栏操作，并保留单栏选择、复制、批注及手柄功能。

## ADDED Requirements

### Requirement: 原始高亮交接

reader SHALL 在启用宿主交接能力时输出左侧高亮列表使用的原始范围对象与当前手势坐标，不重建高亮 id、不改公开端点、不输出 runtime scoped 页面 id。事件字段和生命周期 SHALL 引用 WebBase `openspec/changes/add-pane-highlight-drag-handoff/contracts/highlight-handoff.md` 的权威定义；本仓 MUST NOT 维护第二份宿主 payload 或 HNN 载体类型。

#### Scenario: 同一范围数据
- **WHEN** 分别对 PDF Layout、PDF Text、EPUB 的已有高亮有效长按
- **THEN** 回调范围与左侧列表对应项深相等，id、start、end、text 和附加兼容字段保持；不含 DOM、指针事件对象或 Drag 实例

### Requirement: 交接不绘制拖拽视图

启用宿主交接时 reader MUST NOT 创建高亮拖拽 ghost DOM 或其隐藏替代视图。等待宿主确认期间 SHALL 跟踪当前输入，提前释放、超时或拒绝时取消；确认接管后由宿主持有跨栏连续手势，reader SHALL 停止重复移动和终结处理，保留必要取消清理。不得把整个高亮拖动与文字端点编辑、矩形框选或其放大镜混同删除。

#### Scenario: 接管前后与提前释放
- **WHEN** 一次长按被宿主接管并跨出 reader；另一次长按在确认前释放
- **THEN** 前者不在 WebView 创建浮层或重复交付，后者不产生迟到 ghost、载体或定位；两者结束后均可继续选字

### Requirement: 中断与旧宿主兼容

reader SHALL 在取消、失焦、切书、切模式和卸载时清理长按计时器与监听，旧事件不得作用于新文档。未协商新能力时 SHALL 保持既有单参回调和单栏功能；同时传入新旧回调时只走已协商的新交接路径，不双发。不支持的手写笔整段高亮拖动 SHALL 保持既有策略，不扩大本次能力。

#### Scenario: 单栏功能与连续切换
- **WHEN** 旧宿主或无分屏入口执行长按、复制、确认高亮、批注、端点与放大镜，再切文档并收到旧拖动回调
- **THEN** 原有功能不回退；旧回调不修改新文档，不重复确认，不遗留 ghost、计时器或输入锁
