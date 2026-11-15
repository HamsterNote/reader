# Proposal

## Why

HAM-271：`main@4b8908e` 首次从 Web 切到原生仍串行等待 Web close/8 秒握手，200 页样本无法进入原生。历史三轮修复又因提交基线可变或过期导致数据覆盖；本期独立重做读取、写权交接与重试语义，既消除入口阻断，也保证未修改字段不丢失。

## What Changes

- 原生打开 PDF、渲染与只读翻页不等待旧 Web close；权威快照就绪后才允许编辑，提交路径必须校验权限。
- 引入按文件/会话/generation 识别的单写者交接状态机：旧写者停止新输入、完成已接受写入和最终进度确认后退役，新写者刷新权威快照后接权。失败保留原会话与重试，超时不等于交接成功。
- 页面编辑以不可变操作保存自己的基线、目标和逐字段 dirty 标记；每次尝试从最新事务快照只覆盖本操作修改字段，后续打开/取消编辑器不改变旧操作。
- 取消切换、返回书库与切回 Web 均先确认待保存操作；所有回 Web 路径创建新 generation，拒绝旧消息及旧 error 状态。
- 给出验收 2/3/4/5/6 的命名自动化用例、验收 1/8 的设备取证和验收 7 的全量命令。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `expo-reader-host`：新增 iOS PDF 交接的非阻塞阅读、明确写权、权威快照提交门禁、失败恢复及新 Web generation 要求。
- `reader-data-compatibility`：新增交接期间操作基线/字段归属/保存重试的数据保全要求。

## Impact

- 仅 reader 仓；本分支从 `origin/main@4b8908e` 新建。只增加本 change 的文档，不修改 `openspec/changes/add-ios-native-pdf-reading`、不重复一期功能、不实施代码。
- 后续实现涉及 `app/src/screens/ReaderScreen.tsx`、`app/src/components/{ReaderWebView,NativePdfReader}.tsx`、`src/bridge/hostSession.ts`、`src/nativePdf/{pageEdit,persistence,hostProgress}.ts`，以及现有 `ReaderDataStore.updateSnapshot` 的调用边界；必要时新增纯状态机模块。沿用存储键、快照信封、revision 与公共 ReaderData，不引入持久化锁或新存储格式。
- 已读参考 `edff5ed..e398eb4` 及 `be697af1`（连同 `edff5ed` 首次入口改造），只作失败机制参考，不 cherry-pick。`NativePdfReader` 在 main 有 `2dd72ff` 等价 lint 重构，不能按历史行号覆盖。
- 项目 OpenSpec 1.13.1 / spec-driven；仓内未找到附加 propose 命令或技能，使用已提供技能与实际 CLI instructions。基础规格仍写“全部 WebView/原生手柄”，一期 change 已提出相应 delta 但未归档同步；本期只新增交接要求，不重新定义引擎路由或选择控件。
- 合理假设：10 秒“可交互”指页面可见、可翻页/缩放；旧写者未确认时编辑仍被拒绝，不把按钮可点等同于写权就绪。200 页已知样本是 56.3 KiB 文字 PDF，不冒充大体积扫描件性能验收；真实 OCR provider 与物理机覆盖程度在证据中分别注明。
