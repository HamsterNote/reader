# Spec Delta

## Purpose

为 reader 的 iOS 宿主提供原生 PDF 页面显示，同时使现有 PDF 阅读、文字选择和标注操作保持完整可用；约束原生与 Web 的公开端点、持久化和会话行为一致，使未来 Android 原生实现无需推翻现有数据结构。

## ADDED Requirements

### Requirement: iOS native layout routing and retained reading modes

系统 MUST 在 iOS dev client 的本地 PDF Layout 入口使用原生页面渲染，覆盖书库打开、重开和已接入的文件切换入口；MUST 保留 PDF Text 重排、Web/Android PDF 及 EPUB 路径。iOS Layout MUST 不调用 PDF.js 页面画布渲染，允许按需使用兼容文字/链接提取。缺少原生能力 SHALL 明确提示 dev client 构建要求，不得静默切换引擎。阅读资源 MUST 支持离线安装运行。

#### Scenario: Open offline and change mode
- **WHEN** 在断网 iOS dev client 打开本地 PDF，切到 Text，再回 Layout
- **THEN** Layout 使用原生页面，Text 保持字号及按钮分页，模式切换不重复创建文档标注，首次目标页显示并完成恢复后才报告就绪

#### Scenario: Other readers and missing capability
- **WHEN** 在 Web/Android 打开 PDF、在 iOS 打开 EPUB，或在无原生模块的运行环境请求 iOS PDF Layout
- **THEN** 前三者沿用原有路径，最后一种显示可识别的能力缺失提示和 dev client 指引，不显示虚假的就绪状态

### Requirement: Full PDF reading and editing parity

原生 Layout MUST 提供既有连续滚动、缩放、原页导航、页范围、固有旋转、裁切、缩略图、链接/目录定位、书签及高亮跳转。隐藏/范围外页不得成为正文导航目标。原页号 MUST 从 1 开始且不因隐藏、重排或虚拟化改变。缩略图 MUST 按需加载，独立失败可重试。外链 SHALL 受宿主策略控制，文档动作不得执行任意宿主命令。

#### Scenario: Navigate with excluded pages
- **WHEN** 多页 PDF 隐藏第 2 页并限定阅读范围，用户滚动、点击上一/下一页、页码、缩略图和书签
- **THEN** 所有入口使用相同允许原页集合，首末边界不循环，隐藏页不占正文整页高度，目标定位到实际可见内容

#### Scenario: Previews and links
- **WHEN** 用户浏览尚未访问页的预览，重试一个失败预览，并点击内部目标与外部链接
- **THEN** 预览显示对应原页且保持宽高比，失败不影响正文；内部目标遵守页过滤，外链仅经宿主批准的路径打开

### Requirement: Custom text selection and source fidelity

原生 PDF MUST 自绘选区填充、起止手柄和文字镜片，支持 Layout 长按选字、跨行跨页连续调整、越过固定端交换角色、边缘自动滚动及已有高亮编辑。MUST 不显示系统文字选择控件或系统复制/查询/分享菜单。手柄及镜片 MUST 遵循 `reader-text-selection-interaction` 全部适用场景，以及 `pdfjs-web-reader` 既有手柄外观、颜色、离屏端点和同帧滚动对齐契约。纯阅读手势、链接和双指导航 MUST 继续可用。取消操作不得提交草稿。

#### Scenario: Confirm and adjust once
- **WHEN** 长按文字、拖动两端并跨过固定端，确认高亮，再调整其端点
- **THEN** 草稿仅创建一次，编辑仅更新一次；选中内容对应真实源字符，ID、原颜色及评论关联保留，无系统选区 UI

#### Scenario: Cross page recycling boundary
- **WHEN** 从第 1 页持续拖动至第 12 页，起始页面已离开渲染缓存，最后释放确认
- **THEN** 保留真正起止端点及中间页内容，确认范围完整；自动滚动在释放/取消时停止，会话清除后释放保留资源

