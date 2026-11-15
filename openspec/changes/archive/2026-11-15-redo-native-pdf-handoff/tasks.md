# Tasks

## 1. 固定交接回归基线

- [x] 1.1 在 `test/reader-screen-handoff.test.tsx` 建立真实 ReaderScreen/NativePdfReader、可控旧 Web close、平台视图与真实事务存储夹具；运行 design 冒烟表验收 2 的两条精确命令，保留修复前阻断读取/提交门禁失败的原始输出，确保每个筛选至少执行一个用例。
- [x] 1.2 扩展 `test/native-pdf/interleaved-saves.test.tsx`，新增 design 中验收 3/4 的三个精确用例名；通过可控权威 fixture 重放 hidden=[] 的裁切-only 操作失败后，重新打开/取消编辑器再重试，保留 `[2]` 被清空断言的红色输出；fixture 不在完整交接路径制造双写。
- [x] 1.3 新增 design 中验收 5/6 与重复切换/迟到写入的五条精确用例；逐条执行 `yarn vitest run test/reader-screen-handoff.test.tsx -t '<表中原名>'` 并保存原始失败输出，验证实际保持挂载/重试、Web generation 和 owner 轨迹，不能只断言按钮显示。

## 2. 操作意图与重试的数据保全

- [x] 2.1 在 `src/nativePdf/pageEdit.ts` 定义不可变提交操作及基线复制、语义 dirty 计算；执行验收 4 的 explicit-clear 用例，断言 hiddenPages 与 edgeCrop.all 分离、嵌套草稿变更不污染操作、未修改/缺省/显式 [] 不混淆。
- [x] 2.2 将 NativePdfReader 页面编辑 prepare/patch 改为事务内仅覆盖操作 dirty 字段，保留最新单页 crop、其他 ReaderData 与信封字段；执行验收 3/4 三条命令，重开读取断言隐藏 [2] 和 crop=0.05 同时存在，并保留先红后绿的原始输出。
- [x] 2.3 用有序 operation/attempt 状态替代可覆盖的 failedTransform，失败保留全部待项、重复重试共用同一 attempt；通过验收 4/5 用例验证重开编辑器不改旧操作、一次逻辑确认和待项顺序，失败不清错误或标记保存成功。
- [x] 2.4 将页面编辑撤销改为仅恢复实际 dirty 字段及成功事务前值，保存成功再建立撤销计时；执行 explicit-clear 用例与既有 `yarn vitest run test/native-pdf/page-edit.test.ts test/native-pdf/interleaved-saves.test.tsx`，断言 crop-only undo 保留最新 hiddenPages 和标注。

## 3. 非阻塞阅读与写权交接

- [x] 3.1 新增按 fileId/pane/session/generation/epoch 的纯交接状态机并接入 ReaderScreen，按 design 转移表实现排空、无主刷新、授予及失败重试；执行 `fences queued stale writes and repeated switch requests`，断言任意时刻唯一 owner、旧事务未确认不得授予新 owner、重复同目标只发一次转移。
- [x] 3.2 解耦 NativePdfReader 的 PDF open/显示快照与权威快照就绪状态，先发 open 再异步 get，读取不套 close gate，读取失败禁止以 record fallback 接权；执行验收 2 两条用例，在 Web close 与排在慢写之后的 store.get 均未返回时断言实际 open/有效页数/可翻页以及未就绪编辑零落盘。
- [x] 3.3 在 `ReaderWebView`、bridge handoff close 与宿主持久化入口实现停止新输入、最终 flush/稳定进度/ACK 确认及执行边界 lease 校验；覆盖 saveSnapshot/saveRebasedSnapshot/updateSnapshot，交接期间拒绝导入。运行 handoff 全文件和 `yarn vitest run test/native-pdf/interleaved-saves.test.tsx test/webview-host-message-channel.test.ts`，验证超时不 resume 新编辑、不抢权、旧待项可恢复。
- [x] 3.4 为“从未启用输入”的旧 Web 建立可验证快速退役条件，先封闭旧消息入口再确认已接收任务稳定，不能仅凭 revision=0；扩展慢/无握手参数化用例，分别断言可证明无写者时安全接权、无法证明时保持只读及重试。
- [x] 3.5 将 NativePdfReader 的所有编辑/历史/内部 Web 提交、OCR 缓存与进度写入接入权威 ready + owner 校验；只读几何进度留内存并在接权后重新验证。运行 `rejects edits until authoritative snapshot and lease are ready`，直接触发各提交入口，断言 not-ready、不入历史、不积压编辑、不写零进度；接权后新提交正常。

## 4. 统一取消、返回与新 Web 会话

- [x] 4.1 让普通切回、失败弹窗返回、取消、硬件返回统一请求目标，按状态机确认原生全部待保存项与旧 Web 待项；执行验收 5 两条命令，断言失败保持原生挂载/onBack=0/重试可用，成功后才离开且重开数据完整。
- [x] 4.2 所有回 Web 路径创建新 generation/key/session/sourceToken，从权威快照恢复再接权；执行验收 6 参数化用例，断言旧 error/超时不复用、新页面正常渲染，新握手失败仍正确报告，旧回调不影响新会话。
- [x] 4.3 对相反切换目标、连续返回、A/B 往返的异步结果校验 identity/epoch 并及时释放退役资源；运行 handoff 与既有 `yarn vitest run test/native-pdf/canonical-delivery.test.tsx test/native-pdf/color-persistence.test.tsx`，断言无双写、无跨文件污染、onBack 至多一次、旧资源只释放一次。

## 5. 全量与设备验收证据

- [x] 5.1 按 design 冒烟表逐条运行验收 2/3/4/5/6 的精确 `yarn vitest` 命令，整理用例名、执行数量、原始输出与退出码；验收 4 附同一回归先红后绿输出，所有重开快照断言通过才完成。
- [x] 5.2 执行 `yarn test:run`、`yarn typecheck`、`yarn typecheck:host`、`yarn host:check` 和 CI 同口径 `yarn lint`，交付未裁剪原始输出与退出码；全部成功且 WebView 资源核对通过才完成验收 7。
- [x] 5.3 在同一待交付 SHA 设备构建上首次单击切入 200 页样本，记录点击→open→页数就绪→成功翻页/缩放时间线与截图，验证不超过 10 秒且无 Web 握手阻断；附型号/iOS/设备类型/样本 SHA256、大小/资源校验，不以组件挂载或 JS 用例代替验收 1。
- [x] 5.4 在同一 SHA 设备复跑 expo-reader-host delta 的 S12 五步，逐步附原始时间线、截图及磁盘 revision/颜色/ranges 核对，冷远页与空白跨页必须实际到达菜单且无 activate-wait-timeout；失败保留首次现场，物理机与真实 OCR provider 未覆盖明确标注，不能记通过，完成验收 8 的证据包。

## 设备验收收口

5.3 / 5.4 的最终设备基线为 `23e0ad819fdb0aa1f266b5fcb0ad813f0053051f`；协调者已于 2026-11-15 收下设备门禁。证据、适用范围与接受的残余风险见 [设备验收记录](device-acceptance.md)。本次归档提交仅修改 OpenSpec 文档，不改变设备基线的行为。
