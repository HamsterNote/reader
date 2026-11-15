# HAM-276 reader 阶段交接

本阶段实现 WebBase change `refine-reader-workspace-interactions` 的 1.1–1.3；2.1 交付 Web 诊断证据，但未复现原反馈，2.1/2.2 不标完成。没有发布、修改版本号或修改 WebBase 依赖、锁文件及使用方产品代码。

完整 proposal 在实施前已提交 WebBase `18f4a84`，可在 WebBase 根目录使用 `openspec instructions apply --change refine-reader-workspace-interactions --json` 读取。

## 实现与独立测量

| 项目 | 实现 | 已执行验证 |
| --- | --- | --- |
| 1.1 / 用例2 | EngineDocumentViewer 传递 Reader 已解析的上下遮挡量（保留显式 0）；PageBrowser 在滚动框外预留底部；短分栏缩略图等比适应可用高度 | 3 视口 × 单栏/半宽/半高 × 顶遮挡44/0，共18场景；页面、高亮、书签标签首末项与框边界均在安全区±1 CSS px内，首末项最大越界0.375 CSS px |
| 1.2 / 用例3 | 进度跳页复用恢复定位的阅读安全线与裁切坐标；保留3.0.4布局观察、10秒超时及取消；新请求拒绝旧请求而非报告成功 | 432次跳页（5/8/1/12，50/100/200%，裁切0/10%）；346个非夹取样本最大页顶误差0.49375 CSS px；86个夹取样本，与独立clamp oracle最大误差0.49375 CSS px。单测覆盖零尺寸等待、快速请求取代、超时保留位置与切书隔离 |
| 1.3 / 用例7 | 唯一文字参数源半径76、直径152、中心距114 CSS px；倍率2；T+190翻转阈值；矩形快照120/78不变 | 36组输入与120组几何；两视口、DPR1/2/3、PDF三缩放、纯文字/EPUB、草稿/已有高亮、起止柄。半径误差0，未夹取中心距离最大误差0.00625 CSS px，字高2倍误差0；T+191/190/189为上/上/下 |

浏览器几何用DOM边框外沿、原始触点及DOM字符大小作独立oracle。未使用DPR缩放参数、未在边界夹取时缩半径。几何拖柄采用合成pointer；输入矩阵含CDP touch、mouse、pen及取消/释放。未验证真机WebKit首拖或系统手势。

侧栏尺寸夹具模拟所属栏尺寸；真正双实例行为由既有 workspace regression 另测。高亮/书签边界测量已改为真实指针点击 tab 中心（旧版本用键盘切换以规避下述问题）。窄栏（390px 视口、50vw=195px 栏宽）下，侧栏宽 240px 会伸到右侧阅读进度条（`z-index: 12`，宽 32px）下方，而侧栏 `z-index` 只有 10，书签 tab 中心（188.5, 198）的顶层元素曾是 `DIV.hamster-reader__reading-progress`，点击被进度条吞掉。修复只动层级：`.hamster-reader__page-browser--open` 提到 `z-index: 13`（打开态才生效，关闭态仍 `pointer-events: none`，不新增层级上下文）。修复前该断言在 390/horizontal/44 场景失败，修复后 18 个场景共 36 次点击均命中目标 tab，`aria-selected` 与可见 tabpanel 同步切换。

## 用例6：已知事实与未覆盖部分

`check-tool-lifecycle-browser.mjs` 在真实 ReaderFileWorkspace 的PDF第8页与EPUB第3章分别执行10次绘图→文字切换。页面导航、容器替换、引擎装载/释放增量均0，前后源锚点相等。

`check-webbase-tool-diagnostics.mjs` 在WebBase真实ReaderEditorPane与browser-native-host桥接模拟器中，通过内存Vite transform注入计数，不编辑宿主产品源码。已分别测试已安装3.0.2+patch和本轮dist alias；非首页PDF与EPUB各10次切换，navigation、容器替换、loadFile、source身份变化、engine ready/disposal增量均0。当前dist样本PDF scrollTop 1353→1353，EPUB源锚点保持page-2-text/offset0；完整before/after与桥接消息在证据JSON中。

这些结果不能证明“纯宿主根因”。原反馈环境尚未提供，本环境不包含Expo外层WebViewShell，未测其viewMountId/reloadSequence或系统容器替换。纯文字UI没有绘图入口，未伪报三面工具循环。既有workspace浏览器回归包含双栏和保存失败，但原问题所要求的新笔迹保存重开、撤销历史及全部跨层计数尚未形成闭环。因此保留2.1/2.2未完成，没有猜测性修改source/key或生命周期。

## 可复跑命令与结果

在reader根目录：

```sh
yarn typecheck
yarn build:lib
yarn test:run --maxWorkers=2 --minWorkers=1
yarn test:run test/engine-pdf-progress.test.tsx
READER_CHECK=pdf node scripts/check-workspace-interactions.mjs
READER_CHECK=sidebar node scripts/check-workspace-interactions.mjs
READER_CHECK=race node scripts/check-workspace-interactions.mjs
READER_CHECK=lens node scripts/check-workspace-interactions.mjs
node scripts/check-tool-lifecycle-browser.mjs
node scripts/check-workspace-browser.mjs
READER_PROBE_LOCAL=1 node scripts/check-webbase-tool-diagnostics.mjs
```

typecheck、build:lib成功；全量148文件/1949测试通过；新增safe-area参数定向18测试通过；18个快速5→8浏览器场景均以第8页对齐结束（两次seek间不等布局稳定，最终等待两帧核对）。首次全套与多套浏览器并发时，一条既有TXT选区测试5秒超时，降并发全套复核通过。WebBase诊断脚本需要相邻WebBase checkout及其webview开发依赖；去掉READER_PROBE_LOCAL可检查其已安装版本。测试结果写入test-results/workspace-interactions，原始日志与截图随issue附件交付。

## 发布链与patch核对

截至本轮查询，npm latest为3.0.4（gitHead `224f69737191eaa44dad8baf01c5d790620fd320`），而main仍为3.0.2。本PR叠放在reader PR #78分支`agent/agent/5f86b102bf7a`（当前基点`64778d8`）上，避免回退已发布的布局防护与高亮手势handoff；待#78合入后将本PR重定向main。建议下一正式版**3.0.5**，发版时再查latest；本轮package.json仍为3.0.4，没有tag或publish。

WebBase `patches/@hamster-note__reader@3.0.2.patch` 的逐项比对：

- attached/positive-layout检查：3.0.4源内已有`pdfLayoutReady.ts`，本轮保留。
- ResizeObserver/rAF唤醒与清理：统一导航沿用已有`observePdfLayout`，保留超时/取消清理。
- restore在awaitingLayout期间不操作布局：保留。
- 10秒deadline、失败保持原位置、旧请求取消及切书隔离：保留，相关Web单测通过。
- EngineDocumentViewer对`PdfLayoutNotReadyError`提示并避免盲目fallback跳页：3.0.4已含，本轮没有覆盖。

结论：**无需迁移旧patch逻辑或按旧产物哈希重打补丁**。下一阶段实际安装新正式包后仍须验证包内容及WebBase恢复回归，再作为同一次集成变更删除旧版本patch绑定/文件；本阶段原patch和依赖保持原状。两处依赖、锁文件及patch应作为一个回退单元，不清空侧车数据。
