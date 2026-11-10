# Tasks

## 1. PDF Text 视觉与几何适配

- [x] 1.1 在 `PdfTextHandle.tsx` 接入 `PdfTouchSelectionHandle` 共用视觉，保留按钮 ref、可访问名称及库端点元数据；通过组件用例验证草稿/已有高亮均有 20px 圆、2px 白边、整体阴影、后置竖线及 40×40 热区，颜色沿用对应选区或高亮且去除 alpha。
- [x] 1.2 基于真实源端点行矩形适配 Text 起上终下位置与 px/percent 坐标，保留当前列过滤；测量按 selectionId 隔离内容并使用 runtime DOM offset，覆盖重排插入空白；扩展 PDF Text 组件/几何测试，验证起止端、重排、不同字号及离屏端点无替代柄，同时 Layout 50%/100%/200% 的尺寸与位置断言继续通过。

## 2. Text 拖动协议适配

- [x] 2.1 为 PDF Text 配置抓取点到库期望端点的坐标纠偏，并对纠偏后文字位置做命中与放大镜跟随；补充 PDF Text 行为用例，验证中心、白边和圆外 9px 热区角落抓取均不跳选、跨行范围准确、热区外不截获正文，`useRangeHandleDrag` 默认路径测试仍通过。
- [x] 2.2 保持 linkedMode 的更新/确认流程和 pointerId/reader 归属，处理最终释放及取消清理；用行为测试验证快速释放的最终字符锚点、草稿单次确认、已有高亮单次更新且保留 ID/颜色/评论关联，pointercancel、失焦、换模式/工具/文档、卸载不额外提交或遗留放大镜与监听，多 reader 实例不串会话。

## 3. 集成与设备验收

- [x] 3.1 运行相关回归 `yarn test:run test/range-handle-drag.test.tsx test/range-magnifier-rect-handle.test.tsx test/text-selection-magnifier.test.tsx test/pdf-text-selection-geometry.test.ts test/engine-selection-controls.test.tsx test/pdf-handle-drag.test.tsx test/pdf-viewer/pdf-touch-selection.test.tsx` 及新增 PDF Text 用例，并运行 `yarn typecheck`；记录结果，确认 Layout、矩形及非 PDF 默认路径无回归，检查源码 diff 不含 EPUB 逻辑变更。
- [x] 3.2 运行 `yarn build:webview` 与 `yarn verify:webview` 后，在 iOS/Android WebView 对同一 PDF 的 Layout/Text 草稿和历史高亮截图对比；交付覆盖窄屏 320px、横竖屏、字号、首末行及热区边缘的验收记录，验证白圈完整、竖线及阴影一致、无遮挡/裁剪、无原生手柄/菜单、Text 不滚动或自动翻页、放大镜开关正常、保存重开字符范围一致；设备未覆盖项明确标记未验收。
- [x] 3.3 回归桌面 PDF Text 与 Layout 鼠标调整、Layout 触摸手势及 EPUB/其他格式选择；桌面 Layout 同样使用统一手柄外观和热区，但原生 Selection 更新/确认流程不变。将结果与统一手柄规格的各场景逐项对照，遗留失败项修复并复验后交付实现结果。

## 4. 文字模式已保存高亮错位修复

- [x] 4.1 普通高亮和分组高亮进入 selection runtime 前统一转换为当前 DOM offset；分页/书签继续使用 canonical source anchor，回归展示空白、源顺序重排、保存重开及非 PDF 隔离。
- [x] 4.2 使用真实 selection 库和 PDF Text viewer，在 WebKit 触摸上下文、大字号及重排后测量字符 Range 与手柄圆心；记录修复前后数据，并明确与 iOS WKWebView 设备验收的区别。

## 第三轮验证记录

- 证据和复现命令见 `docs/ham182-pdf-text-handles.md`。旧单条高亮分支使首末柄均偏移 36px（一行），去掉该分支后同一 fixture 的端点与圆心对齐。
- WebKit 实际重排的 20 个几何检查通过，合成触摸事件拖动与草稿确认的源字符范围检查通过。使用受控已存高亮和 DOM Range 草稿初始化；不代表 iOS WKWebView 原生手势已验收。
- 全量 118 文件 / 1549 项通过；typecheck、改动源码/测试及检查脚本 ESLint 通过；WebView 构建及 293 个资源校验通过。原 PDF 的 iOS 大字号设备复验仍未完成，不归档 change。

## 前两轮验证记录

- 相关回归 9 个测试文件 52 项通过；随后完整回归 118 个测试文件 1541 项通过，另新增的真实库桌面鼠标用例单独通过。`yarn typecheck`、改动文件 ESLint 与 `git diff --check` 通过，源码 diff 不含 EPUB 逻辑。
- `yarn build:webview` 与 `yarn verify:webview` 通过，293 个 WebView 资源校验一致。
- 验收修复后完整回归 118 个测试文件 1546 项通过；5981 服务的 Chromium 实测确认 Text 跨行两端与 Range 首末矩形对齐，桌面 PDF Layout 鼠标手柄复用统一视觉且终点位置一致。
- 当前环境未连接 iOS/Android 设备或模拟器；两平台同文档截图、320px 窄屏、横竖屏、首末行遮挡/裁剪、原生手柄/菜单及真机保存重开均标记为未验收。JSDOM 结果不替代这些设备项。

## 5. 竖线、插入点与滚动跟随优化

