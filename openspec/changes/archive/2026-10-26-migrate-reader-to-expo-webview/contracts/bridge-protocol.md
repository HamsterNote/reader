# WebView 桥接协议契约（任务 1.3）

基线：`237c0d51a4fc76d8c6f233bd2598ac7a14d12500`。本文档与参考实现共同固定
Expo 宿主 ↔ Web 阅读层的桥接协议，EPUB / PDF / Expo 三条主线 MUST 使用这里
的字段名、枚举值与状态语义。

- 规范性参考实现（契约测试的被测对象）：
  - `src/bridge/protocol.ts` — 包络、类型、错误码、结构校验。
  - `src/bridge/hostSession.ts` — 宿主侧会话状态机。
  - `src/bridge/engineAdapter.ts` — 引擎适配器接口（EPUB/PDF 主线实现）。
- 契约测试：`test/bridge-contract.test.ts`（16 例，`yarn test:run`）。
- 宿主语义依据 design.md 决策 2（单一数据所有者、restore 前不回写、
  重复 requestId 幂等、换文档换 session、不整包 base64 传文件）。

## 1. 包络

```ts
type BridgeMessage = {
  version: number      // 当前固定 1（READER_BRIDGE_PROTOCOL_VERSION）
  sessionId: string    // 文档会话 ID；切换文档必须更换
  requestId: string    // 同一逻辑操作的唯一标识，用于幂等去重
  type: BridgeMessageType
  payload: unknown     // 按 type 定义，见下
}
```

非法包络（缺字段、空 sessionId/requestId、未知 type）一律以
`INVALID_MESSAGE` 拒绝，不产生任何副作用。

## 2. 消息类型与方向

| type | 方向 | payload | 语义 |
| --- | --- | --- | --- |
| `ready` | Web→Host | `{}` | Web 层启动或 WebView 重载完成；宿主 MUST 以 `restore` 应答 |
| `open` | Host→Web | `{ document: { fileId, format: 'epub'\|'pdf', fileUrl } }` | 下发文档描述；文件内容经受控本地 URL/描述符交付，MUST NOT 整包 base64 走消息体 |
| `restore` | Host→Web | `{ data, progress, revision }` | 宿主最后确认快照；无历史数据时 `data/progress` 为 `null`、`revision` 为 0 |
| `change` | Web→Host | `{ data, revision }` | 全量文档数据快照回写；`revision` 会话内从 1 开始严格递增（取 restore 的 revision 续编号） |
| `progress` | Web→Host | `{ progress, revision }` | 阅读进度回写；与 `change` 共享同一 revision 计数器 |
| `command` | Host→Web | 由宿主主线定义（本契约只固定包络） | 宿主发起的动作（如重载文档） |
| `ack` | Host→Web | `{ requestId, revision }` | 确认对应 change/progress 已持久化 |
| `error` | 双向 | `{ code, message, requestId? }` | 错误码见第 4 节 |
| `dispose` | Host→Web | `{}` | 关闭/切换文档；Web 层取消加载、释放 worker/object URL 等资源，此后不得再产生该会话消息 |

## 3. 状态语义（宿主 MUST 满足）

1. **初始化不清空数据**：收到 `ready` 前收到的 `change`/`progress`、或
   `restore` 尚未下发时收到的 `change`/`progress`，以 `RESTORE_PENDING`
   拒绝且不持久化。宿主已有快照在此期间保持逐字节不变。
2. **revision 严格递增**：只接受 `revision === 已确认 revision + 1`，否则
   `REVISION_MISMATCH` 且不持久化；Web 层修正后重试。
3. **重复事件幂等**：同一 `requestId` 重复投递只持久化一次，重复投递重发
   相同 `ack`（同 requestId、同 revision）。
4. **旧会话拒绝**：`dispose` 后或 `sessionId` 不匹配的消息以
   `STALE_SESSION` 拒绝，不修改当前文档的界面与存储。
5. **错误恢复**：Web 层上报 `error`（如 `ENGINE_FAILURE`）后宿主保留最后
   确认快照；WebView 重载后的下一次 `ready` 重新下发该快照；未 ack 的
   change 不出现在 restore 中（Web 层负责提示未确认操作的恢复结果）。
6. **版本协商**：`version !== 1` 以 `UNSUPPORTED_VERSION` 拒绝。

## 4. 错误码

`UNSUPPORTED_VERSION` / `STALE_SESSION` / `RESTORE_PENDING` /
`REVISION_MISMATCH` / `INVALID_MESSAGE` / `ENGINE_FAILURE`
（定义见 `src/bridge/protocol.ts` 的 `BridgeErrorCode` 注释）。

## 5. 引擎适配器（EPUB/PDF 主线实现 `ReaderEngineAdapter`）

- `open(descriptor)`：失败经 `error` 上报 `ENGINE_FAILURE`，不得清空既有数据。
- `restore({ data, progress })`：应用宿主快照；无法唯一定位的历史项保持原样
  并上报，不得以相似文本静默匹配。
- `dispose()`：释放全部资源，之后不再产生事件。
- 适配器经 `EngineAdapterEventSink` 上报 `emitChange/emitProgress/emitError`，
  revision 由 Web 层桥接按会话统一编号，适配器不自行编号。
- 适配器 MUST NOT 把引擎专有定位（CFI、DOM ID、PDF 文本项索引）写入
  `change` 的 `data`——`data` 只承载 `ReaderData` + 高亮/评论 JSON 的
  公开字段（见 interaction-matrix.md 的存储列）。

## 6. 安全约束（Expo 主线验收依据）

- 桥接只暴露给受控外层阅读入口；接收方校验包络结构、类型、会话与来源。
- 出版物脚本禁用；出版物 iframe 与宿主能力隔离。
- 非受信顶层导航拒绝，外链经宿主显式处理；本地资源只读且限制在当前缓存
  和应用资源根。
- 伪造消息样本：任意非包络对象、未知 type、旧 sessionId、错误 version
  均不得写入宿主数据（契约测试 `envelope validation` 组覆盖前三者）。
