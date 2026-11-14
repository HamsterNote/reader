# Proposal

## Why

现有 PDF Layout 依赖 pdfjs-dist 页面渲染，用户反馈性能逊于原生。第一期在 reader 仓内以 iOS PDFKit 承担页面显示，同时完整保留现有阅读、标注和数据兼容性，为未来 Android 原生实现留下平台无关契约。

## What Changes

- iOS Expo dev client 的本地 PDF Layout 切换到仓内新增的 PDFKit 渲染器；自绘文本选择、手柄、放大镜、选中/高亮 Popover，禁止系统选区 UI 和系统菜单。
- 沿用 ReaderData、V5 annotations、comments、宿主快照及现有存储键，仅允许新增可选字段，不重定义既有字段；Android 本期不实现原生引擎。
- 保留 pdfjs-dist Web 阅读器及 PDF Text 重排模式。iOS Layout 不创建 PDF.js 页面画布；可按需复用其规范文本提取，以准确兼容历史字符偏移。
- 一期功能以以下清单和自测基线验收；不能因原生实现困难静默删减。

## Capabilities

### New Capabilities

- `ios-native-pdf-reader`：仓内 PDFKit 渲染、平台无关适配契约、自绘交互、现有功能对齐及性能验收。

### Modified Capabilities

- `expo-reader-host`：修改“Dev client reads bundled Web content”，允许 iOS PDF Layout 使用仓内原生渲染，保留其他 Web 路径和离线交付要求。
- `reader-data-compatibility`：修改“Preserve interaction contracts”，消除其中 PDF Layout 使用原生手柄的过时描述，明确 PDF 自绘选择及原生/Web 互读约束。

## Impact

只涉及 reader 仓。调研基线为 `82ada7e06c869fa4a43fdde9f7856c28dd666420`；以下是源码观察，未声称真机验证通过。项目使用 OpenSpec 1.13.1、`spec-driven`，未发现仓内另附 propose 命令/技能，采用本次提供的 openspec-propose 技能与 CLI 模板。

| 层 | 现有定义/实现及可复用部分 |
| --- | --- |
| 公共数据 | `src/types/readerData.ts`：模式、工具、裁切、隐藏页、标注、进度、书签；`src/types/selection.ts`：原页端点、分组及矩形；`src/types/comments.ts`：评论及高亮关联 |
| 标注与历史 | `src/storage/highlightStorage.ts`、`annotationStore.ts`：V5 校验、旧 v2/v3/v4 只读迁移；`src/components/Reader/useAnnotationHistory.ts`：统一历史 |
| 快照与持久化 | `src/host/readerSnapshot.ts`：annotations/readerData/comments 信封及字段优先级；`src/bridge/hostSession.ts`：会话、revision、确认；`src/host/readerDataStore.ts`：按 fileId 的 v2 权威快照；`app/src/native/storage.ts`：文件持久化及失败恢复 |
| 原生宿主 | `app/src/screens/ReaderScreen.tsx`、`app/src/components/ReaderWebView.tsx`、`app/src/native/documents.ts`：选文件、文档记录、退出保存屏障。当前 PDF 仍走 WebView，未发现仓内 PDFKit/Swift 阅读组件；PDFKit 是新增工作，不计作已有能力 |
| Web PDF | `src/pdf/PdfDocumentViewer.tsx`、`pdfTextMapping.ts`、`pdfSelectionSerializer.ts`、`pdfOverlayGeometry.ts`、`usePdfPreviews.ts`、`usePdfOcr.ts`：按需加载、规范文本、坐标、预览、可选 OCR |
| 自绘交互 | `PdfTouchSelectionHandle.tsx`、`pdf/PdfTextHandle.tsx`、`components/selection/pdfHandleDrag.ts`、`DefaultPopover.tsx`、`popoverPosition.ts` 及 `webview/src/ReaderSurface.tsx`：复用行为、样式和回调，替换页面几何来源 |

