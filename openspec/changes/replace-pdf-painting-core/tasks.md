# Tasks

全部为待执行任务，本次 propose 未执行实现。第 1 组由 painting 工程师负责；reader 集成以其正式发布包为前置。新增 API 的名称和参数由该工程师交付，本 change 只维护同一套能力契约。

## 1. painting 能力与正式发布前置

- [ ] 1.1 painting 工程师交付旧 DrawingValue/旧文档到 EditorDocument 的增量迁移 API；用 0.4.0 实际数据和 reader 的真实 v4 fixture 验证 ID、坐标、样式、顺序、文本/图片等内容保真，重复调用稳定，非法/不支持输入明确失败且不静默丢弃。
- [ ] 1.2 painting 工程师交付 PDF 页锚定增量能力，明确基准页/显示页几何、变换、滚动、旋转、裁切和 DPR 单位契约；验证输入与回放定位误差 ≤1 CSS px，显示变换不改文档坐标，并覆盖页切换/重新挂载。
- [ ] 1.3 painting 工程师验证新版表面透明覆盖、禁用输入、落笔颜色冻结及多指取消能力，必要时以增量 API 补齐；用现有新版消费者回归证明 API 未被破坏。
- [ ] 1.4 painting 工程师正式发布 minor 版本并提供版本号、公开导出/签名及测试结果；在本 change 的交接中记录实际版本和几何/迁移契约，以 npm 可下载的正式包和导出检查验证，不用 git ref 或本地 link 作为完成依据。

## 2. reader 新格式与一次性迁移

- [x] 2.1 更新 painting 依赖及锁文件至 1.4 的正式确定版本；从实际安装包验证迁移、页锚定和新文档公开导出，与 1.4 交接一致，并确认生产依赖无 git/file/link/workspace 替代。
- [ ] 2.2 在标注存储层实现 design.md 的 V5 容器、校验及新键读写，保留旧容器只读入口；用存储测试验证范围/矩形字段不变、完整新文档往返不丢字段，损坏/未知新版本不会降级覆盖。
- [x] 2.3 实现按文件的新键优先和首次迁移编排，仅把旧绘图原值与所需页身份/几何交给库；测试 v2/v3/v4 输入、未渲染页、重复打开/重试、失败不写半成品及迁移成功后旧原件字节不变，reader 不含旧对象类型映射。
- [x] 2.4 将 demo/App.tsx 的绘图、高亮、矩形、历史、导入/导出和清空入口统一转为新键；用 demo 测试验证每个入口只写新格式，确认后的空集合重开仍为空，localStorage quota 失败不会伪报成功。
- [ ] 2.5 更新 readerSnapshot、ReaderSurface 及原生 ReaderDataStore 的新快照键与新旧读取优先级，冻结旧 highlights 原件；验证重启/重载使用新快照，其他 readerData/comments/扩展信息不丢失，原旧记录不经保存入口重建。
- [ ] 2.6 为宿主新键提供完整替换、按文件串行写入与失败恢复；测试中断、写入失败和重试后只可见完整旧状态或完整新状态，无半写 JSON，旧 blob 完全不变。
- [ ] 2.7 沿 bridgeClient/hostSession 接入迁移和新文档保存，落盘后 ack 才推进 confirmed snapshot；桥接测试验证同 requestId 幂等、pendingChange 合并、正常关闭待确认提交、会话切换隔离及初始化不空写。

## 3. reader 单一新版绘图集成

- [x] 3.1 将 ReaderData、ReaderPagePaintingMap、页面 props、公开绘图回调及导出统一为新版文档/工具模型；更新 demo/WebView 调用方，通过类型检查及回调测试验证新负载与非绘图 API 语义，无本地旧类型 shim。
- [x] 3.2 替换 PageDrawingLayer 的旧 value/onChange/controller 实现，按文档/页身份维护新版控制器、提交订阅和资源释放；测试受控回显不重复提交、跨页快速更新不互相覆盖、取消输入不持久化，移除旧 sanitizer/scaleDrawingValue。
- [x] 3.3 替换 DefaultBottomBarControls 的旧 PaintingController 绑定，统一现有 reader 工具栏颜色与新版工具设置；测试 A→B 换色、落笔中换色、受控更新、切页和重挂载后新笔迹颜色正确、旧笔迹不重染且无回调循环。
- [ ] 3.4 在 PdfDocumentViewer/PdfPageOverlayLayer 中向库传递页面几何及当前变换，更新缩放/滚动/分页/旋转/裁切上下文；真实表面集成测试验证透明覆盖和定位，reader 不新增逐点换算、绘图专用逆矩阵或 DPR 坐标写入。
- [ ] 3.5 将 Page、IntermediateDocumentViewer、EngineEpubLayoutLayer、PageBrowserDrawingPreview 及其他全部共享调用点迁入新版路径；验证 EPUB 和其余基线格式的适用绘图/预览可用后，搜索并清除旧组件、旧模型分支与旧 API 引用，保留非绘图坐标适配。
- [ ] 3.6 接入新版表面的输入启用和手势取消能力；测试单指正常提交、第二指加入不误落笔、切换工具取消未提交笔迹、非绘图模式不阻挡选字/链接及双指导航。

## 4. 跨库验收与回归

- [ ] 4.1 用正式 painting 包及真实旧 PDF v4 fixture 完成迁移前后对比，补齐手绘、形状、文字、图片样本；记录颜色、位置、顺序与关联保真、稳定 ID 和失败语义结果，证明 reader 未自行修复旧对象。
- [ ] 4.2 在真实 Web 浏览器及 iOS/Android WebView 执行 PDF 定位矩阵：50/100/200% 缩放、顶部/滚动后、不同页尺寸、回收、固有/显示旋转、裁切、DPR 1/2/3 与可用鼠标/触摸/笔输入；记录定位点误差 ≤1 CSS px 及往返操作后存储坐标不漂移。
- [ ] 4.3 验证绘制/编辑/删除/清空/库支持的撤销重做→保存确认→退出→重启重开，包含迁移提交前后中断、ack 丢失、重复消息、新键损坏和文件 A/B 切换；检查无丢失、复活、重复或跨文件污染。
- [ ] 4.4 用旧版 reader 读取冻结的原 v4 数据，再用新版读取新键，验证旧版只显示升级前状态、新版显示最新状态，两个记录互不投影或双写；保存旧原件字节不变性证据。
- [ ] 4.5 运行 `yarn typecheck`、`yarn lint`、`yarn test:run`、`yarn build:lib`、`yarn host:check` 及扩展后的浏览器验收；记录实际结果，检查发布构建无旧绘图路径和未导出包内 API 依赖。

## 5. 交接与发布说明

- [ ] 5.1 补充 reader 绘图公共类型/工具枚举/回调升级说明、V5 键及恢复策略、旧 App 可见性与回滚限制；核对内容与本 change 三份 delta 一致，并引用实际 painting 发布版本及 API 交接。
- [ ] 5.2 汇总库契约、reader 回归、设备矩阵及存储故障注入结果供评审；逐条核对“reader 无旧绘图兼容分支、库承担页锚定、只写新格式、旧原件保留”验收线后再申请验收。
