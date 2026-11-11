# HAM-226：PDF 文字高亮重选与连续拖动排查

目前没有复现报告中的高亮大量叠加，尚未确定根因，也没有修改生产代码。本提交增加可重复运行的浏览器回归，供拿到原始复现条件后继续定位；不能将这些通过结果视为原问题已经修复。

检查基线为 reader `bc956da`。WebBase 的 `webview/package.json` 声明 reader `2.0.0`、selection `0.3.0`；reader 发布标签 `v2.0.0` 指向 `fce3193e132f6e288ae0df1e5856f420845afe22`，早于当前主线的受管手柄修复。另以该标签源码运行完整 Demo，普通 PDF 的重选、连续鼠标拖动未观察到持久条目或覆盖层增长。版本差异是后续复现需要记录的条件，尚不能据此认定根因。

## 新增回归

```sh
node scripts/check-pdf-text-reselection.mjs
```

脚本自动启动临时 Vite 并在退出时关闭，也支持 `READER_BROWSER_URL` 指向已有开发服务。报告保存在 `test-results/pdf-text-reselection/chromium.json`。

矩阵为普通 PDF / 源字符顺序与阅读顺序相反的 PDF、受控 / 非受控宿主、鼠标 / CDP 触摸输入，各执行三轮「取消选中 → 重选 → 扩大或缩小范围」。初始草稿通过原生 Selection API 建立，重选和手柄拖动使用浏览器输入事件；触摸通过 Chromium CDP 发送，不能替代设备验证。

每轮连续往返移动 25 次，逐次断言：持久条目数不增长，只有一个临时预览和一对手柄。松手后检查原高亮 ID 保持、没有新增高亮回调、保存文本准确、缩小范围会移除旧片段、没有重复 ID 或残余绘制节点。每次取消选中后检查手柄及预览全部移除。

逆序 PDF 会将一个逻辑高亮持久化为多个源字符片段：三次调整分别应为 16、6、14 个片段。这是正确的分组表示，不以错误的「所有 PDF 都只能有一个持久条目」作为断言。

本地 Chromium 148.0.7778.96 原始末行：

```text
PASS: 24 PDF text reselection/drag cases
```

现有释放、取消和确认回归：

```sh
READER_BROWSER_ENGINE=chromium node scripts/check-pdf-text-release.mjs
```

原始末行：

```text
Passed 40 PDF Text release/cancel cases in chromium 148.0.7778.96
```

相关组件单测：

```sh
yarn test:run test/pdf-text-managed-controls.test.tsx test/pdf-text-handle-library.test.tsx
```

```text
 Test Files  2 passed (2)
      Tests  6 passed (6)
```

## 未完成的验收

需要原始 PDF（或最小复现文件）、设备/浏览器、鼠标或触摸输入方式，以及 WebBase 实际加载的 reader 构建信息，才能对报告场景验证修复。本机 Linux WebKit 启动因缺少 `libicudata.so.74` 失败，未取得 Safari / WKWebView 验证结果。

当前仅完成调查及回归覆盖；原问题修复、原始场景验收仍待完成。
