# HAM-271 设备验收记录

设备行为基线为 `23e0ad819fdb0aa1f266b5fcb0ad813f0053051f`，分支 `agent/agent/d7dc6d4f8c5e`，PR [#80](https://github.com/HamsterNote/reader/pull/80)。2026-11-15 协调者结合增量复审和设备报告收下验收 1 与 S12 第 3/4/5 步，并授权将任务 5.3 / 5.4 标为完成。同步与归档提交只改 `openspec/`，不改变此设备基线的行为。

## 证据与适用范围

- [设备报告 HAM-271-23e0ad8-device-report.md](https://multica.ai/api/attachments/01a1de04-d905-771c-8de4-696c19ebbb9a/download)
- [原始证据 HAM-271-23e0ad8-device-evidence.zip](https://multica.ai/api/attachments/01a1de05-b158-7712-b484-3f13320ca76e/download)
- [代码增量复审与独立回归证据](https://multica.ai/api/attachments/01a1ddf2-d2f6-7f08-9734-1a5ff8c1a138/download)
- [开发全量检查与红绿回归证据](https://multica.ai/api/attachments/01a1ddee-eef3-7e0a-8cbe-46dec4ef07d3/download)

设备为 iPhone 18 Pro **模拟器**，iOS 27.2 / 24B8117。首切样本为 57,618 字节、200 页合成纯文字 PDF，SHA256 为 `626438f55508f04462ae98aaa020de5cdd8d0531ea3b1eb458d6a8128792e1c1`。不外推到物理真机、大体积扫描件或真实远端 OCR provider；A 的 OCR QA 缓存为合成数据。

构建成功，Web 资源 build 为 `12e77f326b835f89`；六个实际文档会话的 293 个资源、manifest 和 publication 哈希已逐项核对。资源 ZIP SHA256 为 `585d6941c11da230b893816a3b86995557fbaba20effec9f396efd189c2372dc`。

## 收下的设备结果

以下均为 UTC，完整原始日志和截图在设备证据 ZIP 内。

| 路径 | 结果 |
| --- | --- |
| 验收 1 | 06:44:25.838773 发点击 → 26.121 open → 26.454 RN 页数就绪 → 28.638 真实翻页生效，**2.799 秒**；该首切会话无握手超时。 |
| S12 第 3 步 | B1 → A1 → B2 → A2 完成，绿色保留；06:52:00.251 改红 revision=7，10.438 重开仍红 revision=8。第二次 B→A 死结未重现。 |
| S12 第 4 步 | 06:52:19.095 删除 revision=9、ranges=0；32.353 重开 revision=10、ranges=0。 |
| S12 第 5 步：冷远页与返回 pdfjs | 第 180 页 canonical/materialize 后实际改绿；06:53:40.083 为 WEB_ACTIVE、新 generation=1、原生已卸载，pdfjs 显示绿色且无旧 error 页。 |
| S12 第 5 步：跨空白页与返回书库 | canonical UTF-16=[19,0,18]，实际删除后返回书库，重开 ranges=0；不重载内部 Web 的全新记录首次激活成功，06:58:17.917 返回书库。成功激活均无 activate-wait-timeout。 |

此前 `f6e1f6d` 的 2.735 秒为历史测量，不替代本次 2.799 秒。0.064 秒单次差异不足以归因于布局合成或环境。

## 保留的风险与未覆盖项

协调者明确接受以下两项残余风险，不阻断本次合并；没有把它们写成已解决：

1. 首个 cross 记录在切原生前有一次外层 Web 8 秒握手超时，原因未定位；随后原生进入、删除、返回和重开均成功。不能声称整轮日志零超时。
2. 诊断重载后、内部 Web ready 前的首次跨页点击未弹菜单，ready 后需再点一次；不重载内部 Web 的新记录首次点击成功。

录屏未见旧 Web 透出或闪回，实际触摸由原生界面接收；加载完成时工具栏曾换行并移动内容起点，不宣称完全无布局变化。未对长时间失败叠层专门注入触摸故障，也未在设备上触发“放弃未确认内容”出口；该出口的取消、过期确认和数据保全仅有代码与自动化回归证据。
