## PDF 裁边回归（HAM-166）

官方 PDFViewer 替换提交 `233db4f` 将裁边实现为 page div 的 `clip-path`，保留整页布局尺寸；后续集成虽然接通了全局/单页参数和编辑器，页面占位与 `page-width` 仍按未裁切页面计算。实际表现为白边被遮住，但页间空隙和缩放仍然包含白边。生成的 600 × 800 PDF 在 100% 缩放、上裁 10% / 下裁 15% 时，可见页间距从原本 10px 变为约 276px。

修复在保持 PDF.js 原始 page/viewport 与标注坐标的前提下，通过 flex 排版和四边负 margin 扣除裁切占位，并隔离被裁区域的滚动溢出。宽度适配、跳页、阅读位置和编辑模式使用统一的归一化裁切几何；编辑时显示整页，退出后恢复裁切。跳页对齐裁后可见页首。

运行：

```sh
yarn install --frozen-lockfile
node scripts/check-pdf-edge-crop.mjs
```

脚本启动本地 Vite Dev Server，在 Chromium 中通过真实 Reader 打开生成的三页 PDF（包含非零原生 CropBox、旋转页），测量实际页面边界并执行鼠标拖拽。覆盖裁边开关、四边独立生效、全局/单页覆盖、页面浏览器跳页、编辑开关及应用到当前页/全部、文字选择/高亮对齐、50%/200% 缩放、桌面及 480px 视口的裁后宽度适配。修复后可见页间距恢复为约 10px。

PDF 样本、截图及测量报告输出到 `test-results/pdf-edge-crop/`。该目录为运行产物，不提交。
