# Spec Delta

## ADDED Requirements

### Requirement: Hidden pages stay out of the main document flow

系统 MUST 在阅读态和页面编辑态都将隐藏的原 PDF 页排除在正文文档流和正文导航集合之外。每个隐藏页 MUST NOT 在正文中对应整页占位、隐藏提示、canvas、文字层或页面叠加层节点；打开编辑开关 MUST NOT 使隐藏页重新参与正文测量或触发其正文渲染。每个连续隐藏页段只允许有一个共享折叠控制节点，该节点 MUST NOT 采用原页尺寸，也不得成为隐藏页的逐页替代节点。折叠控制节点 MUST 使用绝对定位叠加在既有页间隙，不得进入文档流；切换编辑开关前后，可见页 offsetTop 与文档 scrollHeight MUST 完全不变。

#### Scenario: Enable editing with hidden pages

- **WHEN** PDF 第 9、10 页已隐藏，第 8、11 页正常显示，用户打开页面编辑开关
- **THEN** 第 9、10 页仍不显示正文页面框、内容或逐页提示，不发起这两页的正文渲染，也不成为可导航页面；第 8、11 页之间只增加一个绝对定位的共享恢复入口，第 8 页底边与第 11 页顶边均不移动

#### Scenario: Large consecutive hidden range

- **WHEN** 200 页 PDF 的第 2 至 199 页全部隐藏，用户在阅读态与编辑态之间切换
- **THEN** 这 198 页在两种状态下都不产生参与正文布局的页面占位或正文渲染请求，编辑态只增加一个段入口，不重新加载文档，且所有可见页 offsetTop 及文档 scrollHeight 与切换前完全一致

### Requirement: Hidden pages form maximal consecutive groups

系统 SHALL 先把当前文档内合法的原页码及 `page-N` 标识规范化为同一原页集合并去重，再与当前页面允许范围求交集；范围外、越界或无效标识 SHALL 保留在宿主数据中，但不生成恢复入口或模态框可选项。系统 MUST 按原 PDF 页号把可恢复隐藏页划分为极大连续段，单页也构成一段；可见页或允许范围边界 MUST 分隔不同段，不得跨段合并入口。

#### Scenario: Consecutive and isolated pages

- **WHEN** 第 2 页、第 4、5、6 页及第 9 页隐藏，其余页可见，用户进入编辑态
- **THEN** 正文依次出现「隐藏 1 页」「隐藏 3 页」「隐藏 1 页」三个入口，各入口位于对应段与原可见页的边界，不增加逐页占位

#### Scenario: Head, tail, and entire-document groups

- **WHEN** 分别隐藏开头的第 1、2 页，隐藏末尾的第 9、10 页，以及隐藏整本 10 页 PDF，并进入编辑态
- **THEN** 段首入口显示在第 3 页之前，段尾入口显示在第 8 页之后；整篇隐藏时正文空状态区域显示唯一的「查看 10 个隐藏页」入口，仍可打开恢复界面

#### Scenario: Duplicate aliases and out-of-range entries

- **WHEN** 隐藏数据同时包含第 4 页的数字与 `page-4` 别名，以及不属于当前允许范围的隐藏页
- **THEN** 第 4 页只出现一次且只影响一个分组，范围外页面不进入本次恢复列表，其原始数据不被静默删除

### Requirement: One modal exposes all restorable groups

系统 SHALL 在编辑态提供模态框，按原页顺序和连续段分组展示当前所有可恢复隐藏页及页码。从任一段入口打开时 SHALL 显示同一完整列表并定位到该入口对应段，用户无需关闭模态框即可查看和操作其他段。模态框打开期间 SHALL 阻止正文滚动和编辑手势，关闭后 SHALL 将焦点返回原入口；退出编辑或切换文档 MUST 关闭模态框并丢弃未确认选择。

#### Scenario: Open from one group and review another

- **WHEN** 隐藏页分为第 2 页和第 7、8 页两段，用户从第 2 页对应入口打开模态框并滚动到第 7、8 页分组
- **THEN** 两段预览都可在同一模态框中查看，正文不滚动，关闭后焦点回到第 2 页对应入口

