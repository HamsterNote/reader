# HAM-217 放大镜几何实现与验收记录

基线为 `aed81e705bb6d4a5bf4c1a6996fed516a5731b60`（HAM-216 / PR #61）。附件 `ham-217-openspec-propose.zip` 的六个 change 文件先原样提交于 `961c818`，之后仅修改 `tasks.md` 复选框；proposal、design、两份 delta 和元数据保持逐字节一致。最终实现提交 SHA、命令、原始输出和环境另见交付评论附件的 `manifest.json`、`commands.json`、`environment.json` 与日志。

## 实现

- `selectionInteraction.ts` 是唯一参数来源：半径 38 CSS px，直径由半径派生为 76，中心距 76，倍率 2。文字取景、镜片外框和插入线共同使用；移除 CSS 中独立的文字倍率/标记宽度回退。
- `magnifierViewport.ts` 读取同文档 CSS env 探针，计算阅读器、layout viewport 安全矩形、visual viewport 的 client 坐标交集。已下移到安全区的容器不再扣一次 inset；空交集隐藏镜片，恢复后重算。每帧复用布局测量，视口/容器变化合并更新；结束、失焦、文档替换和卸载移除探针、帧及监听。
- `rangeMagnifierGeometry.ts` 先检查完整上方候选，贴边仍在上方；仅放不下时翻下，取消额外 8px 阈值。横向夹取，极小区域居中；只改变显示，不移动命中和取景。
- 文字镜片不再叠加 PDF 专属 transform。矩形快照仍为原来的 120px / 78px / 8px 规则，保留单独定位函数和 CSS。未修改 Selection 交接、高亮存储、公开格式或依赖。

## 六条验收对应证据

| 验收                  | 结果与证据                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 三面共用常量       | 通过代码与消费链检查。参数检索的实际 `rg` 命令、原始输出见 `commands.json` 和 `02-constant-consumers-final.log`；PDF Text 没有独立尺寸/倍率来源。                                                                                                                                            |
| 2. safe area 与翻转   | Chromium DOM 矩阵通过。375×667 上/下 inset 20/34，阈值 y=134；390×844 为 47/34，阈值 y=161。每组 T+115、T+114、T+113、T+114、T+115 为上、上、下、上、上。120 组共 960 个外框测量，误差在 1px 内。零 inset、偏移/已安全避让容器、左右 inset、visual viewport、空区域恢复另有单测。            |
| 3. 半径、距离和倍率   | PDF Layout 72 组、EPUB 24 组、PDF Text 24 组；两视口、DPR 1/2/3，PDF Layout 50%/100%/200% 缩放。外框半径均为 38px；未横向夹取样本中心距为 76 至 76.00625px。真实源/镜内 `alpha` 的 Range 外框宽高按 2 倍比较，最大宽度误差约 0.000031px，高度误差为 0。                                      |
| 4. 不遮触点           | 未夹取样本轴向间隙为 38 至 38.00625px；原始触点、镜片外框、placement、距离和间隙均保存于 `magnifier-geometry.json`。极小视口的夹取样本按原提案排除在标准距离测量之外。                                                                                                                       |
| 5. 生命周期与首拖回归 | 自动化通过：共享 36 组 touch/mouse/pen × 三面 × 起止柄 × 草稿/已有高亮；PDF 预览 48 草稿 + 48 已有高亮真实鼠标拖动；PDF Text 在 Chromium、Linux WebKit 各 40 组释放/取消/确认/重新选中；EPUB WebKit 四组。原生长按后的 EPUB 首拖和三面设备外框/安全区 **未验**，不能将合成事件视为设备通过。 |
| 6. 主规格与 strict    | 同步共享与 PDF 两份 delta；共享主规格不再要求旧约 1cm 中心距，PDF 不再要求旧 18px 锚点、预览 8px 上移或 Text 六点旧基线。EPUB 继续引用共享规格，历史 archive 未改写。change 和两份主规格 strict 均通过，保留原始日志。                                                                       |

## 命令与环境

环境：Linux x86_64 / glibc 2.43，Node v24.15.0，Yarn 1.22.22，OpenSpec 1.13.1，Playwright 1.60.0，Chromium 148.0.7778.96，Linux WPE WebKit 26.4。CSS inset 是提案中的受控模拟值，经生产探针与解析器读取，未修改生产放置函数。几何矩阵初选由真实鼠标产生，后续精确坐标为合成 PointerEvent；共享 36 组使用 Chromium CDP touch/mouse/pen；WebKit 用可信 tap 与合成拖动。

