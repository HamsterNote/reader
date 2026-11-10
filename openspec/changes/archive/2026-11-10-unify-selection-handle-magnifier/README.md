## 归档记录

2026-11-10 按 HAM-201 收尾指令归档；审核已给出“可合入”。使用 `openspec archive unify-selection-handle-magnifier --yes --json` 同步 delta 到主规格，新增 7 条、修改 3 条 requirement。

主规格：

- `openspec/specs/reader-text-selection-interaction/spec.md`：三渲染面唯一共享交互契约。
- `openspec/specs/epub-web-reader/spec.md`：引用共享契约，保留初选、分页和有效范围规则。
- `openspec/specs/pdfjs-web-reader/spec.md`：引用共享契约，替换旧镜片/位移规则，保留 PDF Layout 连续选择及边缘滚动。

`openspec validate --specs --strict --no-interactive`：5 份主规格全部通过。

任务仍为 12/13，4.3 真机项保留未勾选；本次按明确归档指令收尾，不将 iOS 模拟器或 Linux 浏览器证据冒充 iOS/Android WebView 真机验收。设备型号、运行时、自动化范围及待验边界见 `docs/ham201-selection-interaction.md`。

Mac 操作员已在 iPhone 18 Pro 模拟器 / iOS 27.2 (`24B8117`) / Safari 对 `6f48cdd` 复验 EPUB：交接后系统 HID Cmd+A 选中当前章 12 段、363 字符，点击可见“高亮”只保存一条，端点 `[0,363]`；无中途 iframe pointerdown。该 runtime 不派发 DOM keydown/up，观测到 trusted selectionchange 后重新交接。触摸首拖从 `beta [13,17]` 到 `beta gam [13,21]`，释放保持、镜片关闭。
