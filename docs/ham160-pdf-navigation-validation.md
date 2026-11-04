# HAM-160 PDF 导航与预览验证

实现对应 `openspec/changes/archive/2026-11-04-fix-pdf-reader-navigation-and-previews/`。
proposal、design、增量 spec 与评审附件逐字一致；只更新 tasks 完成状态。

## 实现约定

- 缩略图与正文共享 PDFDocumentProxy，通过 `getPage/getViewport/page.render`
  生成最大边 320px 的预览；串行、正文优先、缓存有界、离屏取消、失败可重试。
- 已知源字符/原页位置使用官方 `scrollPageIntoView` 的 XYZ 目的地，
  通过 `convertToPdfPoint/convertToViewportPoint` 处理缩放与旋转。
  源链接仍走 PDFLinkService 的目的地解析；没有重复实现目标索引或变换矩阵。
- pdfjs 没有 Reader 安全区域首字符或 CSS 分栏定位 API，因此使用其实际文字层的
  DOM Range 片段，保留 canonical 源偏移；官方导航后仅在内部滚动容器校正一次。
- 文字未就绪时冻结稳定位置并提示稍后重试；仅确认安全视口没有文字才保存原页比例。
  Text 返回 Layout 使用当前可视列实际首字符，兼容外部受控模式切换。
- SafeArea/调用方边距/实际底栏重叠按 max 合并一次，额外保留 8px。
  宿主已经让出安全区时，应传入剩余重叠量（为零即可），避免重复扣减。
- 三项提案假设均保留：8px、缩略图不包含标注、Text 比例列为
  `round(clamp(r, 0, 100) / 100 * (N - 1))`。
- 浏览器真实连字样本发现 viewer 保留 `ﬁ` 字形，公开 getTextContent 返回 `fi`。
  适配使用 pdfjs 官方 `normalizeUnicode` 建立临时 DOM 边界映射；
  不改变公开字符串、源 offset、已有高亮 ID、端点或评论关联。

## 复现

在仓库根目录执行：

```sh
yarn test:run
yarn typecheck
yarn lint
yarn build
yarn host:check
node scripts/check-pdf-navigation.mjs
```

浏览器脚本使用 Playwright Chromium、真实 PDF worker、官方 PDFViewer 与实际 Reader。
它生成 5 页长文档（第 3 页为纯图），并加载仓库的 two-column、ligature、rotated PDF。
临时 Vite 服务与浏览器在 finally 中关闭；不是常驻验收服务。
脚本输出至仓库同级的 `ham160-browser/`，包含报告、PDF 和截图。

## 本地结果

- 全量测试：104 个文件、1,412 项通过；包含 EPUB/其他格式及历史 v2/v3/v4 高亮回归。
- typecheck、lint、build（库与 demo）、host:check 通过。
  host:check 校验 293 个 WebView 资产并检查宿主类型。
- 真实浏览器 13 组场景通过，无页面异常；源页/字符、视口边界和滚动限位记录在 report.json。

| 用户行为 | 浏览器证据 |
| --- | --- |
| 页面浏览缩略图（原第 1、2 点） | 未访问的第 5 页预览显示正确比例并可点击；重开侧栏正常，previews.png |
| 同页深处高亮跳转 | 源 offset 2940 可见且对齐安全顶部，误差小于 1px |
| 即时书签、去重、点击恢复 | 源 offset 2100 立即保存，同点不重复，恢复误差小于 1px，bookmark.png |
| PDF → Text / Text → PDF | 来源字符在 Text 可视页内；返回时对齐 Text 自己的首字符，text.png、layout-restored.png |
| 无文字比例回退 | 第 3 页约 60% 往返保留；Text 比例书签及外部受控切回通过，scanned-60.png |

另外覆盖 50%/100%/200%、320×720/720×320、工具栏占用、两栏、连字、旋转和末页。
末页连字目标因内容不足无法贴顶时，断言已到最大 scrollTop 且目标可见；没有添加空白尾页。
裁切、隐藏页/页范围、部分露出字符、跨页首行、延迟/失败/失效请求另有单元回归。

## 待验收

当前环境没有 iOS/Android 真机或可用模拟器，未验证原生 WebView SafeArea、长按选择、
触摸和正文/侧栏手势，因此任务 4.3 保留未完成。桌面 Chromium 的响应式几何与
host:check 不能代替设备测试。由小助手启动 dev server 后交人类验收，并补齐设备记录。

## 代码审核后的两项修复

PDF pagesloaded 即确认文档可用；初始恢复及其替代导航各自通过导航门禁控制进度提交。
旧恢复的 generation 失效不会再使文档永久不可发布。新增集成回归覆盖初始恢复正常完成、
文字层就绪前 Page Browser 跳页、书签替代及初始恢复失败后跳页，均验证后续滚动和跳页回调。

预览任务完成、失败或取消并收敛后，通过当前文档 viewer 的 `thumbnailrendered`
事件请求回收。pdfjs 官方 handler 检查正文页面 buffer，保留正文使用的页面；
PNG 缓存不再持有底层渲染资源。切换文档的旧任务不会通知新 viewer 清理。
预览单测现在同时断言 PDFPageProxy.cleanup、渲染资源保留集合、正文保护和失败/取消时序。

复现实验：`node scripts/check-pdf-preview-resources.mjs`。
脚本生成同一份 36 页 PDF，以真实 Chromium / pdfjs / PDFViewer 和预览 hook 测量：

| 路径 | 保留操作列表的页数 | 操作条目数 |
| --- | ---: | ---: |
| 审核员流程：仅渲染并清空 canvas 的对照 | 36 | 396 |
| 修复路径：顺序浏览 36 页预览并淘汰旧 PNG | 2 | 44 |
| 修复路径：关闭预览后 | 2 | 44 |

34 个仅预览页面的操作列表实际释放；图片缓存限制为 24 项、关闭后为零。
正在显示的第 1 页在预览释放前后均为 22 条操作，PNG 淘汰后和关闭后仍为 22，
正文继续可见。保留的两页属于正文缓存，不应由预览强制清理。无页面异常。
这是操作列表缓存实验，不将计数解释为实际峰值内存。
观察 `_intentStates` 仅存在于测试宿主；产品代码使用官方事件，不访问私有缓存。

相关回归共 7 个文件、60 项通过（审核时的 55 项加 5 项新增）。
报告、36 页 PDF 与正文截图输出至仓库同级 `ham160-review-browser/`。
