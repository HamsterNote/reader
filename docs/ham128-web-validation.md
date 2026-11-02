# HAM-128 Web 验证

基线：`0ed99cf`（reader/main）。浏览器：Playwright Chromium 148.0.7778.96，1440×1000。

## 根因与修改

- PDF 文字高亮：局域网 HTTP 地址下 `isSecureContext === false`，`crypto.randomUUID` 不可用；点击高亮抛出 `globalThis.crypto.randomUUID is not a function`，没有创建 range。localhost 具有安全上下文，无法复现这个失败。EngineDocumentViewer 新建标注保留 UUID 优先路径，在 API 不可用时使用项目既有的时间戳加递增计数方案。
- 双 Popover：保存矩形、切回文字工具、点中已有矩形，再拖选正文，可在基线观察到两个 `.hsn-selection-popover`。新文字选区没有撤销 `selectedRectId`，且两个弹窗独立渲染。改为一个带类型的活动选区状态；文字、矩形和草稿互斥，取消选中保留已保存标注；原生选区折叠后恢复已保存高亮的可见性，避免仍被 selected 样式隐藏。新拖选文字也会退出旧文字高亮的编辑状态。
- EPUB 目录：当前主线使用 Foliate；正文链接通过当前 section 的 `resolveHref` 解析，侧栏目录通过 book 的 `resolveHref` 解析。没有在当前主线复现截图中的 `https://undefined/part-2.html#...`，因此没有猜测性替换域名或修改导航代码。缺少截图对应原始 EPUB，仍需人类用原文件验收这一条。

修改文件：`src/components/EngineDocumentViewer.tsx`、`scripts/check-web-selection.mjs`、`package.json`、本记录。

## 验证

运行 `yarn dev` 后：

```bash
yarn check:web-selection
READER_BROWSER_URL=http://192.168.0.145:5577 yarn check:web-selection
```

脚本默认输出到 `test-results/web-selection/`，可用 `READER_BROWSER_OUTPUT` 改写位置。它在真实浏览器中执行鼠标拖选及点击，覆盖：

1. PDF 高亮写入存储并渲染；再次创建时 ID 唯一。
2. 无 `randomUUID` 的浏览器环境中同样可以高亮。
3. 已选矩形后拖选正文只出现一个文字 Popover，保存后矩形仍在；新文字选区不会继续编辑旧高亮。
4. EPUB Layout/Text 两种模式的侧栏目录跳转；正文相对链接携带 URL 编码的中文锚点后跨章跳转成功，无 `undefined` 请求或外开页。

EPUB 样本由仓库 `duplicate-text.epub` 添加 `chapter2.xhtml#浏览器博弈论` 链接生成，输出为 `toc-relative.epub`。这是构造回归样本，不能替代原始问题文件。

其他检查：5 个相关 Vitest 文件共 180 项通过；`yarn typecheck`、修改文件 ESLint、`yarn build:demo` 通过。Vitest 仍有既有 React act 警告；构建有既有大包提示。WebKit 因机器缺少运行库未执行，Safari 需人工验证。

## 人工验证服务

- 本机：`http://localhost:5577/`
- 局域网：`http://192.168.0.145:5577/`
- tmux 会话：`ham128-reader`（pane PID `123682`）；进入：`tmux attach -t ham128-reader`
- 日志：reader 仓库内 `.artifacts/ham128/dev-server.log`
- 停止：`tmux kill-session -t ham128-reader`

服务已脱离本次运行并通过 HTTP 就绪检查；无系统 supervisor，长期存活为尽力保障。