- [x] 5.1 `PdfTouchSelectionHandle` 接收每端实际字符高度，Text 与 Layout 分别测量首末行；覆盖跨行不同高度、字号变化和重排。
- [x] 5.2 PDF Text 接入 `RangeMagnifierProvider` 与 viewer 级 `TextSelectionMagnifier`，关闭重复的库镜片；插入线按快照缩放/裁剪换算并跟随 caret 行高，覆盖中心、边缘、释放和取消清理。
- [x] 5.3 先测量 absolute 高亮与 fixed 手柄的滚动偏差，再选择最小修正；保留 portal，scroll 时提交当前矩形并在 rAF 直接写最新坐标，记录修复前后错位帧数，回归正常滚动和其他选择面。

## 第四轮验证记录

- Chromium 实际排版中，Text 首末端字符/连接线为 27/27px；放大镜插入线宽 2px、高 54px，缩放后的中心坐标为 `(60,60)`，释放后清理。跨行不同高度的单元回归同时覆盖 Layout。
- 6px/帧连续滚动时，修复前 30 个有效样本中手柄有 29 个新增错位帧，高亮为 0；修复后手柄与高亮均为 0。保留 fixed portal 和 absolute 高亮，未迁移图层。
- 完整回归 118 文件 / 1553 项通过；typecheck、改动文件 ESLint、diff 检查、WebView 构建及 293 个资源校验通过。OpenSpec tasks 12/12，strict 校验通过。
- 本轮 WebKit 脚本因运行环境缺少 `libicudata.so.74` 未能启动；新增结果来自 Chromium，不记为 WebKit 或 iOS/Android 原生验收。既有设备未覆盖项仍未验收。

## 6. 文字模式鼠标放大镜对齐

- [x] 6.1 PDF Text 鼠标/笔输入时镜心严格对齐原始 clientX/clientY，采样及插入线使用同一指针坐标，忽略选择层转发的纠偏事件；触摸保留显式避让常量，其他选择面不变，补充偏移热区、转发事件及边缘回归并完成类型、构建和规格校验。

## 第五轮验证记录

- `node scripts/check-pdf-text-magnifier.mjs`：真实 Chromium 鼠标输入，PDF Text 首末端热区各 3 个拖动点，镜心等于原始指针；快照采样及白边内标记映射误差均 < 0.1px。快照边缘保留源区域裁剪，镜心不被挪离指针。单元回归覆盖鼠标、笔、纠偏转发、手柄替换和触摸避让。
- 最终相关回归与 viewer 全文件复验：8 文件 / 386 项通过。全量首次为 117 文件通过、1 文件失败，1555 项通过、1 项 TXT 合成分页用例超过默认 5s；该文件包含在最终 386 项复验中，未修改测试或超时阈值。未把首次全量运行记为全绿。
- 最终 typecheck、改动文件 ESLint、diff 检查、WebView 构建及 293 个资源校验通过，构建 `877b4787e74f00ac`；strict 规格校验通过。真机触摸与原 PDF 的设备验收仍未覆盖。

## 7. 按澄清分离镜片布局与内容采样

本节取代 6.1 的镜心贴指针约束；第五轮记录仅描述当轮提交，不作为当前验收要求。

- [x] 7.1 恢复 `06b2e46` 之前的镜片布局、上下避让和边缘约束，仅 PDF Text 的采样与标记改用物理指针；保留白边内比例坐标修正，回归纠偏转发与触摸，并在网页版对照 PDF 预览放大镜内容相对采样点的偏移，更新规格和验证记录。

## 第六轮验证记录

- Chromium 真实鼠标：Text 首末端热区共 6 点，镜片位置与 `17c3542` 布局契约一致；采样和标记投影误差 < 0.1px，常规区域采样相对物理指针为 `(0,0)`。快照边缘维持原裁剪，单独校验该规则。
- 实际 Reader + PDF.js 预览模式、50% 缩放，在线中心热区抓取以消除有意的抓取偏移，拖动 3 点。预览采样相对物理指针约 `(-0.0102,0)` px，与 Text 常规区域无额外纵向偏移；没有修改 PDF 预览逻辑。
- 相关回归两组共 13 文件 / 77 项通过，包含鼠标/笔/触摸的物理采样、纠偏转发、旧镜片上下布局、边缘约束、非 PDF 默认路径、选区提交和取消。
- typecheck、改动文件 ESLint、diff 检查、OpenSpec strict 通过；WebView 构建及 293 个资源校验通过，构建 `6c612587f5d99f7d`。本轮未重跑全量，原 PDF 和原生真机触摸仍待验收。

## 8. PDF 预览镜片垂直距离

- [x] 8.1 先测量 Text 与预览镜片底边到物理指针的距离，仅在 PDF 预览控制器的布局点增加垂直避让，保留采样、左右钳制和上下翻转；Text 源码不变，回归其原有 6 点与采样，并记录预览调整前后数据。

## 第七轮验证记录

- Chromium 鼠标从终点热区圆心外各 9px 抓取，再下移 200/220px，Text 镜片底边距指针均为 50.515625px，50% PDF 预览由 43px 增为 51px。仅预览布局锚点上移 8 CSS px，与 Text 相差约 0.48px；不声明任意字号和缩放下严格等距。
- Text 原六点镜片、采样和标记完整 JSON 与修改前精确相同，常规采样相对指针保持 `(0,0)`；预览三点采样仍约 `(-0.0102,0)` px。Text 生产文件及共享几何零改动。
- 预览左右边缘真实鼠标拖动：镜片分别停在 8px 左边距、8px 右边距，上方空间不足时均翻到下方。相关回归 7 文件 / 47 项通过，含鼠标/触摸 start、move 的布局与采样分离和取消清理。
- typecheck、改动文件 ESLint 与 diff 检查通过；本轮未跑全量及真机触摸，设备验收边界保持原记录。
- WebView 构建与 293 个资源校验通过，构建 `85c21fab6f9aed6b`；OpenSpec strict 通过，任务 15/15 完成，等待验收，不归档 change。