### 功能对齐清单

“做”指一期交付现有适用行为；不是所有功能均改写为 Swift。Web 可配置能力仍按调用方现有开关提供，不把新增产品功能混入对齐范围。

| pdfjs-dist 版现有操作/能力 | 第一期 | 实现边界/依据 |
| --- | --- | --- |
| 本地 PDF 打开、离线读取、加载/错误/重试 | 做 | iOS Layout PDFKit；宿主导入链及数据不变 |
| 连续滚动、缩放、原页码/上一页/下一页、页范围 | 做 | 原页号一基；跳过隐藏/范围外页；边界不循环 |
| 具有固有旋转的页面、裁切与缩放后的叠层定位 | 做 | 保留原页坐标和 px/percent 单位，不写屏幕坐标 |
| 页浏览缩略图、未访问页预览、定位与重试 | 做 | PDFKit 按需生成；缩略图故障不拖垮正文 |
| PDF 链接与目录目标、源链接解析 | 做 | 复用 `pdfSourceLinks.ts` 语义；内部跳转遵守过滤，外链交宿主受控打开 |
| Layout/Text 互切、Text 字号与按钮分页 | 做 | Text 保留现有 Web 重排；互切按当前安全首行文字，无文字按比例 |
| Text 禁止正文滚动/越界自动翻页 | 做 | 不把 Layout 边缘自动滚动带入 Text |
| Layout 长按选字、跨行跨页、端点越过固定端 | 做 | 自绘选区与手柄；连续拖选包含中间页并支持缓存回收 |
| 已有高亮激活、范围调整、颜色、删除、精确跳转 | 做 | 保留 ID、端点、createdAt、评论关联与原颜色 |
| 选区确认、颜色预览、选中/高亮 Popover | 做 | 默认高亮/颜色，已有高亮颜色/删除及已配置评论入口；支持既有自定义内容 |
| 手柄放大镜、可访问名称、touch/mouse/pen 区分 | 做 | 遵循 `reader-text-selection-interaction`，仅 touch 显示文字镜片 |
| Text 页内选字及历史跨页高亮显示/编辑 | 做 | 保留源区间及 selectionGroup；离屏端点不补柄 |
| Text 拖选自动延续到下一可视页 | 不做 | 当前本就不支持；按钮分页与草稿生命周期保持原样，不冒充功能回退 |
| 矩形创建/调整/样式/删除/跳转与既有快照操作 | 做 | 复用公开 rect 契约及当前实际暴露的工具 |
| 手绘、形状、编辑、擦除、页清空、颜色与双指导航 | 做 | 保留正式 painting 文档/工具链；不换 PencilKit 私有存储 |
| 高亮/矩形/绘图混合撤销重做及受控回显 | 做 | 一次提交一条历史，切模式不清历史，切文件重置 |
| 评论新增/回复/修改/删除及高亮关联 | 做 | 沿用宿主评论组件与现有配置入口，不另造原生评论模型 |
| 精确书签/旧页书签、Layout/Text 续读、安全区 | 做 | 既有字段优先级、防抖、退出保存屏障不变 |
| 全局/单页四边裁切，隐藏页、分组恢复/全选/5 秒撤销 | 做 | 隐藏页不占正文高度，恢复草稿不入标注历史 |
| 可选 OCR provider、已有 OCR 文字层与错误回调 | 做 | 只有现有开关启用才调用；图像由 PDFKit 提供；不新增 OCR 服务 |
| 旧标注 JSON 导入、V5 保存、已有导出数据接口 | 做 | 原始旧 blob 不变，保留未识别可选字段；不新增 PDF 文件内嵌标注导出 |
| 文件切换、已配置文件列表/单双栏位置隔离 | 做 | iOS 中已暴露入口均路由同一能力，按 fileId/pane/session 隔离 |
| Web/Android 现有 pdfjs-dist 阅读 | 做（保留） | 本期不替换引擎、不删除依赖或 Web 公共入口 |
| Android 原生渲染与平台专有定位信息 | 只留数据结构口子 | 平台无关 API 与可选能力探测；不新增必须的 iOS 字段 |
| 全文搜索、OCR 服务、签名/表单编辑、PDF 写回、DRM 解锁 | 不做 | 未从本次基线识别为已交付 PDF 阅读操作；不扩大范围 |

