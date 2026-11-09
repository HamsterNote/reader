# Tasks

## 1. Establish the implementation contract in the owning repository

- [x] 1.1 在 `reader` 仓库建立同 ID 的实施 change，将本 proposal 的仓库核对结论改为最终归属，并把行为需求归入现有 `pdfjs-web-reader` 规格；运行 `openspec validate optimize-pdf-hidden-page-editing --strict`，确认不在 `native-reader` 新增另一套页面隐藏实现。
- [x] 1.2 在 `reader` 提取纯函数，统一数字 / `page-N`、去重、合法页与 pageRange 过滤，并生成极大连续页段；新增单元测试覆盖单页、连续段、多个离散段、段首、段尾、整篇隐藏、重复别名及范围外数据，验证输入数组不被修改且输出顺序稳定。

## 2. Keep hidden pages out of PDF layout

- [x] 2.1 修改 `reader/src/pdf/PdfDocumentViewer.tsx`，使可读及可导航集合在编辑态也排除隐藏页，隐藏页始终保持 `display:none`，移除编辑态逐页隐藏提示及其 overlay portal；扩展 `test/pdf-viewer/pdf-document-viewer.test.tsx`，验证编辑开关不改变隐藏页的显示、导航和正文渲染请求。
- [x] 2.2 在 PDF 正文层之外按段渲染一个紧凑恢复入口，不以隐藏页的 PDFPageView 为容器，不使用原页尺寸；组件测试验证第 9、10 页只在第 8、11 页间产生一个入口，并覆盖段首、段尾、整篇隐藏及全部恢复后的入口消失。
- [x] 2.3 将折叠入口的增删与阅读位置恢复协调，避免打开模态框或切换隐藏页入口时把当前页跳到隐藏页；回归上一页/下一页、页码、书签、进度恢复及 pageRange，验证仍隐藏页不可定位、已恢复页使用原页号定位。

## 3. Add the grouped restoration modal

- [x] 3.1 实现按连续段组织的单一模态框，从任一入口打开完整可恢复列表并定位到来历段；复用 `reader/src/pdf/usePdfPreviews.ts` 的可见项加载、缓存、单页重试和释放语义，组件测试验证无整册预渲染、加载尺寸稳定、单页失败隔离及关闭/切书后的旧结果丢弃。
- [x] 3.2 实现跨段多选、当前可恢复集合的全选/取消全选、选中计数和零选择禁用确认；使用文本「✓」形成蓝底白字圆形选中标记并暴露复选语义，测试鼠标、Enter/Space、焦点返回、Escape/取消及退出编辑时的草稿清理。
- [x] 3.3 在 `reader/src/components/Reader.tsx` 增加一次确认的批量恢复，只过滤所选隐藏项并保留未选项、范围外项和其他最新 `ReaderData`；实现确认后 5 秒内的一次撤销及隐藏/恢复、退出编辑、切书时失效，组件测试验证取消零回调、确认一次回调、撤销一次回调、受控宿主回显不重复提交且不写入标注历史。

## 4. Verify rendering, compatibility, and resource bounds

- [x] 4.1 扩充真实浏览器交互脚本，使用至少 200 页 PDF 隐藏第 2 至 199 页并反复切换编辑开关，仪器化断言这 198 页始终无正文页面框、无正文 render 请求、仅一个段入口、文档不重新加载，且可见页 offsetTop 与 scrollHeight 完全不变；保存桌面与 320px 移动宽度截图及计数报告，不以主观时延替代这些硬约束。
- [x] 4.2 在真实浏览器完成段首/段尾/整篇隐藏、跨段全选与部分确认、取消、5 秒内撤销及切书失效流程；验证模态框预览真实且比例正确、失败可重试、正文不滚动、焦点返回和移动宽度操作可用。
- [x] 4.3 回归历史数字 / `page-N` 隐藏数据、pageRange、裁切、标注、进度及 PDF Text/EPUB 未受影响；在 `reader` 运行 `yarn typecheck`、`yarn lint`、`yarn test:run` 和 `yarn build:all`，并执行相关浏览器检查，记录结果且不把桌面移动视口称为真机验收。
