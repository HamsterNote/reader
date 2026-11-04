# Design

## Context

动机见 proposal.md。项目 OpenSpec CLI 为 1.13.1，配置为 `spec-driven`；仓库未发现项目附带的 propose 命令/技能，遵循运行环境提供的 openspec-propose 及 CLI 返回模板。没有未归档 change。

只读定位得到的现状：

| 位置 | 已有行为与缺口 |
| --- | --- |
| `src/types/readerData.ts` | `ReaderBookmark` 已有文字锚点或 `pageNumber + verticalPercentage(0..100)`；Text 进度只有页码和可选 anchor。 |
| `src/components/Reader/useLayoutReadingProgressSave.ts` | Layout/Text 共用 100ms 防抖、1000ms max-wait，resetKey/卸载 cleanup 会 flush；没有供关闭握手调用的显式 flush。 |
| `src/components/Reader.tsx` | 统一调度进度并将完整 ReaderData 回调给消费者；需保留最新标注，避免两种进度 pending 相互覆盖。 |
| `src/pdf/PdfDocumentViewer.tsx:1006` | 采集 currentPageNumber 下第一个 bottom >= 容器 top 的 span；未检查视口底/左右边界，span 起点也未必是实际可见行字符。文字恢复按整个 span scrollIntoView。 |
| `src/components/EngineDocumentViewer.tsx:710` | 无 anchor 时使用 `verticalPercentage: 0`；PDF 的 null anchor 回调被丢弃，同页无文字移动可能不上报；恢复有 restored/progressEnabled 防护。 |
| `src/epub/foliateEpubEngine.ts` | relocate range 转兼容源字符，capture 返回 currentAnchor；章节有文字但当前屏只有图片时，不能用章节 text 存在与否判定视口有字。需暴露完整位置采集/比例导航。 |
| `src/components/IntermediateDocumentViewer/IntermediateDocumentViewer.tsx` | 已有 `resolveNativeLayoutBookmark`、锚点捕获及百分比恢复；应复用语义并回归，不另建格式专用存储。 |
| `webview/src/ReaderSurface.tsx`、`src/host/readerSnapshot.ts` | onDataChange 序列化完整 change；恢复先读 progress，再由 envelope.readerData 同名字段覆盖。 |
| `webview/src/main.tsx`、`bridgeClient.ts` | flush command 等输入静默及桥接 ack；Reader 防抖仍可能在桥接排空之后才 flush。 |
| `src/bridge/hostSession.ts`、`src/host/readerDataStore.ts`、`app/src/native/storage.ts` | revision/会话校验、持久化后 ack；权威键 `reader.host.v2.snapshot.<fileId>`，文件临时写入/备份替换；保留这些机制。 |

已有 `test/reading-progress.test.tsx` 验证调度和卸载保存，PDF/EPUB 引擎、bridge、host-store 测试可扩展。以上是源码观察，尚未运行产品复现或实现测试。

## Goals / Non-Goals

**Goals:** 把“可见内容采集 → 稳定公共位置 → 恢复 → 完整落盘确认”连成同一契约；同页移动也有新进度；不同文档、模式和异步代次不会串写。

**Non-Goals:** 不重做分页、导航、标注或 OCR，不引入云同步、全书文本预加载、全局滚动百分比；不承诺无法映射的扫描图像文字锚点；不实现任务、不发布或迁移用户存储。

## Decisions

### 1. 统一采集完整位置，而非只采集可选 anchor

采集结果区分 `ready(text|page)` 与 `pending/failed`。后两者保留最后稳定位置，不等同于无文字。底层为 PDF/EPUB 提供内部完整位置接口；继续保留旧 captureTextAnchor 供既有消费者使用。上层不再忽略 null anchor 或自行补 0。

阅读视口 V 指实际正文可用矩形：容器内边界减去底栏占用，EPUB iframe/分页列需转换到统一坐标后与 V 求交；不采集工具栏、侧栏、高亮浮层或隐藏页的文字。仅相交面积大于零、非空白、可映射至源字符的字形参与。取可见字形顶边最小的一行，同一行按既有阅读/源文字顺序取首个可见字符；部分露出的首行仍算首行，多栏仅取当前可视列。不能只按 DOM 顺序找 span，也不能选视口下方最近文字。

