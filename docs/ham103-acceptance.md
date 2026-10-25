# HAM-103 EPUB 标注与浏览器交互验收

> 原生与默认路由的后续结果见 `docs/ham91-final-acceptance.md`；本文未通过项为当时状态。

日期：2026-10-23。接续 `agent/ham-91-integration` 的 `373fd91`。
本次交付浏览器和 EPUB 能力；原生设备门槛仍未通过，默认入口仍需显式启用新引擎。

## 实现范围

- EPUB Layout 使用 reader 自有叠加层，复用矩形编辑、绘图和裁切组件；保存仍使用
  `page-N`、既有 px/percent 坐标及绘图 JSON。补入的封面仍为 `page-1`。
- 跨章节高亮在当前 iframe 只显示所属端点的手柄，编辑时只替换该端点；另一端、
  ID、createdAt 和样式保留。文本仍遵守旧版首章后缀加末章前缀契约。
- 手柄连接放大镜。EPUB 通过静态呈现树在 reader 文档中栅格化，避免
  html2canvas 的内部 iframe 被出版物 CSP 拦截；不放宽出版物 CSP。
  审核发现直接导入正文会让样式和资源请求离开 iframe 策略，现改为只创建
  div/br、文本节点和已解码图片的 canvas，不复制出版物 DOM、属性或样式表。
  样式仅允许无资源 URL 的排版属性，字体限通用族，临时树使用 Shadow DOM 隔开
  宿主选择器，并以 containment 限制定位范围。
- 映射旧 `onSelectionStart/End`、`onTextSelectionChange/End` 和 `onSelectText`。
  旧 detail 返回原文本对象，segments 保留每个文本的切片和局部偏移；结束事件与
  change 使用独立异步代际，切书后丢弃旧结果。
- EPUB 隐藏章节退出自然翻章序列，裁切编辑时恢复；PDF 隐藏页在编辑时原位显示
  虚线占位。EPUB 回收 iframe 时释放文档监听器并恢复静态索引，重进章节重新定位。
- 修复 Demo 进度更新清空选中 ID 的问题；PDF StrictMode 重放重建会话管理器，
  每次打开复制字节，避免 PDF.js worker 转移调用方 buffer 后再次打开失败。

## 自动检查

环境：Linux、Node 24.15.0、Yarn 1.22.22。命令日志随 issue 附件交付。

| 命令 | 结果 |
| --- | --- |
| `yarn typecheck` / `yarn typecheck:host` | 通过 |
| `yarn lint` | 通过 |
| `yarn test:run` | 安全修复后 83 文件、1130 项通过 |
| 放大镜受影响测试：`magnifier-capture-source`、`range-magnifier*`、`text-selection-magnifier` | 6 文件、16 项通过 |
| `yarn build` | 库 JS、类型、CSS 与 Demo 构建通过 |
| `yarn build:webview` / `yarn verify:webview` | 通过，293 个资源，zip 约 15.4 MiB |
| `yarn pack:check` | 通过，287 个发布文件 |
| `node scripts/check-delivery.mjs` | tarball 旧 API/CSS 消费者、Vite 客户端及打包 SSR 通过；移除必需 WASM 后校验正确失败 |

保留既有 act/font、OCR/OpenCV 大包和 externalized 警告；检查使用当前锁定依赖，
不代表所有历史依赖组合。放大镜捕获章节快照的耗时随章节 DOM 规模增长，未在原生
设备上测得性能数据；40 页 PDF 的回收断言也不等价于原生内存峰值测试。

## 浏览器矩阵

```bash
READER_BROWSER_CASE=chromium READER_BROWSER_OUTPUT=../ham103-browser/compat node scripts/check-reader-browser.mjs
READER_BROWSER_OUTPUT=../ham103-browser/interactions node scripts/check-engine-interactions.mjs
```