#### Scenario: Input types and cancelled gestures
- **WHEN** touch、mouse、pen 分别拖动手柄，或拖动中第二指加入、切书、切工具、失焦或取消
- **THEN** 仅启用镜片的 touch 会话显示镜片；有效拖动手柄持续可见，取消不保存范围变更，旧事件不恢复镜片或覆盖新端点

#### Scenario: Text mode retains its boundaries
- **WHEN** 在 PDF Text 页内选字、拖出当前可视页边缘，或激活一个已有跨页高亮
- **THEN** 正文不滚动或自动翻页，仍可编辑当前可见源端点，离屏端点不补柄，已有跨页区间与分组关系保留

### Requirement: Custom selection and highlight popovers

系统 MUST 提供自绘选区与已有高亮 Popover，保持当前默认确认、颜色、删除及已配置评论操作和自定义内容插槽的行为。Popover MUST 使用有效选区锚点并受阅读器安全可见区域约束；滚动/缩放/裁切/横竖屏变化时更新锚点或在无法保持有效锚点时关闭。切书、卸载或选区失效后 MUST 清除旧 Popover，不使用系统 Popover。

#### Scenario: Draft color and repeated event delivery
- **WHEN** 活动草稿更换底栏颜色后点击确认，随后收到同一操作的重复事件
- **THEN** 预览和新增高亮使用最新有效颜色，只创建一个高亮、一个逻辑保存和一个历史项

#### Scenario: Saved highlight near safe area
- **WHEN** 用户在视口边缘激活历史高亮，执行改色/评论/删除并改变方向
- **THEN** 操作仍锚定同一对象且未被安全区遮挡，未操作高亮不改色，删除清理既有关联，旧定位结果不打开失效菜单

### Requirement: Existing annotation tools and history remain complete

系统 MUST 保留既有矩形操作、绘图/形状/编辑/擦除/页清空、评论以及高亮/矩形/绘图统一撤销重做。绘图 MUST 使用既有公开文档、页面锚定及工具能力；不得改成平台私有笔迹格式。取消的笔或范围不提交；一次有效提交一条历史，受控回显不重复入栈，未提供必要回填处理器时拒绝历史移动。已有精度要求继续适用，绘图输入与回放定位误差 MUST 不超过 1 CSS px。

#### Scenario: Mixed history with durable results
- **WHEN** 第 1 页绘图 A、添加高亮 H、第 2 页绘图 B，然后逐次撤销/重做并保存重开
- **THEN** 顺序为 B、H、A 及 A、H、B，稳定 ID/颜色/坐标及其他页内容不变，重开恢复最后确认状态

#### Scenario: Cancel and branch history
- **WHEN** 绘图中第二指加入，或撤销之后确认新矩形
- **THEN** 前者不保存误笔，后者丢弃旧重做分支；同文件切模式保留已提交历史，切文件重置历史

### Requirement: Existing crop hidden page and OCR workflows

系统 MUST 保留全局/单页四边裁切、隐藏页过滤、极大连续隐藏段、分组恢复模态框、全选/取消、确认及 5 秒内一次撤销。隐藏页不得产生正文整页占位或正文渲染，切编辑开关不得改变正文高度。恢复草稿不得改数据，确认仅移除所选数字/page-N 别名并保留其他最新数据。系统 MUST 保留已配置 OCR provider、文字数据和错误回调；关闭 OCR 时无字页面不得产生伪造选区，不新增默认识别服务。

#### Scenario: Restore a large hidden range
- **WHEN** 200 页 PDF 隐藏第 2..199 页，打开编辑、从段入口查看预览、全选后取消，再重新选部分页确认并在 5 秒内撤销
- **THEN** 编辑前后正文高度不变，模态预览按需加载；取消无写入，确认一次原子更新，撤销仅恢复原隐藏集合且不进入标注历史

#### Scenario: OCR provider succeeds and fails
- **WHEN** 扫描页先关闭 OCR，再通过既有配置启用 provider，随后另一次请求失败
- **THEN** 关闭时只能阅读图像，成功后使用该页真实 OCR 文字及原页定位，失败调用既有错误回调且不清空已确认数据