对 span 内多行用字符 Range 几何与既有源偏移映射定位，PDF 使用原始字符偏移，不能使用补空格后的展示偏移。EPUB 继续用兼容索引映射逻辑页和字符，不保存 CFI、iframe 节点或临时列号。

视口内有可见文字但索引未就绪时等待该页文字层/映射就绪；失败保留原进度并暴露恢复/加载失败状态。可提取文字完成且无可定位文字的扫描图、纯图片/空白视口按 page 位置处理，不新增 OCR 工作。

选择完整位置接口的原因是“没有文字”也必须携带页号及非零比例，不能继续沿用 null 表示所有状态。

### 2. 文字优先；无字比例只相对目标页面

若整个 V 有可定位文字，直接取上述首行，即使 V 顶部是图片/空白，或首行属于下一页，也保存该文字所在源页。

仅在 V 无可定位文字且页面几何就绪时，选穿过 V.top 的首个可见允许页面；若 V.top 位于页间空隙，选 V 内下一页面；同一高度多页面按阅读顺序。目标页显示矩形为 P，保存：

`verticalPercentage = clamp((V.top - P.top) / P.height * 100, 0, 100)`。

保存数值不强制取整；P 是当前方向、裁切后正文页面显示框，排除页间距，V/P 使用相同 CSS 坐标系，因此缩放不会被重复计算。高度为 0、无可见页面或页面尚未加载时不生成位置。比例表示当前显示页面纵轴位置；改变裁切/旋转后按新显示框重投影，不能承诺同一物理图像点。

可滚动布局恢复文字时，令锚点字符所在行顶对齐 V.top，边界允许范围内误差 <= 2 CSS px；部分可见行恢复为完整行，不保留原遮挡像素。比例恢复令 `P.top + P.height * percentage/100` 对齐 V.top，最后夹取合法滚动范围；页尾无法顶对齐时停在最大合法滚动位置。保持既有水平位置/缩放语义，本次不承诺额外水平精确恢复。

EPUB/PDF Text 保留离散可视分页：相同排版恢复同一可视页；重排后恢复到包含原锚点的页。EPUB 的逻辑页可能对应一整章，横向列的 DOM top 相同，不能直接套屏幕 Y 得到全为 0 的比例：须把该逻辑页所有分页片段按阅读顺序展开为纵向坐标，分子是当前片段之前的内容高度之和加当前视口顶端在片段内的偏移，分母是该逻辑页全部片段内容高度之和（排除列间距；不含分页器额外空尾列）。只在内存用当前列求坐标，不持久化列号。恢复用比例乘以新排版的展开高度，打开包含该位置的片段；片段边界取后一片段，100% 取末片段。这样无字屏可以保存非零逻辑页内比例，而不混入全书进度。固定版式无内部滚动的单页只能恢复该页，其位置比例自然为 0；PDF Text 无字原页的单个占位页同样为 0。不能为顶端对齐而强制章节滚动或破坏分页。替代方案“页码/全书 scrollTop 比例”会丢失同页位置或受重排影响，因此不采用。

### 3. 加法扩展与旧数据读取次序

- Layout 沿用 `ReaderBookmark`，不增加第二份规范位置字段。Text 的 `ReaderTextReadingProgress` 增加可选 `verticalPercentage?: number`；有 anchor 时其优先，无字时才写比例，缺少比例视为旧页首。
- 保留当前模式优先：Layout 先有效 layoutReadingProgress，再 virtualPaper.anchor；Text 先 textReadingProgress 的有效 anchor，再同记录比例，再 currentPageNumber 页首；该模式无记录才使用已有模式切换的公共源页/锚点逻辑。历史纯 virtualPaper x/y/scale 在支持它的旧布局继续原变换恢复；PDF/EPUB 引擎无法解释的变换不伪造字符或比例。
- 信封同名字段仍以 readerData 优先于独立 progress。读取时验证正整数页号、有限比例、非负源 offset 和页号一致性；有限越界比例夹至 0..100。无效锚点可按同记录有效比例/页号降级显示，不能直接改写原记录；隐藏/越范围目标使用原导航的允许页面边界策略，并保持原记录，直到用户有效导航。
- 恢复时锚点失效先等目标就绪并尝试稳定源偏移定位，失败退到同记录比例（若有）或该源页页首并显示无法精确恢复提示；保留原进度，不把相似文字当作成功。全无有效位置才显示默认首个可读页。
- 旧记录只读转换，用户下一次有效移动才以现字段保存。新字段旧客户端可忽略，不承诺旧客户端恢复新增精度；不修改桥接版本、权威键或旧 blob，不触发整库迁移。新权威快照损坏继续走既有错误流程，不静默回退。

