# Design

## Context

动机见 proposal.md。观察基线 `4b8908e`：ReaderScreen 切换按钮先 await 当前 close；ReaderWebView 有 8000ms 握手提示，bridge close 自身还有 5000ms flush 确认。NativePdfReader 的 loadNativeSnapshot 会在读取异常时回退 record.snapshot；persist 通过 updateSnapshot 获取事务基线，但页面编辑把旧 hiddenPages/edgeCrop 一起覆盖。存储串行只能保证写入顺序，不能保证字段归属。

只读历史中：`edff5ed` 让新旧组件并存；`7f7a714` 的 nativeStore Proxy 等待所有方法，连 get 也被挡住；`e398eb4` 先放开 gate 再取消，虽补了原生 close，但 prepare 仍读取 pageEditBase.current；`be697af1` 改进正常回 Web generation 和返回保存重试，仍遗留失败弹窗复用 Web 的旁路。三轮同源是用会变的编辑器 ref 或打开时的旧数据生成整份覆盖目标，而非操作自身的字段意图。

## Goals / Non-Goals

**Goals:** 独立判断读就绪、权威快照就绪与写权；每个写入在执行时可证明归属；每个重试仅重放同一不可变意图，所有失败能留下可完成路径。

**Non-Goals:** 不重做一期 PDFKit、选择、OCR、标注历史或公开存储格式；不以增大超时/锁队列代替交接；不扩展目前 `__DEV__` PDF 切换入口到生产默认路由。

## Decisions

### 1. 读取不等写权，权威快照是独立状态

ReaderScreen 持有每个 fileId/pane 的协调器；切原生立即挂载 PDFKit，先从 record/本会话最后确认数据建立只读 displaySnapshot 并发出 open，同时异步读取 store.get，不套等待 close 的全方法 Proxy。特别是现有 store.get 自身也经过 runForFile，会排在未完成写事务之后，所以 open 不得 await get；即使 get 被慢写阻塞也必须能显示 PDF。加载数据分为 displaySnapshot 与 authoritativeSnapshot：前者用于尽快显示最后已确认数据，后者必须在旧写者退役后重新从 store.get 成功读取并经恢复完成，才标为 ready。早期 get 结果只能刷新只读显示，不能直接标 ready；store.get 出错可以继续显示已知内容但必须显示恢复失败，不能用 record.snapshot 回退冒充权威就绪。

只读态允许本地翻页、缩放和选择查看；不提交标注/裁切/隐藏页、撤销重做、书签、工具配置、OCR 缓存或进度写入。只读期间的最新有效几何进度仅保留为本会话内存意图，接权并应用权威布局后重新校验，再由新写者按原进度策略提交；初始化零进度不能落盘。

按钮/菜单可用性来自同一 ready 状态，但提交函数必须在创建操作前检查 `ownsLease && snapshotState === ready`，无权限返回显式 `not-ready`，不入保存队列/历史、不积攒待会后自动提交的编辑。原生绘图事件、内部 Web Popover 的 change、OCR 异步完成和进度事件同样检查；拒绝的乐观预览应取消/回显确认数据，不能让用户误以为已保存。

替代方案：只提前挂载但 get 等 gate 会复现 94 秒页数为 0；只置灰 UI 会被迟到回调绕过；放开所有写入则产生双写者，因此均不采用。

### 2. 写权状态机：有主、排空、无主刷新，再授予

运行时 identity 为 `{fileId, paneId, sessionId, generation}`，lease 加单调递增 epoch，持有者为 identity 或 null。状态和命令由协调器同步转换，不依赖某个 Promise 恰好先 resolve。建议纯模块 `src/nativePdf/handoff.ts`，ReaderScreen 负责组件生命周期，bridge/原生持久化适配器执行相同的 lease 判定。

