# expo-reader-host Specification

## Purpose

使 reader 作为 Expo 应用在 iOS 和 Android dev client 中运行，以嵌入的 Web 阅读层承载本期 EPUB 和 PDF，并在文件载入、应用重启、文档切换及异常恢复时保证可用和数据隔离。

## Requirements

### Requirement: Dev client reads bundled Web content
系统 SHALL 提供可构建安装的 iOS/Android Expo dev client；EPUB/PDF 阅读均 MUST 在 WebView 内完成，必要阅读资源随应用交付。

#### Scenario: Offline device launch
- **WHEN** 安装 dev client，启动运行所需的应用包后断开网络，用户打开本地 EPUB 和 PDF
- **THEN** 两种文件均能展示并完成高亮，不依赖外部 CDN 或开发电脑的 Web 阅读服务器

### Requirement: Durable data ownership
系统 MUST 按文件恢复已确认的阅读数据，Web 层初始化不能覆盖已有数据；桥接重复消息不得重复创建标注。

#### Scenario: Restart after saving
- **WHEN** 用户在 dev client 保存高亮、退出并重启后打开同一文件
- **THEN** 显示最后确认的数据和进度，初始化期间不回写空集合

#### Scenario: Duplicate delivery
- **WHEN** 同一会话的同一变更被重复投递
- **THEN** 宿主只应用一次并返回确认，持久化数据中不存在重复标注

### Requirement: Session lifecycle isolation
系统 SHALL 隔离不同文档会话，关闭或替换文档时取消旧任务、释放阅读资源，WebView 错误后可恢复最后确认数据。

#### Scenario: Stale change after switching files
- **WHEN** 用户从 A 切换到 B 后收到 A 的进度或高亮消息
- **THEN** B 的界面和存储均不被该消息修改

#### Scenario: Web content reload
- **WHEN** WebView 异常重载后用户重试
- **THEN** 当前文档从宿主最后确认快照恢复，并提示未确认操作的恢复结果

### Requirement: Restrict document access to host capabilities
系统 MUST 拒绝文档脚本或非受信来源调用宿主桥接，不允许文档导航触发任意本地文件读取或执行宿主命令。

#### Scenario: Publication attempts a host command
- **WHEN** 文档嵌入脚本或外部导航尝试提交伪造存储或文件命令
- **THEN** 命令被拒绝，其他文档数据及本地文件保持不变

### Requirement: Confirm new annotation storage after durable writes
宿主 MUST 将新版标注快照按文件写入独立的新存储键，原始旧 v4 blob MUST 原样保留且不再更新。Web 层 SHALL 在恢复完成后接收绘图提交，以新格式沿现有会话和 revision 协议发送完整快照；宿主 MUST 在持久化成功后才 ack，失败时保持最后确认快照并报告错误。界面可即时显示尚未确认的笔迹，但 MUST 不得把它标记为保存成功。初始化、重载及切换文件不得以空集合覆盖已确认数据。

#### Scenario: Migrate then restart the app
- **WHEN** 只有旧 v4 数据的 PDF 首次打开，迁移写入得到宿主 ack，随后重启 App 并打开同一文件
- **THEN** 从新键恢复迁移后的标注且不重复迁移，原旧 blob 保持字节不变

#### Scenario: Commit edit delete and undo operations
- **WHEN** 用户完成一笔绘图、编辑、删除，或执行绘图库支持的撤销/重做并收到保存确认，再重启重开
- **THEN** 恢复最后确认的新格式状态，包括确认的删除；临时移动点或被取消的手势未成为额外持久化对象

#### Scenario: A write fails before acknowledgment
- **WHEN** 迁移或绘图提交遇到文件写入失败、桥接中断，或重启发生在 ack 之前
- **THEN** 不显示虚假的保存成功，最后已确认数据与旧 blob 不被破坏；重开后若新键已完整落盘则使用该新键，否则可重试迁移或恢复最后确认快照，不产生半写数据或重复笔迹

#### Scenario: Repeat a message or switch documents
- **WHEN** 重发同一 requestId 的绘图快照，或从 A 切换到 B 后收到 A 的旧回调/迁移结果
- **THEN** 同一提交最多应用一次，B 的新旧存储与页面均不受 A 的结果影响

