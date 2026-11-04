# Tasks

以下均为后续 apply 工作，当前尚未执行。按行为切片，依次复用前片基础；每片均包含可观察的恢复结果与针对性验证，不按前后端层次拆分。

## 1. 旧进度重开仍可用

- [x] 1.1 在 `readerData.ts` 为 Text 进度增补可选 verticalPercentage，接通 `readerSnapshot.ts` 与 Reader/引擎恢复入口的只读规范化及当前模式优先级；扩展旧快照测试，验证 Layout 锚点/比例、Text 页码/锚点、virtualPaper.anchor、旧布局纯变换均可重开，readerData 同名字段仍优先，无初始化迁移写入。
- [x] 1.2 接通无效/过期锚点的等待、失败提示及显示回退，保留原存储；以非有限比例、越界比例、失效字符、隐藏/范围外页和损坏权威快照测试验证夹取/既有边界策略，不能静默覆盖或绑定重复文字。

## 2. PDF 同页重开保持首行文字

- [x] 2.1 在 `PdfDocumentViewer.tsx` 和 `EngineDocumentViewer.tsx` 接通完整位置采集/恢复，按正文可用矩形、字符 Range 与源偏移判定首行；保持 captureTextAnchor 旧接口，扩展 `test/pdf-viewer/pdf-document-viewer.test.tsx` 验证同页 A/B、多行 span、半露首行、跨页和横向离屏，不选下方离屏文字。
- [x] 2.2 将完整位置变化接入 Reader 保存调度，去重比较字符而非页号，并保护加载/恢复/回收代次；用引擎集成测试验证同一页两个位置分别保存重开正确，迟到文字层和临时页首不改进度。
- [x] 2.3 在真实浏览器用多行和重复文字 PDF 验证字符身份及首行对齐，记录 50%/100%/200% 缩放、320px/宽屏结果；合法滚动范围内误差 <= 2 CSS px，边界使用夹取结果，确认页面资源仍按需加载。

## 3. 无文字视口重开保持页内比例

- [x] 3.1 为 PDF 完整位置采集补齐 ready(page) 与 pending/failed 区分，修复 null anchor 被上层丢弃及固定补 0；接通独立于文字层成功渲染的页几何恢复，以扫描页、混排插图和纯空白视口测试验证非零比例往返，目标页迟到时不覆盖旧值。
- [x] 3.2 统一原有 `IntermediateDocumentViewer` 页框语义与需要的共享工具，保留既有其他格式阅读路径；用页间隙、页尾、跨两页、旋转/裁切、零尺寸和缩放场景验证公式、合法边界及 TXT/Markdown/DOCX/图片进度回归。
- [x] 3.3 在真实浏览器对目标页 40% 和近页尾分别保存重开，验证多种缩放下比例投影误差 <= 2 CSS px，改变旋转/裁切按新显示框投影；检查没有全书滚动比例或因 text layer 缺失导致的挂起恢复。

## 4. EPUB 与 PDF Text 分页重开保持内容

- [x] 4.1 在 `foliateEpubEngine.ts` 及 `EngineDocumentViewer.tsx` 接通当前可视列真实首行锚点与逻辑页内比例导航；无字章节片段按 design 的展开坐标计算比例，以 `test/epub/engine-session.test.ts` 和分页控件测试验证混排章的图片屏得到非零比例并回到同屏，不能按章节有文字误存页首。
- [x] 4.2 在 PDF Text 分页进度链路使用当前首行源字符，读写无字页可选比例；扩展 `test/pdf-text-pagination.test.tsx`、`test/pdf-text-viewer.test.tsx` 验证同原页多屏重开、空页、模式往返及源偏移映射，持久化无临时列号或展示补空格偏移。
- [x] 4.3 对 EPUB 和 PDF Text 验证同排版回到原可视页，改字号/窗口/横竖屏/底栏后当前页包含原锚点，图片比例按展开高度投影；真实浏览器同时验证仅按钮顺序翻页、固定版式页、隐藏页及页范围仍符合现有契约，记录结果。

## 5. 最后一次移动在离开前保存

- [x] 5.1 为 `useLayoutReadingProgressSave.ts`/Reader 增加可选进度控制句柄与显式采集/flush，保留 100ms 尾部防抖和 1000ms 最大等待，各模式补丁合并到最新数据；扩展 `test/reading-progress.test.tsx`，用假时钟验证连续滚动、停止、同页移动、去重、模式切换和进度等待期间新增标注均不丢字段。
- [x] 5.2 将 ReaderSurface 的采集/flush 接入 `webview/src/main.tsx` 的输入静默/关闭链路，先冲刷 Reader 再等待 bridge ack 和宿主落盘，成功后才 dispose；用 `test/webview-bridge-client.test.ts`、`test/bridge-contract.test.ts` 和必要的 ReaderSurface 集成用例验证不足 100ms 关闭重开、慢写入、失败/超时保留会话及重试，断言完整快照确实在关闭确认之前持久化。
- [ ] 5.3 连接 Web 隐藏/pagehide 与原生 AppState 非销毁式冲刷，串行处理 flush/resume 与关闭竞争；通过宿主/桥接测试及 iOS、Android 手动后台往返验证会话保留、实际成功才确认、超时可继续阅读、切书后旧回调不写 B，强杀只恢复实际落盘进度。

## 6. 跨行为交付验证

- [x] 6.1 执行项目已有 `yarn test:run`、`yarn typecheck`、`yarn typecheck:host`、`yarn lint`、`yarn build:all`、`yarn host:check`；记录通过结果及确切环境阻碍，不将未执行的检查标记完成。
- [ ] 6.2 汇总真实浏览器及 iOS/Android 的“旧记录、首行、无字比例、分页重排、100ms 内离开、后台、切书隔离、并发标注”验收证据，保留源字符/页内比例与重开后的实际结果，确认无新增依赖、标注格式变化或原始旧 blob 改写。