| 状态 | 唯一持有者 / 允许写入 | 转移条件与下一状态 |
| --- | --- | --- |
| WEB_ACTIVE(g) | Web g，可接受正常提交 | 点击切原生：立即挂载只读原生 n，Web 停止新输入并开始最终 flush，进入 WEB_DRAINING(g,n) |
| WEB_DRAINING(g,n) | Web g，仅排空已接收编辑及最终稳定进度；原生无写权 | flush/ACK 确认 + 宿主持久化队列稳定 + 旧会话退役完成：撤销 g lease，进入 NATIVE_REFRESHING(n) |
| WEB_DRAIN_FAILED(g,n) | Web g 保留排空/重试权，原生只读 | 重试排空回 WEB_DRAINING；取消转向 RETURNING，仍先排空旧 Web，不能直接丢弃旧会话 |
| NATIVE_REFRESHING(n) | null，双方都不能写 | 成功读回并应用退役后权威快照、核对 identity/epoch：授予 n lease，进入 NATIVE_ACTIVE；读取失败原状态保留重试 |
| NATIVE_ACTIVE(n) | 原生 n（含其内部 Web 编辑桥接，统一由原生持久化），旧外层 Web 已退役 | 切回/取消/返回：停止新输入，进入 NATIVE_DRAINING(n,target) |
| NATIVE_DRAINING(n,target) | 原生 n，仅排空待保存操作和最终进度 | 全部操作确认且 close 成功才撤销 lease；去书库则 CLOSED，回 Web 则 WEB_REFRESHING(g+1) |
| NATIVE_DRAIN_FAILED(n,target) | 原生 n 保留待操作重试权，保持挂载 | 显式重试成功后继续 NATIVE_DRAINING；失败不得卸载、不得给 Web 写权 |
| RETURNING(g,n) | 若 g 尚未退役则仅 g 排空，原生无写权 | 确认 n 无待保存项（或按上述原生 drain 完成）且 g 排空退役后，转 WEB_REFRESHING(g+1)；任何失败保留 n 界面及原持有者重试入口 |
| WEB_REFRESHING(g+1) | null | 新组件、新 sessionId/sourceToken，从最新存储恢复且桥接 ready，再授予新 Web lease，进入 WEB_ACTIVE(g+1) |
| CLOSED | null | 旧 identity 的任何异步事件均拒绝 |

排空的“确认”包括 Web 端停止输入并发送的最终 flush 屏障、稳定进度捕获、宿主全部持久化 ACK 和队列稳定；仅 host 队列当前为空、ready 指针存在、组件卸载或超时均不构成证明。未恢复、从未启用输入且宿主可证明没有接受过任何编辑/进度的 Web，可走“从未成为写者”的快速退役；必须先封闭消息入口并撤销 generation，再确认已接收任务全部落盘。若无法证明未启用输入，即使磁盘 revision=0 也必须按正常 flush 处理，失败留原生可读，不凭超时丢数据。

close 超时当前会 abortClose/resume：handoff 模式需要保持输入冻结或等价宿主门禁，确保 WEB_DRAIN_FAILED 只接受恢复旧待写操作，不重新开放新编辑。保留原有非 handoff close 行为；不得把全局 close 超时改成成功。已有存储队列继续服务单写者的顺序和原子性，不承担写权裁决。

授予前先撤销旧 lease，完成旧事务，再读权威基线；每个变更在入口及真正事务回调执行前校验 identity/epoch（排队后也可能过期）。所有实际 mutation：Web saveSnapshot/saveRebasedSnapshot、原生 updateSnapshot、导入旧 JSON 都受协调器约束。交接期间导入拒绝，避免第三个写者。旧外层 Web 与 NativePdfReader 内部用于规范文本/Popover 的 WebView 必须区分：后者不另获 store 写权，事件只能由当前原生 owner 校验后提交。

重复点击相同目标返回已有转移结果，不另建 writer；相反目标只记录 target，沿当前排空/退役继续。每次 await 回来重新核对 identity/epoch/target；旧回调不能释放当前 gate、授予自己或卸载另一文件。A/B 切换前当前文件先通过退出保存屏障。

替代方案：用 operationRef Promise 排队没有“谁能写”的证据，旧事件仍可调用存储；只在 React render 判断权限无法封住已排队异步任务。使用显式状态和执行时 fencing，保留事务队列但不增加互斥锁。

### 3. 操作携带不可变基线和字段级 dirty

页面编辑打开时复制已就绪权威基线（嵌套 crop/数组也复制）。提交时再复制并封存操作；下列是设计类型，不是本次新增代码：

```ts
type PageEditOperation = DeepReadonly<{
  operationId: string
  identity: { fileId: string; paneId: string; sessionId: string; generation: number }
  leaseEpoch: number
  baseRevision: number
  base: { hiddenPages?: (number | string)[]; edgeCrop?: ReaderPageEdgeCrop }
  dirty: { hiddenPages: boolean; cropAll: boolean }
  target: { hiddenPages?: (number | string)[]; cropAll?: ReaderEdgeCrop }
}>
```

`dirty` 是提交时按操作自身 base 与草稿的规范化语义差异固定的值，不读取 pageEditBase.current；hiddenPages 比较时理解 number/page-N 别名，crop 比较四边缺省语义，未改字段保留其原有表示。显式恢复全部页是 `dirty.hiddenPages=true,target.hiddenPages=[]`；没有动隐藏页是 dirty=false，两者不能混淆。修改后改回基线等于未修改。现有 UI 只编辑全局 crop，所以 dirty 粒度为 hiddenPages 与 edgeCrop.all；未来若编辑单页 crop，新增对应页路径，不能扩成覆盖整个 edgeCrop。