#### Scenario: Open upgraded data in an old app
- **WHEN** 升级后新增绘图并保存，然后用旧版 App 打开同一旧记录
- **THEN** 旧版仍可读其原有 v4 数据并显示升级前状态；新版新增绘图只存在于新键中，不向旧记录投影或双写

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

### Requirement: 可选的持久 WebView 会话替换

宿主 MAY 使用 createReaderHostWorkspace 在同一 WebView 内更换文档。替换 MUST 先通过原会话 close/ACK 保存屏障，再发送校验 sourceToken、previousSessionId 和全新 sessionId 的 reader:replace-session。Web 入口 SHALL 保持 React root、串行释放旧引擎和 worker，新会话继续 v1 ready/open/restore，并在位置恢复完成的 document-ready 后才提交当前项；旧会话消息 SHALL 被拒绝。新文档失败 SHALL 报告 stage=document 的 ENGINE_FAILURE，并仅对当前会话执行一次宿主重载；关闭保存失败不属于文档重载条件。

#### Scenario: 旧消息与失败回退
- **WHEN** 新会话已建立时旧会话进度或错误迟到，或新会话重复上报加载错误
- **THEN** 旧消息不影响新文档，新会话仅发起一次宿主存储重载，v1 旧宿主继续兼容

#### Scenario: 替换后恢复 PDF 文字模式
- **WHEN** 同一 WebView 从 PDF 文字模式切到 EPUB 并返回 PDF
- **THEN** PDF 文字视图完成字体、分页布局和原位置恢复后才发 document-ready；宿主随后提交且容器不变，目标页或布局失败发送统一文档错误并触发宿主重载

### Requirement: Native PDF reading is independent of retiring Web handshake

iOS PDF 从 Web 切原生时，系统 SHALL 不等待旧 Web 握手或关闭确认即可打开原生文档、显示有效页数并允许只读翻页/缩放。旧会话未确认不得阻断上述读取能力，也不得被当作新写者已取得编辑资格。200 页验收样本首次点击切换到实际可读交互 MUST 小于或等于 10 秒；仅挂载组件不算达标。

#### Scenario: Web handshake is delayed or absent
- **WHEN** 用户首次切原生，旧 Web 握手延迟或不响应，关闭尚未完成
- **THEN** 原生可打开文档并翻页，界面不被旧“WebView 未完成握手”错误阻断；未确认数据仍保留于旧会话，原生只读

#### Scenario: Device first switch on a 200 page document
- **WHEN** 在待交付版本设备上首次打开已记录哈希的 200 页 PDF 并只点击一次切原生
- **THEN** 从实际点击到首屏有效页数和一次成功翻页/缩放的时间差不超过 10 秒，原始日志无“WebView 未完成握手”；记录点击、原生 open、页就绪和交互完成时间，不以挂载时间替代

### Requirement: PDF handoff has an exclusive identifiable writer

系统 MUST 在每个文档交接期间明确唯一持有写权的文件/会话/generation；旧外层 Web 与新原生不得同时写入。新写者接权前 MUST 确认旧写者停止新输入、所有已接收操作与最终稳定进度持久化并确认、旧会话退役，以及新写者重新成功读取并应用权威快照。超时、组件卸载或暂时空队列不得等同于上述确认。退役会话的迟到写入、错误和关闭回调 MUST 无法影响当前会话。

#### Scenario: Web write is pending when native opens
- **WHEN** Web 隐藏页操作尚未落盘时用户切原生
- **THEN** 原生允许只读，Web 继续确认原待写项；旧写者退役后原生重新读取包含隐藏页的快照，才允许新提交，任何时间均无两个写者

#### Scenario: Old writer cannot confirm or never became writable
- **WHEN** 旧 Web 无法确认 flush，或宿主可证明它从未启用输入且没有未落盘操作
- **THEN** 前者保留旧会话待项及重试、原生保持只读；后者封闭旧消息入口并确认已接收任务完成后可安全退役，不能仅凭 revision 为零或超时推定没有编辑

#### Scenario: Stale and duplicate switching events
- **WHEN** 重复点击切换、改变返回目标，或文件 A 的已排队写入/回调在会话失效后才执行
- **THEN** 同目标共用当前转移，旧异步事件不得重新获权或修改 B，新写者不会早于旧事务确认取得写权

### Requirement: Authoritative snapshot readiness gates every edit submission

