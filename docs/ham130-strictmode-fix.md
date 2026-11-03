# HAM-130 StrictMode 分页死锁修复补验收

2026-11-03。代码留在本地分支 `agent/agent/32b448bcafab`，未提交、未推送、未创建 PR。OpenSpec 仍为 14/15，5.2 iOS/Android 实机验收继续等待设备。

## 根因与改动

`usePdfTextPagination` 的 state 初始化器执行 `++serial.current`。React StrictMode 重复调用初始化器后，保留的 state target token 与 serial 不一致；rAF 的 valid 校验拒绝布局，busy 无法清除。navigate/turn 的 state updater 中也存在同类副作用。

仅修改 `src/pdf/usePdfTextPagination.ts`：初始化器读取 serial，导航请求在调用 setState 前分配一次 token，updater 不再修改 serial。保留原有串行门控、rAF 取消、文档 generation 与输入限制。

`test/pdf-text-pagination.test.tsx` 新增 StrictMode 包裹的参数化回归，覆盖内容立即就绪与延迟加载两种路径；检查初次 ready/busy、同一事件快速双击只前进一屏、连续前进、边界、回翻及显式字符定位。修复前两项均因 ready 永远为 false 失败；修复后通过。

## 真实 dev / preview 对照

Chromium headless，1100×800；同一份单原页 PDF，1100 词、8789 UTF-16 字符。

- dev：`http://192.168.0.145:5130/`，tmux `ham130-dev`，保留 `demo/main.tsx` 的 StrictMode。
- preview：`http://192.168.0.145:5131/`，tmux `ham130-preview`，保持原生产构建作为对照。
- 修复前：dev 正文无 transform、前后按钮均 disabled；preview 可翻页。
- 修复后：dev 初始下一页可用，翻页后上一页可用；连续三次下一页位移为 `translateX(-808px)`、`translateX(-1616px)`、`translateX(-2424px)`，与 preview 完全一致；上一页回到 `-1616px`。
- 在可视正文上发送横纵滚轮、设置正文容器 scrollTop/scrollLeft，均未改变分页 transform；两端均无 pageerror。

已核对运行中 dev checkout 的 hook 与修复前版本一致后，只同步该 hook，Vite 自动更新。未修改该 checkout 的其他代码或移除 StrictMode；未重启或创建服务。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `yarn test:run test/pdf-text-pagination.test.tsx -t StrictMode`（修复前） | 新增 2 项均失败，复现 ready 不结束。 |
| `yarn test:run test/pdf-text-pagination.test.tsx`（修复后） | 8/8 通过，含 2 项 StrictMode 回归。 |
| `yarn test:run test/pdf-viewer test/intermediate-document-viewer.test.tsx test/pdf-text-content.test.tsx test/pdf-text-pagination.test.tsx test/pdf-text-viewer.test.tsx test/reading-progress.test.tsx test/epub-pagination-controls.test.tsx test/button-only-input.test.ts --maxWorkers=4 --minWorkers=1` | 13 文件、452/452 用例通过，37.10 秒。 |
| `yarn typecheck` | 通过。 |
| `yarn exec eslint src/pdf/usePdfTextPagination.ts test/pdf-text-pagination.test.tsx` | 通过。 |
| `git diff --check` | 通过。 |
| `node strictmode-browser.mjs before` / `after`（证据包内脚本） | 两次均退出 0：确认修复前 dev 失败/preview 正常，以及修复后两端翻页顺序相同、滚动不翻页。 |

首轮完整实现的 1205 项全量测试和 WebView 构建见 `ham130-acceptance.md`，属于本次修复之前的结果；本轮运行的是以上 452 项受影响面，未重跑全量或构建。没有新增实机验证结论。

## 证据包

- `strictmode-fix.patch`：相对于上一轮交付，仅 hook 与回归测试的增量补丁。
- `implementation.patch`：当前完整未提交实现，含新增文件；从原始起点应用。与增量补丁二选一，不能重复应用。
- `strictmode-before/`、`strictmode-after/`：JSON 报告、截图及所用 PDF；`strictmode-browser.mjs` 为对照脚本（放在含 `reader/node_modules` 的工作目录运行）。
- `logs/`：本轮修复前后测试、类型检查、ESLint 与浏览器日志。

仍需 iOS/Android WebView 实机完成任务 5.2，不能用本轮 Chromium 验收代替原生长按选区与手柄验证。