每次 prepare 可刷新用于展示的数据，但真正 patch 必须在 updateSnapshot 的原子回调内用最新 base F 再计算：

```text
H = op.dirty.hiddenPages ? op.target.hiddenPages : F.readerData.hiddenPages
C = op.dirty.cropAll ? { ...F.readerData.edgeCrop, all: op.target.cropAll }
                     : F.readerData.edgeCrop
next = patchOnlyOwnedFields(F, H, C)
```

保留 F 的 edgeCrop.pages、其他 ReaderData、progress、ranges/rects/paintings/comments 及未知信封字段；字段缺省不转换成清空。禁止用 `get` 取到的旧 F 拼整份 next 再传回事务，禁止 `let next` 在重试间复用。操作 base 用于证明用户意图/生成 dirty，不用于覆盖最新快照；重试不重新比较草稿与新 F，dirty/target/base 均保持同一对象语义。

保存记录用 `{operation, attempt, status, error}`，attempt 可变而 operation 不变。失败项不能被后一个 failedTransform 覆盖；先重试队首失败操作，再处理后续项，顺序按操作 ID 保留。成功才增加确认 revision、移除待项并清错误；重复点击重试共用该 attempt，已确认 operation 不重复落盘或重复加入历史。若发生已写盘但 ACK 未到，用既有 request/commit 确认机制识别，不能靠自增 revision 盲目再次应用。

只读/无写权的编辑不创建 operation。失败后允许重新打开并取消编辑器以复现历史路径，但新编辑器有独立 base；保存错误重试入口永久引用旧 operation，不引用当前编辑器。旧操作未成功时新提交不替换它，按顺序保存或明确要求先处理旧失败。

撤销记录只记录本操作实际修改的字段及成功事务执行前值；裁切-only 的撤销不能恢复隐藏页。失败不宣称确认成功，不启动已保存的 5 秒撤销时限；保存成功才应用确认布局和撤销计时，避免失败假成功。绘图历史继续沿用一期字段归属，不恢复整份过期快照。

替代方案：prepare 时对最新编辑器 ref 做 diff 正是第三轮缺陷；每次重试用打开时快照恢复全字段会覆盖后来落盘数据。封存 operation + 事务内按 dirty 合并解决两者共同根因。

### 4. 退出与恢复统一走同一状态机

正常“Web 对照”、错误提示“返回 Web 对照”、取消入口、硬件返回均调用同一请求目标路径。取消不是 release 任意 Promise：先确认原生队列为空或完成全部待写项，失败保留原生挂载、dirty 操作与可点击重试，不自动无上限重试。若旧 Web 仍有未确认写入也必须排空，不能通过刷新新 Web 丢弃旧内存编辑。

回 Web 一律新 generation、新组件 key、新 sessionId/sourceToken；原生 close 成功后才能交权，新 Web 从权威快照恢复，不继承旧 hostError/timeout。新 Web 自身失败仍展示本次错误。返回书库仅在所有相关 writer 退役后 onBack 一次，不能因 startingHandle 消失就当作成功。

## 冒烟 / 自测用例

以下是**开发阶段必须新增的精确文件/用例名**；main 尚无这些 handoff 用例，本次不创建或执行测试代码。仓根已有 Vitest/test:run 与 React Testing Library，复用 interleaved-saves 的真实 NativePdfReader、Host 与事务存储；仅替换平台视图、计时与可控 IO。快照断言必须重开读取存储，不能只看 mock 调用成功。每条命令退出 0 且匹配用例数非 0 才算通过，禁止 passWithNoTests。