### 自研组件的一期边界

1. **文本选择组件**负责命中、草稿、跨页选区、高亮范围编辑、自绘填充/20px 圆柄/40px 热区、仅触摸放大镜和取消事务。用规范源字符端点驱动，而非把 PDFKit 的字符串下标写入旧 offset；禁用系统可见选区/手柄/菜单。保留 Layout 边缘自动滚动，Text 保持按钮分页；不承担 OCR 识别或修改 PDF 原件。
2. **Popover 组件**负责草稿确认、颜色及已有高亮的颜色/删除/已配置评论入口，复用默认与自定义插槽语义。选区锚点随滚动/缩放/裁切和安全区更新，切书/失效后关闭；一次点击只提交一次。采用自绘 HTML/React UI，不用 UIPopover、系统复制/查询/分享菜单；不扩展现有宿主未配置的操作。

### 交付边界与合理假设

- 一期在 `reader/app` 新增本地 Expo PDFKit 模块与宿主适配；文档和代码均只落 reader，不引入其他仓的代码、结构或依赖。
- iOS `ReaderScreen` 的本地 PDF **Layout**（含书库打开/重开/已接入文件切换）默认原生；PDF **Text** 继续 Web 重排。EPUB、Web 库/演示和 Android 保留当前路径。Expo Go 缺原生能力时明确提示使用 dev client；不静默回退掩盖验收失败。
- pdfjs-dist 保留用于 Web/Android、Text 及规范文本/链接兼容；iOS Layout 不使用其页面渲染。此为“原生 PDF 页面显示”的一期解释，列为提案设计假设，未宣称用户已确认彻底移除 JS 提取。
- 不变更现有 PDF 导入大小、来源授权与错误语义，不凭其他实现额外增加限制。加密 PDF 沿现有可识别错误处理，本期不新增密码/DRM 功能。

### 冒烟 / 自测用例

开发完成后在 iOS dev client 执行；准备仓内 `test/compat/fixtures/pdf/{two-column,ligature,rotated}.pdf`、`test/fixtures/pdf/{positioned-runs,two-page-positioned-runs}.pdf`、v2/v3/v4 高亮样本，以及开发阶段补充的扫描页、200 页 PDF、坏文件和 V5 宿主快照。导入标注使用与样本 PDF 匹配的文件记录；每项保存前后导出宿主测试快照比对，禁止只凭截图判定数据兼容。

