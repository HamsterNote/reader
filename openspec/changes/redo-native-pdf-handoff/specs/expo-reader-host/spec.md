# Spec Delta

## ADDED Requirements

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
