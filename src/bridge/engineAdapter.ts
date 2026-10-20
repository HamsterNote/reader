// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.3。
// 引擎适配器接口：EPUB（Foliate）与 PDF（pdfjs viewer）两条主线各自实现，
// Web 阅读层通过它与桥接协议对接。适配器只负责文档展示与定位投影；
// 标注数据的所有权在宿主（见 contracts/bridge-protocol.md）。

import type { BridgeOpenPayload } from './protocol'

/** open 消息下发的文档描述。 */
export type BridgeDocumentDescriptor = BridgeOpenPayload['document']

/**
 * 阅读引擎适配器。实现方 MUST 满足：
 * - open 完成后才视为可接收 restore；open 失败通过 error 消息上报
 *   ENGINE_FAILURE，不得清空既有数据。
 * - restore 应用宿主最后确认快照；无法唯一定位的历史项保持原样并上报，
 *   不得以相似文本静默匹配（design.md 决策 3）。
 * - 重排/缩放只影响显示坐标，不改写持久化端点与标注 ID。
 * - dispose 取消加载、释放 worker / object URL 等全部资源；dispose 后
 *   适配器不再产生任何 change/progress 事件。
 */
export interface ReaderEngineAdapter {
  open(descriptor: BridgeDocumentDescriptor): Promise<void>
  restore(snapshot: { data: unknown; progress: unknown }): Promise<void>
  dispose(): Promise<void>
}

/**
 * 适配器→桥接层的事件出口：引擎内产生的标注/进度变更经此转换成
 * change/progress 消息。revision 由 Web 层桥接按会话递增分配，
 * 适配器不自行编号。
 */
export type EngineAdapterEventSink = {
  readonly emitChange: (data: unknown) => void
  readonly emitProgress: (progress: unknown) => void
  readonly emitError: (message: string) => void
}
