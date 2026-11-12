旧 PDF 续读恢复必须让位于后来的位置变更，不能依赖宿主回显新进度的时机。

`usePositionTransaction` 为同一文档维护 session、generation 和 touched。旧坐标只允许在 pristine session 开始准备；准备前捕获 token，元数据成功、失败、解释结果缓存和恢复兜底都校验 token。任何后续位置写入使旧 token 失效。来源切换会创建新 session，旧子组件的卸载回调不能污染新 session。

| 位置变更入口 | 事务接线 |
|---|---|
| 页浏览器翻页、阅读进度条、矩形跳转（面板及 selectionRef） | 共用 navigate → beginPositionChange |
| 书签跳转、外部 layoutReadingProgress、首次程序化恢复 | 共用 navigateBookmark → beginPositionChange；异步完成/失败校验该 token |
| 外部新比例等于当前实际位置 | 仍取消旧事务；自身发布的受控回显跳过导航和取消 |
| 高亮跳转（页浏览器及 selectionRef.scrollToRange） | 共用 navigateRange → beginPositionChange |
| selectionRef.scrollToPosition（含 scale） | 在写坐标/缩放之前 beginPositionChange，并保持保存可用 |
| 有效 wheel（纵向/横向/缩放）、单指移动、捏合 | 原生 capture 监听中 beginPositionChange；不依赖子组件事件冒泡 |
| 翻页键、鼠标/笔按下（可能启动拖动滚动条/平移/选文自动滚动） | 同一原生 capture 监听取消；静止手指不取消 |
| engineSource、document、渲染模式、retry | 更换 session，阻断旧 token；实际 PDF proxy 替换/清空也取消旧事务 |
| 卸载 | 使该 session 的在途 token 失效；忽略已退场 PDF 的 onDocumentReady 回调 |
| 宿主修改缩放、crop、隐藏页/页范围、安全区输入 | 相同 session 中布局输入确实变化才取消；等值回显不取消，新文档使用新配置正常开始恢复 |
| 程序化恢复的失败兜底 | 只在原 token 仍有效时执行，属于同一事务，不启动会取消自身 readiness 的新事务 |

不使用 DOM scroll 事件推进代次：程序化恢复和布局重排也会产生 scroll。侧栏/输入控件滚动、零增量 wheel、静止触摸不算正文位置变更。选择高亮仅恢复选区，不执行位置跳转；其跳转入口已列在上表。进度发布和正常保存本身不改变位置，也不取消事务。

回归 `test/engine-legacy-restore-transaction.test.tsx` 刻意让元数据等待，正文已滚到第 3 页 65% 并发布，但不向 layoutReadingProgress 回显。元数据完成后断言没有旧 scrollToAnchor/scrollToPage、位置不变、captureAndPublish 仍发布第 3 页 65%。同时覆盖 touch/pinch、其他显式入口、失效成功/失败、正常旧恢复、StrictMode、文档替换后新恢复。

该 wheel 回归在未修复的 2c62679 上失败：实际发出了旧 `{pageNumber:2, verticalPercentage:48.8}` 的恢复；原有模式交接及进度回归断言没有修改。
