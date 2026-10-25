# foliate-js 自有资产清单（HAM-88 任务 2.1）

本目录是 reader 自带的 foliate-js 运行时资产，提交进仓库；干净环境构建
（`yarn install && yarn build` / `yarn test:run`）不依赖 native-reader
checkout，也不依赖任何 npm 外的运行时下载。

## 来源与版本

- 上游仓库：`https://github.com/johnfactotum/foliate-js.git`
- 固定提交：`78914aef4466eb960965702401634c2cb348e9b1`
  （与 native-reader README 记录及 submodule pin 一致；foliate-js 上游无
  正式发布，npm 上的 `foliate-js@1.0.1` 维护者非上游作者，来源不可核验，
  故不采用 npm 包，按上游建议 vendor 固定提交。）
- 获取方式：
  `curl -sL https://codeload.github.com/johnfactotum/foliate-js/tar.gz/78914aef4466eb960965702401634c2cb348e9b1`
- 本目录内容为上游原始文件，未打任何补丁（native-reader 的
  view.js/paginator.js 补丁面向其安全 WebView 宿主，与 Web 阅读层无关，
  不带入）。

## 许可证

| 文件 | 许可证 | 版权 |
| --- | --- | --- |
| 本目录全部 `*.js` | MIT | Copyright (c) 2022 John Factotum（全文见 `LICENSE`） |
| `vendor/zip.js` | BSD-3-Clause | Copyright (c) 2023 Gildas Lormeau（上游压缩构建不含许可证头，许可证全文随附于 `vendor/zip.js.LICENSE.txt`） |

## 文件清单与角色

EPUB reflow 所需集合 + view.js 动态 import 的全部目标（保证干净环境
构建时完整模块图可解析）。`pdf.js` 是 reader 自有桩：上游实验性 PDF
后端静态依赖未随附的 pdfjs 构建产物，且本项目 PDF 走 pdfjs-dist 官方
viewer 主线，不经过 foliate；打开 PDF 时显式报错。

| 文件 | 角色 | sha256 |
| --- | --- | --- |
| `view.js` | `<foliate-view>` 自定义元素：打开图书、导航、CFI、overlayer 装配 | `e0093af921feb03bb58fb51aeedc321fa108a4158d215f6913ecf7925415c945` |
| `epub.js` | EPUB 解包：OPF/spine/TOC/封面/资源加载 | `dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298` |
| `epubcfi.js` | EPUB CFI 生成与解析 | `e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645` |
| `paginator.js` | `<foliate-paginator>` reflow 渲染器（分页/滚动、样式注入） | `51cec81572d5d182e231fe68ce9c3b5489a0976b36172060516336ba893565ea` |
| `fixed-layout.js` | 固定版式渲染器（view.js 动态 import） | `7aee1d15d8e0479b8a6c59a20304b250dafc4c7dc158147a2b2c6bed9e180b4c` |
| `progress.js` | 目录/页列表进度换算 | `544f5e90babc0cb31c5caf971a5f06dd6249ec06600cb62f672fa7179811fde1` |
| `overlayer.js` | 标注叠加层（highlight/underline/hitTest） | `d3d3396e3083277ccbd4f17c407621159b22a407107e43ce75ca3014578094fb` |
| `text-walker.js` | view.js 静态依赖的文本遍历器 | `4ad740ab6142b5be428700ef4d270253cef6649cf6e047ae7d2698a7aec65e92` |
| `comic-book.js` / `fb2.js` / `mobi.js` / `search.js` / `tts.js` | view.js 动态 import 目标，随附以保持模块图完整（非 EPUB 链路不使用） | 见下表 |
| `vendor/zip.js` | zip 解包运行时（@zip.js/zip.js 2.8.22） | `2a0d43157e4a447c6e43351225758795b75a33e8dfec10c6767248df2182949a` |
| `vendor/fflate.js` | mobi 字体解压（fflate 0.8.2，仅 mobi 路径动态加载） | `e63bcc21f83a43e5f71d5cbefd351ff4d4dbd57bef8b29ad65c8bd65752f6e6b` |
| `pdf.js` | **reader 自有桩**（非上游文件）：PDF 后端不带入，见上 | 不适用 |
| `LICENSE` | foliate-js MIT 许可证全文 | `b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c` |
| `vendor/zip.js.LICENSE.txt` | zip.js BSD-3-Clause 许可证全文（reader 随附，非上游文件） | 不适用 |
| `view.d.ts` / `overlayer.d.ts` / `vendor/zip.d.ts` | reader 自有的最小类型声明（非上游文件） | 不适用 |

动态 import 目标哈希：

| 文件 | sha256 |
| --- | --- |
| `comic-book.js` | `7f3bf77561ca77300d5244015fcb1f73805787db246928074dc49fb56c88762e` |
| `fb2.js` | `09a7890bf191f1b6c6dd435fae2868b86c75e73e00731b0051c02f2a998a180a` |
| `mobi.js` | `016526df13a9f11ee6671a8c74346e1cf41fe6bdfe50165fdcbf744f015694f3` |
| `search.js` | `31e846bdc095a645de0e94f7baa2c9e136561a363a2f774d4032e72cfa1fb0ef` |
| `tts.js` | `530d34605b758a5e2260438964a85bb9909bcb49e8848e303fe22cac63859026` |

`test/epub/foliate-assets.test.ts` 逐文件校验上表 sha256，任何漂移（误改、
不完整更新）都会失败。

## 更新程序

1. 在上游仓库选定新提交（需要跨格式支持时再评估是否增补模块）。
2. 下载该提交 tarball，按上表覆盖同名文件并更新本清单的来源、哈希。
3. 运行 `yarn test:run test/epub/foliate-assets.test.ts` 与
   `test/epub/` 全部测试，并在浏览器 harness（`demo/epub-foliate.html`）
   重新验证打开/导航/高亮。
