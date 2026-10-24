# HAM-105 菜单与旧容器路径续修

基线 `4af4838f7611cdf8005115dbe13813b0e6126892`，开发线
`agent/ham-91-integration`，实际仓库 `HamsterNote/reader`。

Mac 上轮已确认 EPUB 正文、PDF 高亮可读、保存重开、旋转、后台、重试及在线
Release 冷启动恢复通过。本轮处理仍失败的系统菜单和覆盖安装后的旧缓存路径。
本说明不代替新的 iOS 验收证据。

## 原生菜单

固定依赖 `react-native-webview@13.15.0` 仅按选择器抑制菜单项，且在调用
`super buildMenuWithBuilder` 前删除 Look Up；Fabric 还可能跳过初始空菜单的
setter。原生复测已证明 JS 配置不足以阻止 Look Up / Translate。

`patches/react-native-webview-13.15.0-ios-edit-menu.patch` 增补两条原生路径：

- 在系统构建完菜单后，按完整抑制列表删除 Lookup、Share 和 Standard Edit 组。
- 使用 iOS 16.4+ 公开的 WKUIDelegate `willPresentEditMenuWithAnimator` 回调，
  递归关闭 WKWebView 中的 UIEditMenuInteraction，并在展示动画结束时再次兜底。

阅读宿主现在只传完整抑制列表，不再传空 `menuItems`，避免原生库额外安装自定义
长按识别器。补丁只在显式空自定义菜单或完整抑制列表时启用；保留普通 WebView、
非空自定义菜单和部分抑制列表的默认行为。未使用私有 selector、类名或全局 swizzle；不清空 DOM Selection、
不关闭文本交互、不屏蔽长按手势。系统菜单可能需要在展示生命周期中关闭，
Mac 复测应同时检查是否有闪现、选区丢失和菜单重现。

## 旧容器路径

旧书库 `cachedUri` 带有安装前的 iOS 容器 UUID，而文档已随数据容器迁移。
读取和删除现在统一由当前 `documentDirectory`、经过校验的稳定 fileId 及格式
构造 `reader-files/<fileId>.<format>`，不读取或删除记录中的旧绝对路径。
新导入记录只保存相对路径。已存在记录无需重选文件，快照、revision、范围 ID、
评论、进度及导入时间不因修复而改写。阅读桥接必须使用 staged publication URL，
不再回退到旧 cachedUri。

## 构建与复测

本次含原生源文件补丁，**必须重新构建 iOS App**，不能只重载 Metro：

```bash
yarn install --frozen-lockfile
yarn prepare:ios
yarn build:webview
yarn verify:webview
```

`prepare:ios` 输出 `applied` 或 `already applied` 才能继续。依赖版本变化或
补丁上下文不匹配时会失败退出，禁止忽略该错误。`host:ios`、`host:ios:offline`
和 `host:prebuild` 脚本已接入此步骤；直接用 Xcode/mobilebuildmcp 构建时也要
先执行该命令。原生文件在 Pods 的依赖源码目录中，安装依赖后需重跑。

按上轮相同 Bundle ID 覆盖安装 Release，保留全部文档及宿主 JSON：

1. 先备份并记录已有 EPUB/PDF 的 fileId、range ID、revision 与 cachedUri。
   安装前后确认实际容器根变化；若根未变化，不能据此宣称迁移场景已通过。
2. 安装后直接从旧书库打开两种格式，不经过 DocumentPicker 重选，确认原文与
   原标注恢复。不要手动修改 JSON 或清理 staged 缓存来掩盖失败。
3. 两种格式分别长按并拖动选择手柄，点自定义高亮按钮的中心区域，确认能完整
   操作，没有 Look Up / Translate / Copy 菜单遮挡；重复选择、旋转及后台恢复
   后再次检查，附截图或录屏。
4. 退出阅读页重开、终止再冷启动，确认旧标注和本次新增标注均保留。
5. 单独删除一个可丢弃的测试文件，确认新容器中对应缓存和记录删除，其他文档
   与标注保留。不要删除用户文档。

真正断网冷启动和新样本首次离线导入仍由 Mac 操作员在得到整机断网授权后执行，
本轮不替用户授权，也不把在线冷启动当作离线通过。Android 继续豁免。

## 本地检查

定向测试覆盖两种格式的容器迁移 staging、重新选择时的相对路径持久化与快照
保留、旧记录删除及 unsafe fileId；原生补丁测试覆盖干净安装应用、重复应用、
反向还原、版本不匹配和源码偏离时无部分写入。
Linux 无 UIKit/Xcode，无法执行本次原生编译和可见菜单验证，最终以 Mac 新 SHA
的原生结果为准。

本次结果：全量单测 86 文件 / 1143 项通过，两套类型检查、lint 通过；
WebView 清单校验 293 文件通过，资源 buildId 仍为 `132660d461844846`。
iOS 生产 JS 导出成功，含 610 modules、约 1.91 MB Hermes bundle 和完整阅读 zip。
未重复运行上轮 Web 浏览器矩阵，本轮没有修改 Web 阅读渲染代码。
