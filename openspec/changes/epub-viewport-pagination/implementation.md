# HAM-129 实施与验收记录

EPUB 已切换为按正文可用视口重排的单栏分页，左右按钮每次移动一个可视页。旧逻辑页 ID 与字符偏移继续用于进度、目录和标注。PDF 与其他格式保留原阅读入口。

## 改动文件

- `src/epub/foliateEpubEngine.ts`、`buttonOnlyInput.ts`：可视页操作、边界/busy 状态、补封面、可读集合、失败回退、输入限制与稳定锚点重排。
- `src/components/EngineDocumentViewer.tsx`：EPUB 按钮、进度门控、正文与叠层视口、切书回调隔离。
- `src/components/Reader.tsx`、`Reader/DefaultBottomBar.tsx`、`Reader/useBottomBarInset.ts`、`src/styles/engine-viewer.scss`：右对齐控件、窄屏分行、绘图面板实测避让、主题接线。
- `vendor/foliate-js/paginator.js`、`paginator.d.ts`、`view.d.ts`、`PIN.md`、`MANIFEST.md`：显式手动导航配置、重排通知、零尺寸保护和失败解锁，记录补丁及哈希。
- `test/epub/{fakeView.ts,engine-session.test.ts,foliate-assets.test.ts}`、`test/epub-pagination-controls.test.tsx`、`test/reading-progress.test.tsx`：引擎、控件、进度与资产校验。
- `scripts/check-epub-pagination.mjs`：生成长章节/固定版式样本，启动仅测试期间存在的静态 HTTP 服务，结束时关闭浏览器和服务；不启动 Dev Server。
- 本 change 的 proposal/design/tasks/spec delta 为需求线程附件中的原始规划，新增本验收记录。

## 现有实现的最小适配

Foliate 的固定版式渲染器默认使用 spread，且没有 reflow 渲染器的 `setStyles` / `scrollToAnchor`。适配层在首次定位前将其配置为 `spread: none`、`fit-page`，固定版式顺序导航按可读原始单页定位；这不会修改 PDF 或出版物数据。兼容索引没有对应逻辑页的导航 spine 项标为不可顺序阅读，防止翻入目录后失去页边界。

## 验证结果

环境：Ubuntu 26.04 / Node 24 / Playwright 1.60.0，桌面 Chromium 1280×800、触摸模拟 320×740，重排后分别 440×780、740×480。触摸模拟不能替代 iOS/Android WebView。

- `yarn test:run`：87 个文件、1185 项测试全量通过；涵盖 Reader、EPUB/PDF、TXT/其他格式、书签、选区/高亮、绘图、宿主存储与切书会话测试。
- `yarn typecheck`、`yarn lint`、`yarn build:webview`、`yarn verify:webview`：通过。构建仍有既有的大 bundle、PDF 图标路径和 OpenCV Node 模块外置警告。
- `yarn check:browser`：Chromium 桌面/触摸模拟的 EPUB/PDF v2/v3/v4 高亮、端点编辑、保存重开、安全回归共 13 项通过；13 项 WebKit 用例无法启动。
- `node scripts/check-epub-pagination.mjs`：Chromium 桌面/320px 触摸模拟的重排分页与固定版式共 3 项通过；3 项 WebKit 用例无法启动。测试生成的 EPUB 无外部依赖。
- `openspec validate epub-viewport-pagination --strict`：通过。

| 规格场景                       | 证据/结果                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 打开、目录定位、封面/图片      | 既有引擎与浏览器回归通过；超高图片加载完成、尺寸不超过扣除工具栏后的正文视口                                                                |
| 同章连续翻页                   | 浏览器连续下一页三次保持同章、页位逐一递增、上一页返回原页；保存 offset 连续前进                                                            |
| 章节与全书边界                 | 浏览器下一章首页的上一页定位前章末页，再下一页回到后章；全书末页下一页禁用且不出现空白尾页；引擎覆盖首页、补封面、隐藏页/范围、无映射导航项 |
| 固定版式                       | Chromium 验证 single spread，下一页只增加一个原始页，上一页返回原页                                                                         |
| 正文滚动/触摸/键盘             | iframe DOM 输入拦截、真实滚轮和键盘、Chromium CDP 原生触摸派发后页位不变；外层空白也限制平移，侧栏独立滚动                                  |
| 页边选择/显式跳转              | 越界选区超过 Foliate 延迟触发时间后不翻页；目录与存储高亮显式定位通过；书签定位由现有 Reader/引擎测试覆盖                                   |
| 右下角与正文避让               | 桌面、320px 窄屏、横屏、绘图展开测量纸面底边不超出控件顶部，控件无重叠；正文与工具叠层使用相同底部 inset                                    |
| busy/可访问操作                | 组件测试覆盖加载/忙碌/边界禁用、Enter/Space；引擎测试覆盖快速重入和失败恢复                                                                 |
| 同章持久化                     | 关闭重开恢复相同可视页；初始化/恢复期间零写入；text/layout 两条进度路径均通过测试，无 CFI/临时页号字段                                      |
| 窗口/字号/底栏重排             | 原字符锚点位于前后相邻页起点之间；窗口、字号、绘图展开和暂时零高度后不覆盖保存记录，后续翻页使用新边界                                      |
| 无文字/补封面                  | 引擎测试覆盖逻辑页回退、补封面仅访问一次和迟到事件不覆盖封面；不生成虚构文字锚点                                                            |
| 选择、高亮、绘图、PDF/其他格式 | Chromium 高亮/端点编辑/重开回归通过，EPUB 鼠标绘图产生笔迹并进入宿主快照；PDF 无 EPUB 按钮；其他格式由全量测试回归                          |

截图及原始报告随任务评论附件 `ham129-evidence.tar.gz` 提供：`pagination/*-initial.png`、`*-drawing.png`、最终页截图、`pagination/report.json`、`reader/report.json` 与检查日志。仓库不提交运行时截图和构建产物。

## 待验收项与风险

OpenSpec 当前 9/12 完成，`2.2`、`4.3`、`5.1` 保持未勾选：

1. iOS/Android WebView 实机：长按选字、手柄、高亮/绘图、侧栏滚动、触摸阻止和同章关闭重开；当前主机无 adb/xcrun/设备连接。
2. WebKit：主机缺少所需 `libicu*.so.74`、`libxml2.so.2`、flite 等动态库，两个浏览器命令因此整体返回非零。最小后续方案是在有 Playwright WebKit 依赖的验收机运行同样脚本；未修改主机系统库或替换锁定浏览器。
3. 超长章节绘图仍沿用现有整章 iframe 坐标模型，实际书籍的性能与原生选字体验需设备验收。本次不引入持久化数据迁移。

尚未归档该 change，未启动常驻开发服务，未发布或合并。