系统 MUST 仅在当前会话拥有写权且权威快照加载与恢复成功后接受编辑。限制 SHALL 覆盖实际提交路径，而非仅按钮状态；无权或未就绪时编辑不得排队延后自动提交、不得入历史或落盘，并 SHALL 返回可识别的未就绪结果。此限制包含裁切、隐藏页、标注、撤销重做、内部编辑桥接、导入以及后台 OCR/配置/进度写入。只读翻页本身不得回写旧基线或初始化零进度。

#### Scenario: Submit bypasses a disabled control
- **WHEN** 权威快照仍加载或旧写者未退役，提交回调、原生事件或内部 Web 编辑消息直接触发保存
- **THEN** 提交被拒绝，持久化与历史均不改变，乐观编辑被取消或恢复已确认显示；就绪后用户重新提交才能保存

#### Scenario: Authoritative read fails
- **WHEN** 交接后读取权威快照失败，但界面有打开时旧快照可显示
- **THEN** 可以显示只读内容并提示读取重试，不能宣称可编辑；成功重新读取并恢复后才能获得编辑资格

### Requirement: Cancelling and leaving PDF handoff preserve recoverable saves

取消 handoff、切回 Web 或返回书库前，系统 MUST 确认原生所有待保存操作及最终有效进度已落盘。旧 Web 尚有未确认写入时也 MUST 先保全并完成确认。保存失败 SHALL 保持原生挂载、保留待操作与明确重试入口，禁止提前卸载或把写权交给新 Web；后续成功重试才可完成离开。

#### Scenario: Native save fails while cancellation is requested
- **WHEN** 原生裁切等待保存时用户取消切换或选择返回 Web，持久化失败
- **THEN** 原生仍挂载，返回书库回调不触发，新 Web 无写权；重试成功后裁切落盘，再完成原目标切换

#### Scenario: Cancel before old Web has retired
- **WHEN** 旧 Web 编辑待确认、原生仅只读时取消进入原生
- **THEN** 原生无被接受的编辑待项仍需得到确认，旧 Web 未保存内容不被丢弃；旧写入确认/退役完成后才进入新 Web，失败可重试

### Requirement: Every return to pdfjs starts a fresh generation

系统 MUST 在正常返回、失败提示返回、取消交接等所有回 pdfjs 路径建立新 generation 与新会话，从最新确认快照恢复，不复用旧 error/握手超时状态。新会话自身发生错误 SHALL 正常报告，不能把清除旧错误当作新握手成功。

#### Scenario: Return after a Web timeout
- **WHEN** 旧 Web 带有握手超时错误，原生完成待保存项后通过任一返回入口切回 Web
- **THEN** 产生新会话并正常恢复文档，旧超时文本不出现，旧 generation 消息不能污染新页面

### Requirement: Handoff device acceptance has reproducible original evidence

系统 SHALL 在同一待交付 SHA 完成 HAM-271 验收 1 与 8 的设备复测并保存原始时间线；JS 隔离用例不能替代 PDFKit/WKWebView 跨进程投递、设备可交互耗时或实际菜单证据。证据 MUST 注明 SHA、设备型号、iOS、模拟器/物理机、样本哈希/页数/大小及构建与打包资源核对结果；未执行的设备类型或真实 OCR provider 明确标未覆盖，不得引用一期旧结果冒充复测。

#### Scenario: S12 five step device regression
- **WHEN** 在同一版本依次执行 canonical 握手、色板改色重开、A→B→A→B→A 两次往返、删除重开、冷远页与文字—空白—文字跨页激活
- **THEN** 留存以下五步原始日志与截图：握手显示 web-ready→canonical 接收/回放→非空菜单（合成扫描样本 utf16=13，并明确合成）；改色重开 revision 增加且颜色保留；两次往返后仍可编辑且 identity 隔离；删除重开 ranges=0；冷远页和空白跨页实际跳转并出现编辑菜单且无 activate-wait-timeout，不把有意空白页当成缺失 OCR 阻塞

#### Scenario: Capture the first failure without masking it
- **WHEN** 首次首切或 S12 任一步失败
- **THEN** 保留首次点击/请求/页面/错误/磁盘 revision 和字段的完整时间线与截图，不靠重复点击、手工重开或旧 SHA 成功结果补成通过；模拟器结论不能宣称已验证物理机
