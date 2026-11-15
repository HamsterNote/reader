# Design

## Context

动机见 proposal。reader main `82ada7e`，公开范围为 `ReaderSelectionRange`；`useHighlightDrag.ts` 以 multi-drag tracker 观察鼠标/触摸，触摸长按500ms、提前位移4px取消，`onDragHighlight(range)` 仅单次输出范围。WebBase 还存在第二层 DOM tracker；两者不能继续充当跨独立 WebView 的 owner。

本仓 OpenSpec 1.13.1 / spec-driven，仅配置 schema，未发现仓内另附 propose 命令。已读取现有 expo-reader-host 与 reader-text-selection-interaction，新增能力不替换其中端点手柄/放大镜或会话隔离要求。

## Goals / Non-Goals

**Goals:** 原样输出范围和可序列化手势、无 ghost、接管/取消后释放输入状态；兼容旧宿主。

**Non-Goals:** 本仓不定义 native 文件身份/列表、HNN schema/载体，不处理跨栏判定，不删除端点/矩形/页浏览器使用的 multi-drag，不更改选择几何与批注数据格式。

## Decisions

### 1. 只引用一份跨仓定义

权威文档为 **HamsterNote/WebBase** 的 `openspec/changes/add-pane-highlight-drag-handoff/contracts/highlight-handoff.md`；同工作区相对本 change 可读 `../../../../WebBase/openspec/changes/add-pane-highlight-drag-handoff/contracts/highlight-handoff.md`。同附件包含两仓文件。此处不复制 payload/载体 TS 或 JSON，公共回调、消息和状态机按该文件及 WebBase design 实施。

Reader 公共 props 拟新增可选 `highlightDragHandoff` 接口，与旧 `onDragHighlight` 分离：只有宿主声明能力才启用新路径；新路径优先且不同时调用旧单参回调。reader 只输出库内手势数据，WebBase adapter 补充其实际 runtime 身份并使用其 bridge；不修改本仓独立 Expo v1 协议去假装与 WebBase 同协议。

### 2. 拆除整个高亮拖动的 DOM tracker 接线

`useHighlightDrag.ts` 新路径用 viewer ownerDocument 的原生 pointer 观察与计时器识别候选，现有 long-press/tolerance 和鼠标策略保持；不创建 tracker div 或 ghost。`Reader.tsx` → `IntermediateDocumentViewer` 接线传递新能力、开始/取消和确认状态。长按命中只限完整已确认范围，文字端点和矩形工具仍走原交互。

确认前跟踪 move/up/cancel；宿主确认持有原连续触点后停止发送权威移动，native 负责跨栏。确认前抬起/超时/拒绝则清除候选并释放 suppressNativeSelection；旧 ACK 不复活会话。取消、blur、切文档、切模式、卸载统一清理。既有旧回调保持调用时机，但不为新路径创建隐藏拖拽视图。真正的跨栏 float 拆除还需 WebBase 删除其第二层 adapter tracker/旧拖拽渲染接线，详见主 change 任务。

替代方案是让 reader 继续提供每一帧跨栏坐标；跨 WebView 后会丢失输入流，因此选择宿主 owner，而不是单纯新增一个 start 回调。

### 3. 原对象与兼容性验证

从 ranges 中命中后直接传该对象，保留 id、text、createdAt、公开 start/end、rectsBySelectionId、selectionGroup、epubRangeCoordinates 等原字段，禁止用范围坐标重造 id。单栏的选择确认、复制、标注、端点放大镜不以“native ghost”名义删除。原高亮拖动与端点拖动需独立标识，以免 DOM 断言错误地要求所有 magnifier 都消失。

三种渲染面（PDF Layout、PDF Text、EPUB）分别执行相同夹具。生命周期与跨栏验证统一引用 WebBase `smoke-tests.md`，不再建第二份宿主验收规范；库内用已有 yarn typecheck/test:run/build:lib 与 check:web-selection、check:browser 做定向回归，宿主的开发验收仍为 Web-only。

## Risks / Trade-offs

- [新旧回调双发] → 协商新能力后独占输出，测试同时传两者只交接一次。
- [取消遗留 suppressNativeSelection] → 清理函数覆盖所有退出路径，结束后立即可滚动/复制，再次长按不重复。
- [旧消息污染新文档] → 使用当前候选对象、pointer及宿主交接身份守卫；卸载前终结，不缓存旧范围。
- [库包与宿主安装脱节] → 通过真正公开构建产物集成，WebBase 双 manifests/锁一致，不能只测源码 mock。

## Migration Plan

先交付兼容的可选 API 与库级回归，再由 WebBase 接入并验证实际构建包；无握手不启用。移除本功能 tracker 不意味着删除整个 multi-drag 依赖。回滚先停用宿主新能力，旧单栏回调仍可用；无需迁移阅读数据。此轮只生成规划，所有实现任务保持未勾选。
