# 兼容样本来源清单（任务 1.1）

基线：`237c0d51a4fc76d8c6f233bd2598ac7a14d12500`。本文档固定 EPUB/PDF 样本与
同文件 v2/v3/v4 高亮 JSON 的来源、覆盖点与坐标系约定。后续三条主线（EPUB /
PDF / Expo 宿主）的兼容索引与桥接实现 MUST 以本清单中的样本为验收输入。

## 位置与再生

- 样本文件：`test/compat/fixtures/`（全部提交进仓库）。
- 生成器：`test/compat/generate-fixtures.mjs`，运行
  `node test/compat/generate-fixtures.mjs` 可逐字节重建全部样本（zip 目录项与
  pdf 元数据时间戳固定为 `2026-01-01T00:00:00Z`，PNG 为内嵌 1x1 base64）。
- Round-trip 测试：`test/compat/epub-fixtures.test.ts`、
  `test/compat/pdf-fixtures.test.ts`、`test/compat/highlight-json-roundtrip.test.ts`，
  经 `yarn test:run` 运行，验证旧读入器（`@hamster-note/epub-parser` +
  `demo/epubForReader`、`@hamster-note/pdf-parser`、`demo/highlightStorage`）
  能读取全部合法样本。

## 坐标系约定（端点语义的固定定义）

- 公开页面 ID：`page-N`，N 从 1 开始，匹配 `/^page-[1-9]\d*$`
  （`demo/highlightStorage.ts:34`）。EPUB 的 N 按 Reader 转换层输出的逻辑页序
  （封面在 spine 时封面为 page-1）；PDF 的 N 为原 PDF 页号。
- 端点 `offset`：页内全部文本项 `content` **无分隔符拼接**后的字符偏移，
  跨页 range 的 `text` 为起点页选中后缀与终点页选中前缀的直接拼接
  （`src/components/selection/selectionPayloadSerializer.ts:285` `.join('')`；
  页内偏移语义见 `src/components/IntermediateDocumentViewer/textAnchor.ts:63-79`
  与 `textHighlightAdapter.ts:71-96`）。
- 每个高亮 JSON 的端点 offset 由生成器用旧解析链路解析同一二进制样本计算
  得出，保证样本与 JSON 逐字一致；round-trip 测试逐条验证
  `pageText.slice(start.offset, end.offset) === range.text`（跨页按拼接规则）。

## EPUB 样本

| 文件 | 覆盖点 | 旧读入器行为断言 |
| --- | --- | --- |
| `epub/cover-and-image-order.epub` | 封面（spine 首位）、图片顺序、外链图忽略、同一插图重复引用、末章复用封面图 | 3 页；page-1 为封面图（alt `Book cover`）；正文文本逐字固定 |
| `epub/spine-omits-cover.epub` | 补封面（manifest `cover-image` 但 spine 省略）、正文复用封面图 | 转换层补出封面 page-1，正文页序不变（共 3 页） |
| `epub/duplicate-text.epub` | 重复文本（第 1、3 章含逐字相同段落「重复的段落文本。」）、跨页高亮端点 | 4 页；重复段落分别在 page-2、page-4，页文本逐字固定 |

构造方式：JSZip 生成 EPUB 3 包（`mimetype` STORE 首条目、`container.xml`、
`package.opf`、nav.xhtml），结构与 `test/epub-parser-integration.test.ts`
的现有夹具一致；图片 manifest 必须声明，否则解析器丢弃。

## PDF 样本

| 文件 | 覆盖点 | 旧读入器行为断言 |
| --- | --- | --- |
| `pdf/two-column.pdf` | 多栏（左栏两行 + 右栏两行）、跨页（2 页） | 页 1 文本按绘制顺序拼接为 `Left column line oneLeft column line twoRight column line oneRight column line two`；页面 400x300 |
| `pdf/rotated.pdf` | 旋转（/Rotate 90） | 可视尺寸 300x400（宽高交换），文本完整提取 |
| `pdf/ligature.pdf` | 连字（Type0 字体 ToUnicode 将单字形映射 U+FB01） | 文本层 NFKC 分解为 `fi`，页文本逐字为 `fi x` |

构造方式：`two-column.pdf` / `rotated.pdf` 由 pdf-lib 生成；
`ligature.pdf` 为手工 PDF 1.4（生成器内联对象源码），不依赖外部字体文件。

## 同文件 v2/v3/v4 高亮 JSON

同一文档的同一组标注，三个历史格式版本各一份：

| 文件族 | 绑定文档 | 内容 |
| --- | --- | --- |
| `highlights/epub-duplicate-text.v2/v3/v4.json` | `epub/duplicate-text.epub` | 跨页 range（page-2→page-3，percent 矩形）、重复文本 range（page-2 首次出现，px 矩形）；v3 起含 px/percent 矩形各一；v4 含 page-3 绘图 |
| `highlights/pdf-two-column.v2/v3/v4.json` | `pdf/two-column.pdf` | 跨页 range（右栏第二行→page-2 开头，percent）、单页 range（左栏第一行，px）；v3 起含 px/percent 矩形各一；v4 含 page-1 绘图 |

格式语义（与 `demo/highlightStorage.ts` 解析器一一对应）：

- v2：`{ version: 2, ranges }`，无 rects/paintings；读取后按既有兼容规则补
  `rects: []`、`paintings: {}`。
- v3：`{ version: 3, ranges, rects }`；读取后补 `paintings: {}`。
- v4：`{ version: 4, ranges, rects, paintings }`，现行写入格式
  （`serializeHighlights`）。
- 升级契约：v2/v3 读取后以 v4 回写，ranges 逐字段不变，缺失的
  rects/paintings 只补默认空值，不凭空生成或丢弃标注。
- `overlayRectType`（`px` / `percent`）是持久化契约的一部分，读取不得
  归一化；样本同时覆盖两种单位。

## 覆盖矩阵对照

| 要求覆盖点 | 样本 |
| --- | --- |
| 跨页 | `epub-duplicate-text.v*.json` 的 `epub-range-cross-page`；`pdf-two-column.v*.json` 的 `pdf-range-cross-page` |
| 重复文本 | `epub/duplicate-text.epub` + `epub-range-duplicate-first`（锚定首次出现） |
| 封面 | `epub/cover-and-image-order.epub`、`epub/spine-omits-cover.epub` |
| 图片顺序 | `epub/cover-and-image-order.epub`（外链图忽略、重复引用、末章复用封面图） |
| 多栏 | `pdf/two-column.pdf` |
| 连字 | `pdf/ligature.pdf` |
| 旋转 | `pdf/rotated.pdf` |
| px/percent | 两个文件族的 ranges 与 rects 同时覆盖两种单位 |
| 绘图 | 两个文件族的 v4 `paintings` |