采用加法扩展而非新进度信封/新键，是因为 Layout 已有所需结构，Text 仅缺无字比例。

### 4. 保存策略覆盖 Reader 与宿主两层队列

滚动每动画帧至多采集一次；采集稳定位置后沿用 100ms 尾部防抖，连续移动从首次 pending 起最长 1000ms 提交最新位置。成功翻页、目录/书签/高亮跳转使用同一调度；比较完整位置而非仅页号去重。恢复、重排和失败导航期间不发布临时结果。重排保留已有稳定锚点，等待有效几何后恢复；下一次真实导航解除保护。

为 Reader 添加可选的进度控制句柄，能“采集当前稳定位置并冲刷”。保存 hook 暴露内部 flush；原有 props/回调仍可用。多个 pending 模式进度按字段补丁合并至最新 ReaderData，再输出完整快照，保留同一时刻的新高亮、绘图、评论和书签。排程携带文档 resetKey/代次，清理旧任务时只能写旧文档对应回调。

正常关闭顺序：冻结新输入 → 等当前手势及导航稳定 → 调用 Reader 采集/flush（尚未完成恢复则仅保留原位置）→ ReaderSurface 同步更新 current 并发送完整 change → 排空桥接待发送/未 ack 队列 → 宿主持久化成功 ack → ready → dispose → 卸载。不能依靠卸载 cleanup 完成正常关闭。失败/超时返回现有 unconfirmed，保留页面和会话并允许重试。

切模式前 flush 当前稳定位置；切书必须先结束旧书关闭链路再替换。Web `visibilitychange(hidden)`/`pagehide` 与原生 AppState inactive/background 请求非销毁式进度 flush；复用已有 command flush/resume 握手，完成或超时后解除 draining，不卸载或重建会话，并串行化与显式关闭的竞争。普通 Web 库在页面隐藏时向消费者回调，实际异步落盘责任属于消费者。不可控进程强杀只保证最后成功落盘的位置，不伪称 hidden 事件可保证完成异步写入。

### 5. 验收与独立行为切片

tasks 按旧记录重开、PDF 首行重开、无字比例重开、EPUB/Text 分页重开、关闭/后台保存五种可独立观察行为组织；每片包含数据/采集/恢复/针对性验证，不按类型/前端/宿主分层拆票。允许前片提供后片基础，不要求每片是独立 PR。

布局相同的文字验收以字符身份和首行对齐为准；分页验收以所在可视页为准；比例验收以公式投影误差 <= 2 CSS px 为准，边界取 clamp 后结果。覆盖同页两个位置、跨页、重复文字、部分可见行、横向移出文字、图片间隙、50%/100%/200% 缩放、320px/宽屏、旋转/裁切和窗口/字体变化。自动化扩展既有测试，实际几何补浏览器/设备验证，jsdom 断言不能代替真实渲染。

## Risks / Trade-offs

- [字符 Range 几何开销] → 只扫描当前可见页/列，帧级合并；不为进度提取全书正文。
- [文本层晚于页面显示] → 区分 pending 和真正无字，等待当前页加载；恢复过程不覆盖原记录。
- [正文分页与“首行顶对齐”存在天然差异] → 保持已发布按钮分页契约，以包含原锚点的可视页为明确验收边界。
- [多次完整快照竞争丢字段] → 最新快照上合并各进度补丁，revision 保持单调；用并发标注+进度测试验证。
- [进程终止、后台冻结导致未确认数据丢失] → 1000ms 最大等待、后台尽力冲刷、正常关闭确认；只报告真实落盘结果。

## Migration Plan

apply 阶段先加入旧记录读取与增量字段，再逐行为接通采集/恢复/flush；使用现存快照及新增边界样本回归，保持原始旧数据不动。发布沿项目既有流程，本提案不执行。回滚代码后旧客户端仍读原字段；可忽略新增比例但精度可能退化，不删除用户新快照来实现回滚。

## Open Questions

无阻塞问题。100ms/1000ms 取自现实现，2 CSS px 为本提案建议验收容差；“旋转后比例以新显示框为准”和“分页重排后锚点在页内即可”为结合项目契约的设计假设，尚未作为用户另行确认的要求。