| 命令                                                                                 | 结果 / 原始记录                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-release.mjs`，实现前     | HAM-216 基线 40 组通过；`01-baseline-ham216.log`。已有高亮拖后点空白取消、重新选中，范围/手柄及 ID/颜色/样式保持。                                                                                                    |
| `node scripts/check-shared-selection-interaction.mjs`                                | 36 组输入 + 120 组几何通过；`07-shared-matrix-final.log`、`shared-interaction.json`、`magnifier-geometry.json` 及截图。源字形采样点、root、外框与尺寸均在 JSON。                                                      |
| `node scripts/check-pdf-preview-drag.mjs`，另加 `--saved`                            | 各 48 组通过，failures / sampleFailures / captureFailures / hitFailures 均为 0；`08-preview-draft-pass.log`、`08-preview-saved.log`。旧脚本改用渲染端点读取受管范围，清理每轮选区并移除旧抓取补偿；鼠标断言为无镜片。 |
| `node scripts/check-pdf-text-magnifier.mjs`                                          | 12 组输入 + 24 组几何通过；`08-pdf-text-magnifier.log`。替换已过时的鼠标快照/18px 布局 oracle，复用真实 PDF Text 的共享矩阵。                                                                                         |
| `READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-release.mjs`，实现后     | 40 组通过；`08-pdf-text-release-chromium.log`、`pdf-text-release/chromium.json`。                                                                                                                                     |
| `WEBKIT_EXECUTABLE_PATH=<WPE wrapper> node scripts/check-pdf-text-release.mjs`       | 40 组通过；`08-pdf-text-release-webkit.log`、`pdf-text-release/webkit.json`。wrapper 绝对路径见附件 `commands.json`，仅为 Linux 环境适配，未修改依赖。                                                                |
| `WEBKIT_EXECUTABLE_PATH=<WPE wrapper> node scripts/check-webkit-selection-touch.mjs` | EPUB 四组通过；`08-webkit-touch.log`、`webkit-selection-touch/report.json`。                                                                                                                                          |
| `yarn typecheck` / `yarn lint` / `yarn build:all`                                    | 均退出 0；`10-typecheck.log`、`10-lint.log`、`10-build-all.log`。                                                                                                                                                     |
| `yarn test:run`                                                                      | 第一次 1 项 TXT 选区用例超过默认 5 秒，其余 1,764 项通过；当时构建与浏览器矩阵并行运行。保留失败原始输出 `10-test-run.log`。                                                                                          |
| `yarn test:run --maxWorkers=2`                                                       | 132 文件 / 1,765 项全部通过，原超时用例 1,457ms；`10-test-run-rerun.log`。未放宽超时、修改断言或改无关代码。                                                                                                          |
| `openspec validate refine-shared-magnifier-geometry --strict`                        | 通过；`11-change-strict-final.log`。                                                                                                                                                                                  |
| `openspec validate reader-text-selection-interaction --type spec --strict`           | 通过；`11-shared-spec-strict-final.log`。                                                                                                                                                                             |
| `openspec validate pdfjs-web-reader --type spec --strict`                            | 通过；`11-pdf-spec-strict-final.log`。                                                                                                                                                                                |

字形缓存和无选区覆盖通过浏览器 childList 计数为 0、镜内无 overlay 断言及相关单测验证。矩形快照回归通过。所有服务均为脚本内临时 Vite，执行结束自动关闭；本任务没有长期验证服务。

## 待设备验证

MobileBuildMCP `list_sims({})` 返回 `Failed to list simulators: spawn xcrun ENOENT`，当前环境没有 iOS 模拟器。以下均为 **未验**，`tasks.md` 的 4.3 保持未勾选：

- iOS Safari 模拟器或真机：系统长按选字后 EPUB 首次拖柄、重拖、释放、取消与确认，以及三面实际安全区/外框。
- 宿主 WKWebView 与 Android 真机：相同交互与实际 inset 表达。

复验时使用本次提交，记录设备/浏览器、root、CSS env inset、触点和最终外框，并保留截图和可信事件流。若宿主未通过 WebView 边界或 CSS env 表达物理遮挡，需要宿主补充集成；生产代码没有硬编码模拟的 20px/47px。

状态交付为“验证中”，未创建 PR、未合并、未归档 change，未将设备项改判通过。