| 验收 | 新增命令（仓根运行） | 注入/动作与必须断言 |
| --- | --- | --- |
| 2 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'opens native for delayed or absent Web handshake'` | 参数化延迟/永不握手，hold Web close 未 resolve，并参数化 store.get 被慢写阻塞；断言在 get/close 都未返回时已发 PDF open、页数>0、翻页命令可用，不出现阻断性握手错误；断言非仅 mount |
| 2 + 约束2 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'rejects edits until authoritative snapshot and lease are ready'` | hold 权威读及旧 flush，直接调用提交/原生事件/内部 Web change，断言 not-ready、零写盘/零历史；放行旧写确认后读取新 revision，再放行读与接权，提交才成功；读取拒绝时仍不得用 record 快照取得写权 |
| 3 | `yarn vitest run test/native-pdf/interleaved-saves.test.tsx -t 'preserves Web hidden pages when native crop follows handoff'` | Web 隐藏页 [2] 写入挂起→切原生只读→释放 Web 落盘并退役→权威就绪→裁切 top=0.05→重开；断言 hiddenPages=[2]、edgeCrop.all.top=0.05、revision 递增，写者轨迹无重叠 |
| 4 | `yarn vitest run test/native-pdf/interleaved-saves.test.tsx -t 'retry keeps immutable page edit baseline after editor reopen'` | 裁切-only operation 基线 hidden=[]，首次写失败；权威源已保存 hidden=[2]；重开编辑器不改并取消，重试原操作；断言隐藏仍 [2]、crop=0.05、operationId/base/dirty 不变，ranges/comments/单页 crop 均不变；分别保留先红后绿原始输出 |
| 4 | `yarn vitest run test/native-pdf/interleaved-saves.test.tsx -t 'explicit hidden page clearing differs from untouched fields'` | 参数化 untouched、显式 []、crop-only undo、重复重试；断言 untouched 保留 F，显式 [] 才清空，crop-only undo 不改隐藏页，重复重试一次逻辑保存；嵌套草稿对象修改不污染 op |
| 5 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'keeps native mounted when cancel save fails and recovers by retry'` | 在原生取得写权后提交裁切，hold 首次写→取消/错误返回，写失败；断言 Native 保持挂载、Web 无 lease、onBack=0、重试可点且旧操作仍在；重试成功后才出现新 Web generation 且重开 crop=0.05 |
| 5 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'does not discard old Web writes when cancelling pending handoff'` | 旧 Web [2] 未确认、原生只读时取消；断言不直接卸载旧写者、不授予新写者；retry 旧 flush 成功后新 Web 恢复 [2]，原生无非法待写项 |
| 6 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'returns to a fresh Web generation on every return path'` | 参数化正常/失败提示/取消回 Web，旧组件带 error；断言新 key/session/generation、新 ready 后正常内容、旧超时文本不存在；再投递旧 change/error/close 回调，当前快照和写权不变 |
| 约束1/5 | `yarn vitest run test/reader-screen-handoff.test.tsx -t 'fences queued stale writes and repeated switch requests'` | hold 执行中的事务、重复点击及 A/B 来回；断言旧事务完成前不交权、交权后旧 queued 写在执行边界被拒，旧回调不授予 lease；同一目标一条转移/一次 close，无双写和挂起死锁 |

AC4 历史重放的 hidden=[2] 变化必须通过受控权威存储 fixture 在 prepare/重试前注入，专门隔离基线缺陷，不在完整 handoff 用例中非法制造双 writer。集成 AC3 则严格遵循新状态机。

验收 7 开发必须另附 `yarn test:run`、`yarn typecheck`、`yarn typecheck:host`、`yarn host:check` 原始 stdout/stderr/退出码；与 CI 同口径再跑 `yarn lint`（eslint .），不只 lint 修改文件。冒烟不能代替全量。

验收 1/8 的设备判定见 expo-reader-host delta，所有设备证据必须在同一待交付 SHA，注明设备/iOS、样本 SHA256、构建资源核对及时间戳，不引用一期旧结论。

## Risks / Trade-offs

- [Web 真有未确认内容且不响应] → 原生保持可读但禁编辑，提供旧写者重试；不靠超时抢写权。可读的 10 秒目标与编辑就绪分开记录。
- [旧 close 失败会 resume 输入] → handoff 专属冻结/宿主提交门禁及执行边界 fencing 配套验证；不可只改按钮。
- [权威读失败] → 保持只读、显示恢复重试；不能把 loadNativeSnapshot 的 fallback 视为接权成功。
- [双组件短暂共存与异步事件多] → 单 owner identity + epoch、所有回调校验，退役后尽快释放旧资源；不改现有绘图库/原生 API。
- [一期 spec 尚未同步] → 本期 delta 仅新增交接要求，显式承接已合入行为；由后续收尾阶段处理一期归档，不在 propose 越界。

## Migration Plan

无需迁移存储；运行时 lease/operation 不写入公共 ReaderData。后续 apply 按 tasks 先加回归、再数据操作和协调器、最后设备验收；分支保持 main 为基线，禁止 cherry-pick 已知缺陷实现。若实现需回滚，恢复 main 的 handoff 入口代码并保留用户已落盘快照，不能回滚用户数据或重写旧键。

## Open Questions

无阻断性未决问题。物理设备操作通道及真实 OCR provider 是否可用由开发验收时注明；不可用就标未覆盖并交人工，不算通过、不改变交接设计。
