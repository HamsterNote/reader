# Design

## Context

动机见 proposal.md。目标仓库已存在 OpenSpec 目录，无活动 change、无主规格、无项目自带 propose 命令或技能，使用已安装技能及 CLI 默认 spec-driven schema。初始无 config.yaml；CLI 创建 change 时自动生成默认配置。

已读取的实现基线：
- `demo/epubForReader.ts` 从 epub-parser 获取中间文档，恢复图片顺序、alt、补充封面；`test/epub-parser-integration.test.ts` 为现有回归入口。
- `demo/pdfParserForReader.ts` 调用 pdf-parser 的 openDocument，并覆写内部 session/object 处理。`src/components/IntermediateDocumentViewer/` 自行处理 PDF 文本、坐标和页面懒加载。
- `src/types/selection.ts` 明确公开 selectionId 为稳定 `page-N`，运行时 scoped ID 不可持久化；范围包含 start/end offset、text、rectsBySelectionId 和样式。
- `demo/highlightStorage.ts` 写 v4（ranges/rects/paintings），读 v2/v3/v4；`src/types/readerData.ts` 包含阅读模式、裁切、隐藏页、绘图、书签和进度。`demo/App.tsx` 管理受控高亮及评论、文件级 localStorage。
- `DESIGN.md` 定义鼠标圆形手柄、触摸原生手柄、Popover、页面浏览器与字体控制等 UI 契约。
- 参考仓库 `native-reader` 的 README 和归档的 Foliate 替换方案使用 foliate-js，README 给出的 pin 为 `78914aef4466eb960965702401634c2cb348e9b1`。参考仓库的原生 PDF 模块不进入本项目。

## Goals / Non-Goals

**Goals:** 引擎负责文档展示；reader 保持交互、数据和 UI 的所有权。三条主线能够在统一协议和固定兼容样本上独立开发。

**Non-Goals:** 不照搬 native-reader 整套包、安全宿主或原生模块，不让引擎的 CFI、DOM ID 或 PDF 文本项索引替代公共数据；不移除其他格式阅读能力。

## Decisions

### 1. Expo 宿主与 Web 阅读层分开构建

建议保留 `src/` 的 DOM 阅读库，将现有 demo 整理为可构建的 Web 阅读入口；新增 Expo 应用入口负责选文件、持久化适配及 WebView 生命周期。Expo/React Native 依赖由兼容 SDK 的工具确定并锁定，增加 expo-dev-client 与 react-native-webview。保留现有库构建/导出以降低消费者迁移影响（这是本提案的保守假设，不是用户额外确认的需求）。

WebView 加载打包进应用的 HTML/JS/CSS、worker、字体和引擎资产，不依赖开发电脑的 Vite 服务或 CDN。构建脚本生成资源清单并校验路径；原生使用受控本地资源源，开发模式可使用有明确来源限制的调试源。PDF worker 在该资源源下独立加载并验证真实启动；不能以浏览器测试代替 WKWebView/Android WebView 验证。

替代方案：把 DOM 组件直接迁到 React Native 会改变交互且不满足本期 Web 技术路线；单纯嵌入远程网站不能交付自包含 dev client。

### 2. 共用消息协议与单一数据所有者

宿主持有已确认的文档数据及存储；Web 层持有瞬时选区、缩放和引擎状态。协议包含 version、sessionId、requestId、type、payload；消息至少覆盖 ready/open/restore/command/change/progress/error/dispose/ack。Web 首次 ready 后宿主发送文档描述和数据，restore 完成前不回写空数据。change 带递增 revision，确认后持久化，重复 requestId 幂等；文档更换生成新 session，拒绝旧 session 消息。

文件由宿主复制到受控缓存，以受控本地 URL/文件描述加载，不一次性通过 postMessage 发送大文件 base64。内存受限时使用分块传输和确认。关闭时取消加载、释放 worker、object URL 和旧资源；失败保留最后已确认快照，提供重试。Web 的 localStorage 通过可替换存储接口保留原有使用方式，原生持久化保存相同 JSON 内容和文件归属。浏览器沙箱中的旧 localStorage 不能被原生自动读取；用同文件历史 JSON 的导入/恢复验证兼容，不承诺跨容器自动迁移。

桥接仅暴露给受控外层阅读入口，校验消息结构、类型、会话和来源。出版物脚本禁用，出版物 iframe 与宿主能力隔离；拒绝非受信顶层导航，外链经宿主显式处理；本地资源只读且限制在当前缓存和应用资源根。不能照搬参考仓库依赖 Chromium 专有能力的出版物隔离方案作为 iOS 已支持证据，必须在两平台验证实际隔离与资源加载行为。

替代方案：两侧各自写数据会造成重复回调及空状态覆盖；桥接只传高亮文本会丢失定位、样式与评论关联。