### Requirement: Platform neutral data and additive contracts

原生/Web MUST 使用相同 ReaderData、V5 annotations 和评论模型；原页 page-N、页内规范 UTF-16 offset、textId、px/percent 矩形、样式、createdAt 和关联语义不得改变。扩展只能增加可选字段，缺省仍按旧契约读取；iOS 专有对象/屏幕坐标/会话 ID 不得写入公共数据。平台无关适配 API MUST 使用原页、规范端点、页几何和能力声明，Android 原生实现无需添加 iOS 必填字段或迁移既有记录。

#### Scenario: Old and native records round trip
- **WHEN** 同一 PDF 的匹配 v2/v3/v4 历史数据及当前 V5 数据依次由 Web/原生读取、编辑和互读
- **THEN** 同一源范围及页坐标仍能定位，ID/关联及无关字段不变，旧 blob 原样保留；当前格式无编辑只读不重写，旧格式仅按已有规则迁移到现有新键，不能把 PDF 原生字符串偏移解释为旧规范 offset

#### Scenario: Mapping is not ready or is invalid
- **WHEN** 连字、双栏或重复文字页尚无可靠规范映射，或历史端点加载完成仍无法定位
- **THEN** 加载中保持最后稳定状态，失败明确提示；保留原始数据，不用相似文字或未经验证的下标重写历史高亮

#### Scenario: Future platform and optional extensions
- **WHEN** 平台适配器缺少某项可选能力，或旧记录缺少扩展字段且同时携带其他未知可选字段
- **THEN** 能力被明确标识为不可用，旧记录仍按原语义读取，无关可选字段编辑后保持，不要求 Android 实现 iOS 原生类型

### Requirement: Stable progress and durable session lifecycle

系统 MUST 保持现有快照键、信封优先级、revision/确认和旧数据保护规则。Layout 续读保存安全线原页/页内比例；Text 及模式互切按当前安全首行文字、无文字才比例回退。有效阅读位置变化 MUST 沿用 100ms 尾防抖及最长 1000ms 提交；退出/切文档必须采集稳定进度并等待落盘确认。失败不得卸载或虚报保存，损坏权威快照不得静默退旧键覆盖。后台只保证实际落盘结果。

#### Scenario: Resume and switch modes
- **WHEN** Layout 安全线上边界为原页 35%，首个可见源文字在 48%，用户重开或切 Text
- **THEN** 重开按 35% 几何续读，切 Text 按 48% 的源文字打开对应可视页；返回按 Text 当前首行对齐，合法范围内误差不超过 2 CSS px

#### Scenario: Failure while closing or replacing
- **WHEN** 用户有效移动后不足 100ms 就退出/切书且落盘失败，或 A 的延迟事件在 B 打开后到达
- **THEN** 前者保留可重试会话及最后确认数据，后者不修改 B 的界面/快照；重试成功后重开恢复最新进度与并发标注

### Requirement: Bounded resources and measured performance

页面显示、文本提取、缩略图和 OCR MUST 按需处理，离屏页面释放，活动跨页选择只保留所需文字。系统 MUST 在失败/卸载/切书时取消旧任务并释放自有缓存，不删除宿主 PDF 原件。开发验收 SHALL 提交同真机、同文件、同 Release 配置的各 5 次冷开及各 60 秒滚动对比：原生首屏中位耗时和峰值内存均不劣于旧 Web，至少一项改善 20%，无持续无界增长或崩溃。

#### Scenario: Large document performance acceptance
- **WHEN** 使用 200 页 PDF 分别测量旧 Web 与原生首屏和连续滚动，记录设备、系统、构建及文件哈希
- **THEN** 提供可复核报告且满足上述阈值，iOS Layout 的 PDF.js 页面 render 调用为 0，不以功能删减取得性能结果

#### Scenario: Replace a busy source
- **WHEN** A 存在渲染、文字提取、预览或 OCR 待完成任务，用户打开 B 或卸载
- **THEN** 旧结果被隔离，自有资源最终释放，源文件不变，不出现 A 的预览、菜单、进度或标注写入 B
