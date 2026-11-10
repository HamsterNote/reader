# HAM-201 文字手柄与放大镜验收

本次唯一交互规格为 `reader-text-selection-interaction`。PDF Layout、EPUB、PDF Text 通过同一个 `EngineSelectionControls` 和 `RangeMagnifierProvider` 实现会话、命中、手柄、取景与竖线；PDF.js 与流式正文仅分别提供纯文字来源。EPUB 初始选择入口保留，后续使用受管端点并清除原生选区。

尺寸集中在 `selectionInteraction.ts`：镜片直径 60 CSS px、镜心距触点 38 CSS px、倍率 2、竖线宽 2 CSS px、白边 3 CSS px、边缘留白 8 CSS px。38px 是约 1cm 的 CSS 参考值，实际物理观感仍需设备验收。矩形工具保留原截图路径及几何。

## 自动化验收范围

共享浏览器矩阵使用真正 Reader API、PDF.js、EPUB iframe 与 PDF Text 正文，不用最终截图代替过程断言。组合为三个渲染面 × touch/mouse/pen × 起点/终点 × 草稿/已保存高亮，共 36 项。touch 和 pen 通过 Chromium CDP，mouse 通过 Playwright 鼠标。每项检查有效拖动中手柄可见、当前输入类型控制镜片、释放后关闭、草稿确认一次或已有高亮更新一次；保存对象保留 ID、颜色和固定端。

touch 组合另检查 60px/38px、镜心随触点移动、源字符间隙锚点不漂移、竖线颜色、镜内无覆盖层。稳定排版中连续小幅移动的文字 childList mutation 为 0；草稿拖动时受控换色同步更新竖线而不改变端点或重新复制文字。保存对象的工具栏颜色故意不同于目标颜色，验证仍保留目标颜色。

单测另覆盖未知输入、关闭开关、热区中心/边缘/边角、三行字符命中、iframe 坐标、释放前无下一帧、无效间隙、离散竖线跳变、顶部翻转及边界夹取、受控颜色、取消/失焦/卸载及过期事件。纯文字缓存测试覆盖跨节点、排除脚本/按钮/SVG、字体变化失效和清理。PDF Text 桥接测试覆盖固定端原页未挂载、正文重建后的 live Range 失效、文本增减、ID/样式/评论关联不变。

既有浏览器检查继续覆盖 PDF 50%/100%/200% 缩放、热区角落、裁切、跨页、端点反转、自动滚动、停止/取消、文字源 offset、重开后编辑、矩形、EPUB 导航。HAM-182 几何检查覆盖 percent/px、320/402/740 宽度、1×/1.5× 字体、重开和草稿/已有高亮调整；使用 Chromium，合成指针测试中的 capture 由桩提供，共享 CDP 矩阵另覆盖真实 capture。

## 合并后的实际结果

| 命令                                                                                                                | 结果                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `yarn typecheck`                                                                                                    | 通过                                                 |
| `yarn test:run --maxWorkers=2 --testTimeout=15000`                                                                  | 126 文件、1,729 项通过                               |
| `yarn vitest run test/shared-selection-interaction.test.tsx test/pdf-text-managed-controls.test.tsx --maxWorkers=2` | 最后补充的混合输入和 live Range 恢复共 148 项通过    |
| `READER_CONTINUOUS_TARGET_PAGE=12 yarn check:web-selection`                                                         | 10 组全部通过，含 36 个共享组合及既有 PDF 检查       |
| `READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-handles.mjs`                                            | HAM-182 的 20 组几何/恢复场景通过，最大误差 0 CSS px |
| `yarn build:lib`                                                                                                    | JS、声明文件、样式构建全部通过                       |
| `openspec validate unify-selection-handle-magnifier --strict`                                                       | 通过                                                 |

