# optimize-pdf-hidden-page-editing

Collapse hidden PDF pages into grouped restore controls during page editing

恢复面板沿用 PDF 页面浏览器的浅色板、主题色与组件库圆角变量：恢复为实心主按钮，全选/取消为描边次按钮，关闭为轻量图标按钮。入口使用页数徽章，保持 32px 高度及原有绝对定位覆盖层；单页组标题显示「第 N 页」。按钮包含 hover、active、focus-visible 和禁用态，减少动态效果偏好下禁用过渡。

运行 `node scripts/check-pdf-hidden-page-editing.mjs` 验证 200 页隐藏 2–199 时的零正文渲染、零位移及相同 scrollHeight，同时检查 320px/桌面模态框无横向溢出、Tab 焦点循环、Escape 关闭、焦点返回与单页标题。截图和报告位于 `test-results/ham190-hidden-pages/`。
