# HAM-268 6.5：原生 PDF 灰度、回滚与宿主接入

这份指引描述原生 PDF 作为可选渲染器的接入方式。6.4 默认入口切换仍冻结；
在 S03/S04/S06 真机验收完成前，宿主必须继续使用 Web 路径作为默认值。

## 当前开关

开发入口位于 `app/src/screens/ReaderScreen.tsx:56` 和
`app/src/screens/ReaderScreen.tsx:178-189`：`nativePdf` 初始为 `false`，Debug
且 PDF 文件才显示「原生 PDF 验证」按钮。按钮切换前调用当前 reader 的
`close()`，只有返回 `status: 'closed'` 才切换；保存未确认时停留在当前 reader，
避免切换造成数据丢失。`nativePdf ? NativePdfReader : ReaderWebView` 的选择位于
`app/src/screens/ReaderScreen.tsx:133`。

宿主接入应保持这个显式布尔开关的语义：

概念接入形态（不是当前 `ReaderScreen` 的现有 prop）如下：

```tsx
<ReaderScreen
  {...props}
  // 6.4 放量前固定 false；灰度配置只在宿主层决定此值。
  nativePdfEnabled={false}
/>
```

当前代码仍使用开发按钮作为开关，因此上面的示例字段是接入层概念，不能在
6.4 解冻前直接加入产品 API。正式接入时由宿主将灰度结果映射为同一个
`nativePdf` 选择，不要在 `NativePdfReader` 内复制一套路由条件。

## 灰度方案

1. **默认关闭**：所有用户和 Release 包走 `ReaderWebView`。只在 Debug dev
   client 用按钮验证原生路径。
2. **内部名单**：宿主在拿到稳定的用户/设备灰度配置后，仅对 PDF、iOS、名单内
   用户启用原生；EPUB、Android、Text 模式和不满足配置的用户仍走 Web。灰度值
   应在进入 `ReaderScreen` 前确定，避免渲染器在同一会话中自行漂移。
3. **小比例放量**：先记录 renderer、app 版本、文件格式、sessionId、错误码和
   close 状态，逐步提高比例。每个 file/pane 会话只选择一次 renderer；文件切换
   使用同样的开关重新创建会话。
4. **放量门槛**：S01–S14 的设备矩阵中，S03/S04/S06 真机通过，且 S10 数据
   保存、4.6 页面编辑、S09 进度、S11 错误分类、S12 OCR 均有对应 SHA 和原始
   证据后，才允许讨论默认入口切换。

## 一键回滚

宿主发生渲染错误、OCR/选择异常、保存未确认或性能回归时，按以下顺序回滚：

1. 将灰度配置改为 `nativePdf=false`，新打开的 PDF 立即使用 Web 路径；不需要
   修改存储或发布新的数据格式。
2. 已经打开的原生页面先触发现有 `close()`。返回 `unconfirmed` 时不要强制卸载，
   保留页面让用户重试；返回 `closed` 后再切换为 Web。该关闭屏障的实现见
   `app/src/screens/ReaderScreen.tsx:79-106` 和
   `app/src/components/NativePdfReader.tsx` 的 `close` handle。
3. 若原生模块不可用，保留 Web reader 作为能力回退；不要把错误文件快照写成
   空数据。宿主层记录 `renderer=native`、错误码和原始原因，便于定位后再恢复
   灰度。

回滚不删除 `reader.host.v2.snapshot.<fileId>`、pending/backup 文件或旧记录。
`ReaderDataStore` 以 `fileId` 隔离读取，保存失败保持原件；因此回滚后 Web 可以
继续读取最后一次已确认快照。

## 数据兼容与双向读取

原生和 Web 共享现有 ReaderData/V5 信封：原生只通过字符偏移、scale-one 矩形和
可选的 `layoutReadingProgress`、`hiddenPages`、`edgeCrop`、annotations 等字段
读写。未知信封字段必须原样保留，写入必须经过
`ReaderDataStore.updateSnapshot` 的最新快照 patch；不能以组件中的旧 `record` 或
整块旧 `readerData` 覆盖磁盘。

因此兼容方向如下：

- Web 写出的 v2/v3/v4 高亮、评论、绘图和旧 ReaderData 可由原生读取；原生不
  认识的业务字段保持不变。
- 原生新增的可选字段由 Web 忽略并保留，Web 再保存时不能删除；旧 Web 仍可
  打开同一文件，只使用它认识的字段。
- Text 模式仍由 Web 重排，保存字符位置到既有 `textReadingProgress`；原生只
  维护 Layout 几何进度。两者切换通过权威快照恢复，不复制 DOM 或 WebView
  存储键。
- 任何 V5/旧 blob 迁移仍走既有 `ReaderDataStore` 入口。回滚是渲染器选择变化，
  不是数据迁移，因此不得重写旧 blob；4.8 的 `legacyBlobSha256` 对照必须保持
  不变。

## 宿主接入检查表

- 在进入 `ReaderScreen` 前决定灰度值，并让同一 file/pane 会话保持稳定。
- 仅通过现有 `close()` 完成切换；`unconfirmed` 必须阻止切换并允许重试。
- 记录 renderer、SHA、设备、错误码、close 状态和快照 revision。
- 先用 Web 路径验证文件能打开，再启用原生；回滚时不删除任何快照。
- Release 默认仍为 Web，直到 6.4 明确解冻并完成 S03/S04/S06 真机验收。