| 渲染面     | touch 草稿起/终 | touch 已保存起/终 | mouse 草稿起/终 | mouse 已保存起/终 | pen 草稿起/终 | pen 已保存起/终 |
| ---------- | --------------- | ----------------- | --------------- | ----------------- | ------------- | --------------- |
| PDF Layout | 通过/通过       | 通过/通过         | 通过/通过       | 通过/通过         | 通过/通过     | 通过/通过       |
| EPUB       | 通过/通过       | 通过/通过         | 通过/通过       | 通过/通过         | 通过/通过     | 通过/通过       |
| PDF Text   | 通过/通过       | 通过/通过         | 通过/通过       | 通过/通过         | 通过/通过     | 通过/通过       |

12 页压力检查实际保存终点为 `page-12`，回收期间保留 3 个所需文字层，原生 Range 数为 0；250ms 采样中远离边缘滚动 4px、贴近边缘 193px，上缘 450ms 反向滚动 318px，松手/取消后停止。图像抽查可见纯文字镜片及正文高亮，镜内不复制高亮。

本机首次默认并行全量运行有一个旧 TXT 合成页用例超过 5 秒；该用例单独通过，降低并发并放宽到 15 秒后全量通过。共享 CDP 检查曾在 touch 后模拟 pen 时产生不同的按下/移动 pointerId（6→2），现按输入重建浏览器目标；生产会话仍严格校验 pointerId，同一控件的混合输入由定向单测补验。

逐组合记录在检查输出 `shared-interaction.json`，完整 PDF 与导航记录在 `report.json`，随 issue 结果作为附件交付。以上均为 Chromium 证据。

## 主干合并

分支 `agent/agent/7a9f3bfcd9b8` 已执行 `git fetch origin` 和 `git merge origin/main`，包含 HAM-182 的 `7ece0a4`。Merge commit：`b708af9f59f90c31e39b25bffe21dae3fbc656e7`。

冲突文件：

- `src/components/EngineSelectionControls.tsx`
- `src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer.tsx`
- `src/components/IntermediateDocumentViewer/RangeMagnifier.tsx`
- `src/components/IntermediateDocumentViewer/TextSelectionMagnifier.tsx`
- `src/components/IntermediateDocumentViewer/rangeMagnifierGeometry.ts`
- `src/components/IntermediateDocumentViewer/useRangeHandleDrag.ts`

保留 HAM-182 的 40px 热区、20px 圆柄、2px 白圈、整体阴影、按真实行高绘制的竖线、源端点几何、滚动跟随、离屏端点、重排及源坐标修正。旧抓取补偿、mouse/pen 镜片和镜心固定竖线由本次共享规格替代。PDF Text 手柄移到稳定受管层，避免上游拖动重建时消失。

## WebKit 触摸中断回归（PR #59 后续修正）

Mac 操作员报告 iOS 27.2 模拟器 Safari 在 `1069a15` 上首次拖柄只有 pointerdown，松手镜片残留、重拖空白。当前证据可以确认应用的收尾缺口，尚不能确定模拟器为何没有派发后续 pointer 事件，也不能断言是模拟器注入问题。

旧共享会话只消费 pointermove/up/cancel；若它们丢失，后续 TouchEvent 不能更新或结束会话，同一 pointerId 的新按下也被旧会话挡住。用新的 WebKit 脚本对旧 `1069a15` 保留 touchstart/move/end、停止后续 pointer 流，失败于 `draft/start: release/cancel closes`（镜片仍可见）。这是明确标注的故障注入，不能冒充原生 iOS 长按复现。

修正仍只在共享 `EngineSelectionControls`：pointerdown 后，仅将起始手柄上的 touch identifier 绑定到当前 touch 会话；touchmove 使用原始坐标且显式非 passive，touchend 重放释放坐标并提交一次，touchcancel 取消。正常两种事件都到达时跳过重复移动；迟到 pointerup、无关触点均不能再次提交。新的 pointerdown 会取消未结束的旧会话，包括复用同一 pointerId 的情况。EPUB 圆柄补齐 WebKit 禁选字/禁触摸菜单设置，自定义手柄阻止 contextmenu。38px/60px 常量不变。

