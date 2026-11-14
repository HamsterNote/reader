# HAM-268 缩放与布局回归验证

`487766b` 的 S08 现场：offset.y=824 已经是第二槽目标，但 content.frame.origin=(-180,-406)。对带 2 倍 transform 的 view 先写 frame、再写 bounds.size，改变了两次不同坐标系下的几何量。最终第二槽屏幕 y 为 `-406 + 412*2 - 824 = -406`。仅验证目标 offset 无法捕获这个错误。

## 几何所有权

- `ReaderPdfLayout` 只生成 scale-one 的完整页 frame、裁切 slot 和文档尺寸。隐藏页不生成槽位，最后一页后不加间距。
- 只有文档/裁切布局变化或 reset 才设置 content.frame，并且先用 UIScrollView 回到 1 倍。此时初始化一次未缩放的 contentSize，恢复原缩放后由 UIKit 维护 transform 和 contentSize。代码不再写 content.bounds。
- 末页留白是 `contentInset.bottom = max(0, viewportHeight - scaledFinalSlotHeight)`，不进入 content.frame/bounds。缩放及视口高度变化只更新 inset；短单页填满视口，但最大滚动 offset 仍是 0。
- `ReaderPdfViewport.scrollPoint` 是唯一的 scale-one → scroll 坐标换算；减 contentOffset 得到 viewport 坐标。原点来自真实 UIView.convert，导航、选择锚点、放大镜、几何事件共享换算。
- 按钮缩放保存视口中心的内容坐标，同时恢复 x/y；超出可滚范围时夹取。pinch 由 UIKit 保持双指焦点，结束时只夹取合法边界，不重新套用手势开始前的中心。
- 当前页取视口顶部仍可见的第一个 slot，间距归下一页，尾部归末页。50% 下若中心已落到下一页，首页导航仍报告首页。
- 布局/程序缩放期间屏蔽中间几何回调，只发布最终位置，防止临时回到 100% 时更新宿主页码。

## Linux 已执行的生产代码测试

```sh
podman run --rm --network=none -v "$PWD:/work:ro" -w /work \
  docker.io/library/swift:5.9-jammy bash scripts/test-native-pdf-geometry.sh
yarn vitest run test/native-pdf/geometry.test.ts test/native-pdf/contracts.test.ts test/native-pdf/fixtures.test.ts
yarn typecheck && yarn typecheck:host
git diff --check
```

Swift 5.9.2 编译生产 `ReaderPdfGeometry.swift`，12 组 XCTest 覆盖 S02/S08 三档双向翻页、现场 -406 偏移、最小尾部、单页/空文档/零视口、小数页边界、全部 9 对缩放的二维中心、边界夹取、仅高度变化、裁切旋转/overlay、非零内容原点、连续 50 轮缩放。

测试中的 scaled contentSize 是 UIKit 的预期输入。它们证明生产几何计算，不证明 UIKit 会按预期维护视图。`swiftc -frontend -parse` 另查整个 ReaderPdfModule.swift 语法；这不等于 iOS SDK 类型检查或 Xcode 构建。

## 需要 Mac 验证的假设与最小集

需要真实 UIKit 确认以下假设：

1. 设置 zoomScale 后，contentSize 已同步更新；缩放 view 的 frame 原点保持 (0,0)，bounds.size 保持原始文档尺寸。文档裁切重建时临时回到 1 倍会得到 identity transform。
2. 更新 bottom inset 不改变 zoom view 的 frame/bounds，也不破坏 UIKit 的 pinch 焦点保持；pinch 结束没有二次跳动。
3. `contentInsetAdjustmentBehavior=.never` 与当前宿主布局匹配，不出现额外安全区偏移；高度变化会刷新 inset。
4. 集中换算与 UIView.convert 一致，裁切/旋转后的正文、overlay、选择锚点保持重合。

在交付 SHA 构建通过后，S02 和 S08 各走 100% → 200% → 50% → 100%。每档各点一次下一页、上一页，末页向下滑到底。S08 保持原隐藏/裁切注入。必须同时验证正文顶部和页码，50% 首页允许同时看到下一页，但页码仍应为 1/2 或 1/200。

按已有 Mac 视口 402 × 679.33331298828125，预期如下（点数四舍五入）：

| 样本 | zoom | contentSize | contentInset.bottom | 下一页 offset.y | 最大 offset.y |
| --- | --- | --- | --- | --- | --- |
| S02，bounds 400×1012 | 0.5 | 200×506 | 429.3333 | 256 | 256 |
| S02 | 1 | 400×1012 | 179.3333 | 512 | 512 |
| S02 | 2 | 800×2024 | 0 | 1024 | 1344.6667 |
| S08，bounds 360×812 | 0.5 | 180×406 | 479.3333 | 206 | 206 |
| S08 | 1 | 360×812 | 279.3333 | 412 | 412 |
| S08 | 2 | 720×1624 | 0 | 824 | 944.6667 |

所有行 content.frame.origin 应为 (0,0)，下一页槽位顶部相对视口 y=0。content.bounds.size 不随 zoom 变化。200% 滑到底时末页底部与视口底部重合，无额外页外尾白；50/100% 仅有表中必要填充。

补三个短检查：

- 在可滚动的内部位置标记视口中心，按钮缩放前后比较内容坐标 x/y；偏离只允许来自边界夹取。随后在非中心位置 pinch，松手不跳回旧中心。
- 200% 下修改一次 S08 裁切，再恢复；改变一次视口高度。确认重新布局后原点、页顶和 inset 仍正确，缩放倍率保持。
- 单页短文档在 50/100/200% 点首末页，不能滚入额外空白。必要填充属于视口，不计入文档尺寸。

失败时保留第一次现场：offset、contentSize、contentInset、bounds、zoomScale、content.frame、content.bounds、transform，以及 slot 的 UIView.convert 结果和截图。不要通过第二次点击修正后再报通过。