### 3. EPUB 复用 Foliate 方法，保持旧坐标空间

参考 native-reader 对 foliate-js 的加载、打开、目录、重排和定位用法，在 reader 内固定可复现版本并保留许可证与来源记录，不增加对 native-reader 的发布依赖。Foliate 负责 XHTML/CSS/图片、目录、分页/滚动与字体重排。保留现有底栏、模式选择及适用的高亮/Popover/手柄交互，接口通过适配器连接引擎。

适配器为同一原文件保留旧 epub-parser 的逻辑页序和文本规范化规则，生成旧 `page-N`/offset 与 spine 文本位置的双向表，包含补封面及图片内容顺序差异。旧解析链路仅可用作兼容索引，不再负责主展示。Foliate CFI/Range 为可重建的内部缓存。新建标注也写旧端点结构；重排只重算显示坐标，不修改原始 range、ID 或评论关联。不能唯一定位的旧项保持原样并提示不可定位，不以相似文本静默匹配。兼容样本中可定位的旧项必须全部成功，否则不得完成迁移。

替代方案：直接持久化 CFI 或按 Foliate 可见页重新编号会破坏现有格式；简单全文搜索无法区分重复段落。

### 4. PDF 使用官方 viewer 组件，reader 叠加业务交互

使用同一锁定版本的 `pdfjs-dist` 核心、worker、`web/pdf_viewer` 及样式，由 PDFViewer/PDFLinkService/EventBus 等官方能力负责页面、文本层、链接、缩放和渲染队列。保留 reader 的工具栏与标注层，不将完整默认 viewer 的工具栏替换现有 UI，也不再沿用自定义 PDF 展示作为主路径。保留 Text 模式：从 PDF.js 文本内容派生兼容文本视图，Layout 页面由官方 viewer 展示。

按原 PDF 页号维持 `page-N`。建立旧文本规范化顺序到 PDF.js text layer Range 的映射，显式覆盖空格、换行、连字、旋转页和多栏；坐标通过同一 viewport 变换处理 px/percent、缩放、旋转及裁切。标注层不拦截原生选区手势，viewer 页面销毁后重挂载时按原数据重建。PDF 内置 annotation layer（链接等）与 reader 高亮分属不同所有者，不重复保存标注。

替代方案：仅用 getDocument/render 然后继续自建页面管理没有达到使用官方展示能力的目标；把旧矩形当屏幕像素直接复用会在缩放后错位。

### 5. 先兼容门槛，再三线开发，最后设备验收

先固定协议、公开类型及样本，再让 EPUB/PDF 适配器和 Expo 宿主分别实现；共享 `Reader` 路由、App 和构建脚本由集成负责人统一处理，避免三条主线覆盖同一文件。`tasks.md` 给出可转子任务的范围、依赖和验收，不在 propose 阶段建立或分派子任务。

## Risks / Trade-offs

- 旧 EPUB 逻辑页与 spine 不一致、重复文本或解析规则变化 → 固定旧解析依赖生成索引，逐条验证 round trip，无法定位时保留并提示，不丢弃。
- PDF 文本项与旧 offset 不同 → 同一 PDF 双解析生成兼容映射，增加空白、多栏、旋转和连字固定样本。
- 双解析的内存/启动成本 → 兼容索引按章节/页惰性生成并缓存，主展示使用引擎队列；大文件验证不做全文件 base64 复制。
- WebView 本地 worker、字体路径及触摸行为存在平台差异 → 以两平台 dev client 的真机/模拟器证据作为验收条件，记录设备和构建方式。
- DOM 重排破坏绘图/矩形锚点 → 维持旧逻辑坐标模型和适用模式，布局变化后投影到引擎空间；不得以移除工具规避。
- 本次未运行代码或设备测试 → 下列任务与规格是验收要求，不是已通过的结果。

## Migration Plan

1. 固定基线样本、历史 JSON 和交互矩阵，备份存储；建立只读旧数据索引。
2. 添加独立引擎适配器、Expo 宿主和资源流水线，在集成分支连接，不改旧 JSON schema。
3. 验证同文件旧数据恢复、新数据写回旧读入器、重复桥接、切文件与异常恢复。
4. 完成 Web 回归、库导出检查、iOS/Android dev client 安装与离线阅读证据，再替换默认路由并移除重复展示代码。
5. 失败时回滚引擎路由及 Expo 入口提交，继续读取原始快照；没有通过兼容门槛前不删除旧兼容读入器或原数据。本阶段不部署、不归档参考仓库。

## Open Questions

- Expo SDK、pdfjs-dist 和 Foliate 最终锁定版本由实现者依据实际兼容验证确定；必须记录版本和验证环境，不改变本规格。
- 可用 iOS/Android 设备型号在验收时补充；没有设备证据时不得宣称对应平台通过。