#### Scenario: Edit mode exits with a draft

- **WHEN** 用户在模态框中已选择若干页面但尚未确认，随后退出编辑或切换文档
- **THEN** 模态框关闭，草稿选择被清除，隐藏数据不变，旧草稿不会在新文档中恢复

### Requirement: Modal supports accessible multi-select and global select all

系统 SHALL 允许用户逐个切换页面选择，并在不同连续段之间保留选择。每个已选页面 SHALL 显示蓝底白字的圆形「✓」标记，同时暴露可读页码、选中状态及键盘可操作的复选语义；颜色或图形 MUST NOT 是唯一状态提示。模态框 SHALL 提供作用于当前全部可恢复页的「全选」，全选后可取消全选，并在确认操作中显示已选数量；零选择时确认不可用。

#### Scenario: Select across groups

- **WHEN** 用户在模态框选择第 2 页，再选择另一段的第 7、8 页，并取消选择第 2 页
- **THEN** 第 7、8 页保持选中并显示蓝底白字对勾，第 2 页取消标记，确认操作显示将恢复 2 页

#### Scenario: Select and clear the complete restorable set

- **WHEN** 当前可恢复列表包含多个段，用户激活「全选」后激活「取消全选」
- **THEN** 第一次操作选中所有段内的全部可恢复页，第二次清空全部选择并禁用确认；范围外隐藏页不受选择影响

### Requirement: Restore commits once and offers one undo

模态框选择 MUST 只是未提交草稿。取消、关闭或 Escape SHALL 丢弃草稿且不修改数据；确认 MUST 通过一次原子数据更新只移除所选原页对应的数字或 `page-N` 隐藏项，保留未选项、范围外项、其他阅读数据及其顺序。确认后 SHALL 关闭模态框、恢复所选页的正文与导航且不重载源文档，并提供 5 秒内可用的一次「撤销」；撤销 MUST 恢复本次确认前的完整隐藏页集合并保持其他最新数据不变。下一次隐藏/恢复、退出编辑或切换文档 MUST 立即使该撤销失效，撤销不纳入标注撤销/重做历史。

#### Scenario: Confirm a partial batch

- **WHEN** 用户跨段选择第 2、7、8 页并确认，而第 4 页仍保持隐藏
- **THEN** 系统只提交一次恢复，第 2、7、8 页按原页号回到正文和导航，第 4 页仍折叠隐藏，源文档不重新加载

#### Scenario: Cancel or undo

- **WHEN** 用户先选择页面后取消，再重新选择并确认，随后在 5 秒内激活一次撤销
- **THEN** 取消未修改任何数据；确认只恢复本次所选页，撤销将这些页恢复为确认前的隐藏状态且只执行一次，其他阅读数据不变

#### Scenario: Document changes before undo

- **WHEN** 用户在文档 A 确认恢复后、撤销仍可用时切换到文档 B
- **THEN** A 的撤销入口立即失效，任何迟到回调都不能恢复 A 的隐藏项或覆盖 B 的数据

### Requirement: Restoration previews are bounded and session isolated

模态框 SHALL 复用阅读器现有 PDF 预览能力，仅为模态框内可见或即将可见的页面按需生成真实缩略图，并保证原页宽高比；MUST NOT 为生成列表一次性渲染全部隐藏页。预览任务 SHALL 让位于正文渲染并具有有界并发和缓存，失败 SHALL 提供单页重试而不影响其他页面。关闭模态框或切换文档 MUST 取消旧任务并释放其资源，旧结果 MUST NOT 出现在后续列表中。

#### Scenario: Preview pending, failure, and retry

- **WHEN** 用户打开包含多个隐藏页的模态框，某个可见预览失败而其他预览成功，随后重试失败页
- **THEN** 加载中的项目保持稳定尺寸，失败页显示可识别错误和重试入口，重试只重新生成该页且成功后显示正确预览

#### Scenario: Close or replace during preview loading

- **WHEN** 文档 A 的隐藏页预览仍在加载，用户关闭模态框或打开文档 B，随后 A 的预览结果返回
- **THEN** A 的任务被取消并释放，结果被丢弃，B 不显示 A 的图片、页码或错误
