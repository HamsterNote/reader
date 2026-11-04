# Tasks

## 1. PDF 移动选择状态与手势入口

- [x] 1.1 在 `PdfDocumentViewer.tsx` 增加 textLayer 范围内的移动长按候选、有效命中及受管 Range 状态，向 EngineDocumentViewer 提供活动选区；扩展 `test/pdf-viewer/pdf-document-viewer.test.tsx`，验证长按生成选区、平移/多指取消候选、空白和非文字工具不生成选区。
- [x] 1.2 适配 `pdfSelectionSerializer.ts` 与 viewer 的 serialize/confirm/clear/restore 路径，使移动受管范围使用既有公开锚点；扩展 serializer/fixtures 回归，验证连字、换行、重复文字、跨页端点及不连续分组往返，不改变 ID、格式或评论关联。
- [x] 1.3 在 PDF 移动自定义路径限定原生选择、touch-callout 和菜单抑制并加入受管选区叠层；通过触摸浏览器集成检查无第二套可见选区、滚动/双指导航/链接仍可用，系统菜单最终由 4.3 真机验收。

## 2. 共享圆柄与可取消拖动

- [x] 2.1 从 `RangeHandle.tsx` 提取圆柄视觉基础供 Text 和 Layout 适配器使用，Text 保留 `PdfTextHandle` 分页列过滤及库专用拖动；在组件回归中验证 20px 圆柄、可访问名称、逆缩放和离屏端点不生成替代手柄。
- [x] 2.2 为 EngineSelectionControls 增加显式 PDF 触摸模式，接入圆心纠偏、pointer capture、PDF textLayer 命中及放大镜，去除该路径 mouse-only 限制；扩展 `test/engine-selection-controls.test.tsx`，验证 touch 起止点扩展/缩短、跨行、草稿更新及历史高亮一次提交，EPUB 保留原输入行为。
- [x] 2.3 补齐 pointercancel、blur、多指、越过另一端、无效命中、节点回收及会话替换的回滚和资源清理；以控件和 `test/engine-selection-transactions.test.tsx` 回归验证取消不提交、原会话恢复、旧会话不回写及后续可继续选择。

## 3. PDF 预览颜色统一

- [x] 3.1 在 Reader 的 PDF Layout/Text 分支将底栏 resolvedHighlightColor 同源传给选区预览/新高亮，接入 Layout 作用域 CSS 变量与 Text selectionColor；增加 Reader/引擎颜色断言，覆盖 A→B、受控更新、传入不同 selectionColor 时 PDF 仍跟随底栏且非 PDF 保持原行为。
- [x] 3.2 确保未高亮选区、母版预览与新建高亮颜色和 alpha 一致，活动换色不丢失端点、不重染历史高亮、不双重涂色；在选择事务与浏览器截图检查中验证，历史高亮调整后保存重开保留原色、ID 和评论。
- [x] 3.3 更新 PDF selectionColor 行为说明及发布说明，明确底栏色优先规则和无数据迁移；核对文档示例与 3.1 的测试结果一致。

## 4. 集成回归与设备验收

- [x] 4.1 扩展 `scripts/check-web-selection.mjs` 覆盖 PDF Layout 触摸选择/拖柄及 Layout/Text 预览换色，执行 `yarn check:web-selection` 并保存断言和截图；测试运行依赖缺失时先核对脚本依赖，不将无法启动算作通过。
- [x] 4.2 执行 `yarn typecheck`、`yarn test:run`、`yarn build:webview`、`yarn verify:webview`，确保修改及共享组件回归通过；复查 PDF Text 不滚动/自动翻页、桌面鼠标选择与 EPUB 既有选择无回退。
- [ ] 4.3 在 iOS 和 Android 真实 WebView 按 spec 场景分别验收长按后双端拖动、系统菜单抑制、底栏 A/B 换色、50%/100%/200% 缩放、滚动后/旋转裁切页命中、取消与切模式/切书、多指导航及无文字页；记录设备/系统、步骤与实际结果，失败项修复后重验，不能以桌面触摸模拟替代。

## 5. 真机反馈的绘制和手柄修复

- [x] 5.1 统一 PDF 草稿、原生选区及保存高亮的透明填充，关闭混色仍可读；修复跨 span 元素框/字体框越界和同行间隙，预览/序列化共用几何，不改写历史数据。
- [x] 5.2 仅 PDF Layout 圆柄增加 2px 白边和整体阴影，圆点移到文字行外沿并同步修正拖动命中；Text 手柄默认样式保持原样。
- [x] 5.3 保存同 fixture 修前/修后截图，补充不透明宿主色/禁混色/紧密多 span 回归；通过全量单测、类型检查、check:web-selection 与 WebView 重建/资源校验，并同步到现有验收服务。

## 6. 偶发双柄与扩大热区

- [x] 6.1 在 PDF 触摸会话的入口、预览更新及 selectionchange/selectstart 防止可见原生 Selection 重新激活，覆盖阅读工具栏；以 clone Range 保存几何与文字，复制直接提供受管文本，编辑器/其他 reader 的选择不受影响。
- [x] 6.2 PDF 起止点各使用屏幕恒定 40×40 方形热区，视觉圆仍 20px；抓取热区边缘不跳变，移动/释放/取消与父级更新期间预览和手柄使用同一最新 Range，释放重算最终坐标，不改 Text 圆柄默认行为。
- [ ] 6.3 用 CDP 验证 49%/50%/100%/200% 缩放、圆外 9px 四角抓取、原生选区重新加入后清空与复制、拖动末帧几何；保存截图和记录，完成类型/测试/构建检查并更新现有 Web/Metro 验收环境。真机修后截图仍归 4.3 人类验收。