| 测试入口 | 视口 | 结果与断言 |
| --- | --- | --- |
| 构建后的真实 WebView 入口，模拟宿主协议 | Chromium 1280×800 / 390×844 | 13/13；EPUB/PDF v2/v3/v4 恢复、编辑、重载，初始化零写入，评论/书签/历史标注保留；出版物脚本攻击探针通过 |
| Demo `?engines=next`，真实 Foliate/PDFViewer | Chromium 1280×800 / 390×844 | EPUB/PDF 共 4/4；矩形创建/确认/角点编辑/undo/redo、文本工具激活矩形、绘图落盘、裁切、隐藏占位、拖出预览和回收恢复 |
| EPUB 跨章节高亮 | 两种宽度 | 首尾端点独立编辑；放大镜非空像素断言和截图；已脱离 iframe 重进后矩形/绘图恢复，持久化标注不变 |
| EPUB 隐藏章节 | 两种宽度 | 滚轮自然翻章跳过隐藏章节；移动宽度另以 CDP 真实触摸输入验证滑动跳章 |
| 自动补入封面 | 两种宽度 | 矩形保存为 `page-1` 并可激活；隐藏封面后离开封面进入可见正文；初始化隐藏跳转完成后再恢复进度 |
| 40 页 PDF | 两种宽度 | 从两页样本交替复制生成；逐段滚到第 40 页后首页 canvas 脱离，回页有字形像素、文本层和叠加标注，存储不变 |
| WebKit 启动探针 | 桌面 | 未通过：缺 ICU74、libxml2、libevent、libflite 等系统库 |

交互脚本隐藏 Demo 设置侧栏以获得实际嵌入阅读器宽度，关闭 VirtualPaper；主编辑
路径使用鼠标指针，两种宽度均有截图。移动宽度的 tap/触摸滑动由 Chromium 模拟，
不等价于 iOS/Android 长按选择。章节切换 setup 使用 Foliate 的公开 renderer API，
隐藏页自然翻章另用真实滚轮/触摸输入。图像和日志在 issue 附件中，不依赖本机路径。

## P1 隔离边界回归

```bash
READER_MAGNIFIER_SECURITY=1 READER_BROWSER_OUTPUT=../ham103-security/browser node scripts/check-engine-interactions.mjs
```

Chromium 1280×800 与 390×844 共 2/2 通过。在没有额外宿主 CSP 的 Demo 中导入
含攻击内容的真实 EPUB，确认攻击 style、HTTPS 图片和 computed background URL
仍在出版物内，且原 `frame-src 'none'` 保持生效；拖动跨章高亮首尾手柄前、过程中、
结束后，宿主颜色保持黑色，MutationObserver 未发现瞬时颜色泄漏，探针请求为零。
覆盖 stylesheet/import、img/srcset、SVG image、computed background/border/list/cursor、
伪元素 content 和同名宿主惰性字体；所有探针请求由浏览器 route 中止，不访问外部服务。
同时断言放大镜非空字形像素、本地已解码图片确实转为 canvas，以及端点数据正确保存。

负向对照临时运行修复前的截图函数：同一桌面用例在首次手柄拖动时检测到宿主
`rgb(255, 0, 0)` 瞬时污染与多种探针请求，按预期失败；随后恢复修复代码。
普通 EPUB/PDF 交互另复跑 4/4 通过。最初将攻击样本跑完整交互时移动触摸翻章有一次
超时，因此安全用例在双端点验证后独立结束，普通样本仍完整执行触摸翻章检查。

静态放大镜快照不保留出版物自定义字体、CSS 背景图片、伪元素、内联 SVG/MathML
或交互控件；不可读的图片像素直接省略。复杂排版与快照几何的保真仍有局限，
本次不能据此认定原生性能或所有排版样本已验收。出版物本身的显示不作上述替换。

## 未通过项与回滚

- iOS：Linux 无 `xcrun`，无本次 dev client 构建、设备截图或录屏。
- Android：SDK 可执行，但 `adb devices` 和 `emulator -list-avds` 均为空。
- 两平台的打开/保存/重开、横竖屏、原生长按、后台恢复、错误重试、断网及设备安全
  边界验收均保留为未通过；WebKit 不可用也不记为通过。
- OpenSpec 5.1/5.2 的完整矩阵及 5.4/5.5 原生和默认路由门槛仍不据此勾选。
  本次不切默认路由，不删除旧主展示，不创建 PR。

备份原 JSON、对应文件的 localStorage 和原生 `reader-host/`、`reader-files/` 后再
导入或回滚。浏览器去掉 `?engines=next`，库消费者不传 `engineSource` 即回到旧入口。
代码回滚可撤销本次提交，恢复 `373fd91` 并重新构建；保留同一分支已有提交。
本次不迁移 JSON schema；历史 v2/v3/v4 和新输出的旧读入器往返测试通过。
原生整包回滚和设备重开仍需设备验证，不能从浏览器结果推断通过。