| 编号 | 可执行步骤 | 期望结果 | 判定方式 |
| --- | --- | --- | --- |
| S01 路由/离线 | 安装 dev client，导入 PDF/EPUB，断网分别打开，PDF 切 Text 再回 Layout；在 Web/Android 重开 PDF | iOS Layout 原生、其他路径可读，首次页显示后才 ready | 宿主 renderer 调试事件 + 截图；iOS Layout 的 PDF.js 页面 render 调用数为 0 |
| S02 导航/预览/链接 | 多页 PDF 缩放、首末页/页码跳转、点未访问页缩略图和内部/外部链接，失败预览重试 | 原页号正确，边界不循环，外链受控；失败不清正文/数据 | 路由及页事件、预览截图、宿主打开回调 |
| S03 自绘确认/编辑 | 长按定位组文字，跨行拖两端、越过固定端，改色确认；点高亮调整、评论、删除 | 无系统手柄/菜单；每次仅一次提交，编辑保留 ID/关联 | 真机录屏、回调计数和快照 diff；`mno pqr stu v` 源区间仍为 [38,51) |
| S04 连续跨页 | Layout 从第 1 页拖至第 12 页，在上下边缘停留，释放确认；切模式再回 | 自动滚动随距离加速、释放即停；源端点与中间页内容完整 | 端点/文本/逐页矩形断言，记录回收及保留缓存；Text 拖出页边不翻页 |
| S05 手柄/镜片 | touch/mouse/pen 拖草稿及历史高亮两端，50/100/200% 缩放、两个共享视口/安全区重复 | 仅 touch 有镜片；圆柄20、热区40、镜片半径38±1、中心距76±2、倍率2；镜内无选区 | 真机录屏逐帧几何测量与镜片重绘计数；执行共享规格全部场景 |
| S06 历史互读 | 导入匹配 v2/v3/v4，原生读取/改色保存，Web 读取；Web 新建再原生读，覆盖连字/双栏/旋转 | ID/offset/单位/样式/评论不变；新 V5 被双方正确恢复 | 双向语义快照断言、旧 blob 哈希不变；V5 无编辑只读不写，旧样本仅执行既有迁移写新键 |
| S07 绘图/矩形/历史 | 缩放裁切旋转页画 A、建高亮 H、另一页画 B/矩形，撤销重做；擦除/清空并重开 | 统一顺序；颜色正确，取消不保存，删除不复活 | 事件/历史计数、V5 文档比较；输入/回放与定位点误差 ≤1 CSS px |
| S08 裁切/隐藏 | 全局及单页裁切；隐藏200页中的2..199；切编辑，分段模态全选/取消/确认，5秒内撤销 | 无隐藏页正文占位/渲染；编辑不改高度；仅确认改集合，撤销保留其他最新数据 | 布局高度/渲染请求计数、hiddenPages及其他字段 diff |
| S09 进度/互切 | Layout 停页内35%，可见文字48%；切Text、翻可视页、改字号/方向再返回，100ms内退出重开 | Layout续读几何35%；互切按安全首行；Text保留字符位置 | 实际可见行与快照断言；返回文字对齐误差≤2 CSS px，边界取合法夹取 |
| S10 保存失败 | 注入一次存储失败，退出；重试成功再开；模拟后台及进度与绘图并发 | 失败不卸载/不虚报成功；重试保留最新各字段，旧原件完整 | 写入/ACK时序、revision及重开快照；100ms尾防抖/1000ms最长提交断言 |
| S11 异常/隔离 | 坏PDF、无读权限、加密文件；A加载/预览中切B或卸载；损坏权威快照后开文件 | 分类提示/重试，无A残影/迟到写入；坏快照不退旧键覆盖 | 故障注入日志、fileId/session断言及磁盘前后比较 |
| S12 OCR/无文字 | 扫描页关闭OCR长按，再配置既有provider并返回文字；另注入provider失败 | 关闭时无伪文字；启用后可选字/标注，错误回调不清数据 | provider调用计数、源页映射、标注恢复及错误事件 |
| S13 文件/栏隔离 | A/B往返；双栏同文件及不同存储同名文件；保存失败时切换 | 各栏位置/历史独立，只有活动栏写最近位置；失败保留原文件 | storageId/path/pane/session轨迹及快照断言 |
| S14 性能 | 同一真机/同一PDF/同一Release配置，旧Web与原生各5次冷开并各连续滚动60秒 | 原生首屏中位耗时和峰值内存均不劣于基线，至少一项改善≥20%；无持续内存增长/崩溃 | Instruments及首屏时间报告，记录设备/iOS/文件哈希；这是拟定门槛，未执行 |

所有适用项均需通过；Web/Android/EPUB 保留回归。真实 iOS 系统菜单、手势、滚动同步和性能不能由 Linux 单测替代；本次 propose 仅验证文档，以上结果留待开发自测填写。