实际运行环境为 Linux x64、Playwright WebKit 26.4、402×874 移动视口。所需 Ubuntu 24.04 兼容运行库解包到任务目录后启动，未修改系统库。四组为 EPUB × 草稿/已有高亮 × 起点/终点，每组检查：

- 两次浏览器原生 tap，真实 pointer capture/up/lostcapture 及释放关闭，共 8 次；原生鼠标操作共 4 次，均不打开镜片。
- 一次成对 pointer/touch 拖动、两次 pointer 流中断的 touch 拖动（其中一次先恢复同 ID 的遗留会话）、一次 touchcancel，共 16 次合成拖动。
- 每次开始及移动都有镜内文字、双手柄常显；无关触点不结束、释放关闭并清空镜内内容、迟到 pointerup 不重复提交；取消恢复前次端点，已保存对象 ID/颜色/固定端不变。

初始 Selection 由脚本设置为长按后的状态，持续拖动为合成事件；只有 tap 和鼠标由浏览器原生输入接口驱动。保存后的原生 tap 在下一帧激活恢复完成后执行，并严格检查每次真实 capture 和 release。不能据此宣称原生长按、iOS Safari/WKWebView 或 Android 真机通过。

本轮验证：

| 命令                                                  | 结果                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-webkit-selection-touch.mjs`       | WebKit 4 组通过，报告含浏览器版本、isTrusted、pointerId、touch identifier、坐标、捕获及 preventDefault 事件记录 |
| `node scripts/check-shared-selection-interaction.mjs` | Chromium 36 组通过                                                                                              |
| `yarn test:run --maxWorkers=2 --testTimeout=15000`    | 126 文件、1,729 项通过                                                                                          |
| `yarn typecheck`、`yarn build:lib`                    | 通过                                                                                                            |

WebKit 脚本自行启动并关闭 Vite 和浏览器，不依赖 Mac 的旧 `6201` 服务。在支持 Playwright 的开发机执行 `npx playwright install webkit` 后运行上述命令；已有自定义启动器可用 `WEBKIT_EXECUTABLE_PATH` 指定。本机使用该变量指向任务目录的兼容运行库启动器。逐组证据输出到 `test-results/webkit-selection-touch/report.json`。

Mac 复验应使用 PR 最新提交，并启动独立端口：`yarn dev --host 0.0.0.0 --port 6202 --strictPort`。Safari 打开该新端口，依次长按选字、首次拖起/终柄、释放、重拖、保存后再次编辑、取消；同时记录 outer document 和 EPUB iframe 的 pointerdown/move/up/cancel、got/lostpointercapture、touchstart/move/end/cancel，至少包含 isTrusted、pointerType、pointerId、touch identifier、target、defaultPrevented。重点区分 Mouse 注入与真实触摸事件；若两种流都没有 move/end，应用无法还原未收到的轨迹或释放，需继续定位注入/浏览器事件派发，不能仅凭“只有 down”判定责任。

## 待设备验收

任务 4.3 保持未勾选。本轮未操作 iOS/Android WebView 真机，不宣称真机通过。前轮缺失 `libicudata.so.74` 的 Linux WebKit 启动问题已通过独立兼容运行库解决；本轮新增的 WebKit 自动化范围与限制见上一节，不能以它代替设备验收。

iOS WKWebView 和 Android WebView 均需执行三个渲染面的 touch × 起终点 × 草稿/已有高亮，记录设备型号、系统/WebView 版本及可用鼠标/笔组合。重点录像约 1cm 观感、60px 镜片、顶部翻转/恢复、热区边角命中、全程双手柄、无系统选择手柄/编辑菜单竞争、跨字符竖线跳变、换色、松手/取消/切书/切模式关闭。PDF Layout 补验连续跨页与边缘自动滚动，EPUB/Text 补验页边不滚动且不自动翻页。
