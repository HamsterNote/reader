# Proposal

## Why

宿主分屏已迁移到独立 WebView，reader 的 DOM 拖动无法跨栏。库需要在长按高亮后交付可序列化的高亮与手势事件，让 native 接管浮层及目标路由。

## What Changes

- 增加可选宿主拖拽交接能力，复用已有 `ReaderSelectionRange` 原始对象，覆盖开始、接管确认前的移动/释放和取消。
- 接管后不在 reader 内生成高亮拖拽视图，不继续通过 `multi-drag` 的 DOM tracker 驱动跨栏拖放。
- 保留单栏长按、复制、确认高亮、批注、端点调整和放大镜；其他仍需 multi-drag 的功能不随本次删除依赖。
- 所有跨仓 payload、载体与事件名仅引用 WebBase 同名 change 的 `contracts/highlight-handoff.md`；本仓不重复定义宿主协议。

## Capabilities

### New Capabilities

- `reader-highlight-drag-handoff`：reader 的长按交接、原始范围输出、取消清理与无拖拽浮层保证。

### Modified Capabilities

无。现有 `expo-reader-host` 的来源/会话隔离、`reader-text-selection-interaction` 的端点与放大镜、数据兼容约束继续有效；拖动整个已确认高亮是独立于端点编辑的新交接能力。

## Impact

基线 main `82ada7e`（3.0.2）。影响 `src/components/IntermediateDocumentViewer/useHighlightDrag.ts`、viewer 接线、`src/components/Reader.tsx` 和公开类型导出。WebBase 负责把库回调封装成自己的 bridge 消息；不得误用本仓 `src/bridge/protocol.ts` 的独立 Expo v1 包络替代 WebBase 的字符串 version + webview-event/request 包络。

HNN 与 native 分屏仍在 WebBase 实现；notes/painting 无源码任务。按宿主能力协商启用新回调，旧单参 `onDragHighlight(range)` 保持兼容且不与新事件双发。开发验收采用 Web-only：本仓已有 `yarn typecheck`、`yarn test:run`、`yarn build:lib` 与浏览器检查；跨栏六条验收统一通过 WebBase 的四种 Web 检查执行。本阶段只产出文档，未运行实现或产品验收。
