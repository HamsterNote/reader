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

## Apply 验证记录

- 相关回归 9 个测试文件 52 项通过；随后完整回归 118 个测试文件 1541 项通过，另新增的真实库桌面鼠标用例单独通过。`yarn typecheck`、改动文件 ESLint 与 `git diff --check` 通过，源码 diff 不含 EPUB 逻辑。
- `yarn build:webview` 与 `yarn verify:webview` 通过，293 个 WebView 资源校验一致。
- 验收修复后完整回归 118 个测试文件 1546 项通过；5981 服务的 Chromium 实测确认 Text 跨行两端与 Range 首末矩形对齐，桌面 PDF Layout 鼠标手柄复用统一视觉且终点位置一致。
- 当前环境未连接 iOS/Android 设备或模拟器；两平台同文档截图、320px 窄屏、横竖屏、首末行遮挡/裁剪、原生手柄/菜单及真机保存重开均标记为未验收。JSDOM 结果不替代这些设备项。
