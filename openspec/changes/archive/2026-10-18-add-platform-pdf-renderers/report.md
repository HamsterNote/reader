# HAM-46 PDF 阅读第一期 归档报告

## 归档信息

- **变更**: `add-platform-pdf-renderers`
- **归档目录**: `openspec/changes/archive/2026-10-18-add-platform-pdf-renderers/`
- **日期**: 2026-10-18
- **仓库**: reader（配套改动在 native-reader PR #8 / #9）

## 验收范围

2026-10-18 需求方明确：**只验收 Web，无需验收 native 端**。据此本变更的验收结论仅覆盖 Web 路径；iOS/Android 的设备级行为不纳入本次验收，但代码保留且未勾选任务原样保留在 `tasks.md` 中。

## 已交付并验证（Web）

- reader 按内容分流 PDF / EPUB，PDF 走独立 PDF.js 渲染路径，EPUB 保留原路径与门禁。
- 离线 PDF 运行时装包、Pages 栏（页码/缩略图/跳页）、临时文本选区与占位「高亮」Popover、原生 Context Menu 抑制且保留选文。
- demo 迁移到新 source 路径；浏览器矩阵 Chromium/Firefox 21/21、禁网 rootless WebKit 7/7。
- Web Dev Server 人工验收通过（打开本地 PDF、Pages 跳页、拖选弹出 Popover、contextmenu 默认行为被阻止）。

## 未完成（18 / 33 项，均为原生与设备项）

iOS PDFKit 设备行为与 XCTest、Android 宿主真机验收（长按菜单抑制、选区 handles、content provider 与内核描述符约束）、真实 Safari 证据、公开 fixture 清单、跨平台证据汇总与文档更新。上述任务在 `tasks.md` 中保持未勾选，**不视为通过**，也未套用任何豁免。

## 规格同步

4 个新增主规格由本变更的 ADDED 需求生成（共 14 条需求）：`pdf-renderer-routing`、`pdf-pages-navigation`、`pdf-selection-popover`、`android-pdf-asset-origin`；`openspec validate --specs --strict` 4/4 通过。native-reader 侧的安全规格例外在其实施 PR 中已单独记录。
