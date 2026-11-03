# HAM-140：SDK 57 与 UIScene 生命周期

## 修复范围

根目录和 `app/package.json` 同步采用 Expo 57.0.31、RN 0.86.3、React/React DOM
19.2.3、WebView 13.16.1，其余 Expo 模块按 SDK 自带的
`bundledNativeModules.json` 升级；安装仍在仓库根目录执行，共用根目录 `yarn.lock`。
推荐 Node 22.13+ 或 24.3+，通过 Corepack 使用仓库声明的 Yarn 1.22.22。

**仅升级版本仍不能解决本问题。** Expo 57.0.31 内置
`ExpoAppSceneDelegate` 和 `ExpoReactNativeFactoryProvider`，但它的原生模板仍在
AppDelegate 中通过 `UIWindow(frame:)` 启动 React Native，没有 SceneManifest。

`app/plugins/with-ios-scene.cjs` 在每次 iOS prebuild 时：

- 写入 `UIApplicationSceneManifest`，使用 SDK 公开的 Objective-C 类名
  `EXExpoAppSceneDelegate`，关闭多场景支持，保持单窗口宿主。
- 让 AppDelegate 实现 `ExpoReactNativeFactoryProvider`，继续创建并持有 RN factory，
  移除旧窗口创建与启动块。窗口和 RN 启动由 SceneDelegate 的连接回调负责。
- 保留 AppDelegate 的链接回调和 dev-client/Release bundle URL 选择。
  SDK 的 SceneDelegate 将窗口回写到 provider（供 `expo-system-ui` 等使用），
  并将前后台、URL、用户活动转发给 Expo AppDelegate/订阅者；冷启动 URL 会传入 RN launch options。

插件对当前模板进行明确匹配，重复执行不叠加改动；模板结构变化时中止 prebuild。
没有手写一套 SceneDelegate，也没有关闭系统生命周期检查。SDK 升级时需重新审查该插件。

移除不再支持的 `newArchEnabled`、`android.edgeToEdgeEnabled` 和已弃用的
`assetBundlePatterns`；保留 monorepo 使用的 `autolinkingModuleResolution`。
Web 资源仍由 `Asset.fromModule(require(...webreader.zip))` 静态引用并随包交付。
RN 移除的 `StyleSheet.absoluteFillObject` 改用 `absoluteFill`；测试的取消帧 mock
兼容 RN 新的可空参数类型。业务数据、桥接协议和阅读引擎保持既有格式。

## iOS 编辑菜单补丁

`patches/react-native-webview-13.16.1-ios-edit-menu.patch` 从 13.15.0 等价移植，
三个目标区域在新版源码中兼容，补丁内容不需调整。仍先调用父类构建菜单，再抑制
Lookup/Share/StandardEdit，并通过公开 `UIEditMenuInteraction` API 隐藏 WKContentView
的系统菜单，保留 DOM 选区和原生手柄。

`prepare:ios` 仅接受 13.16.1，检查完整应用/反向应用，支持重复运行；版本不符或
任一目标区域冲突时失败，不静默跳过。

## 本次验证（Linux，2026-11-03）

- `yarn test:run`：96 个文件，1335 项通过，含宿主桥接/会话/重载/持久化和菜单补丁。
  新增 UIScene 用例读取已安装 Expo 的真实原生模板，验证启动块移除、factory/链接保留、
  幂等及模板冲突失败；通过 Expo introspect 验证最终 SceneManifest。
- `yarn typecheck`、`yarn typecheck:host`、`yarn lint` 通过。
- `yarn build:all`、`yarn pack:check` 通过。
- `yarn build:webview`、`yarn verify:webview` 通过（293 个资源）。
- `npx expo install --check`：依赖匹配 SDK 57；`expo config --type public` 通过。
- iOS prebuild（`--no-install`）通过，生成的 Info.plist 含 SceneManifest，
  AppDelegate 实现 provider 且不再通过无 scene 的窗口启动 RN。
- iOS production JS/Hermes export 通过，包含 `webreader.zip`。
- Android prebuild（`--no-install`）和 production JS/Hermes export 通过，
  同样包含 `webreader.zip`；未执行 Gradle 原生编译或设备安装。
- `npx expo-doctor`：20/21；唯一失败项为 `app/` 下没有独立 lockfile。
  此仓库刻意在根目录安装和锁定依赖，不应在 `app/` 再生成第二份锁。

完整测试仍输出 React `act`、PDF.js Node/字体等警告；不影响本次通过结果。
上述检查不能替代 Swift/Objective-C 编译与 iOS 运行验收。

## macOS 验收步骤（尚未执行）

在 Xcode 27.2 / iPhone 18 Pro / iOS 27.2 或原复现环境中执行：

```bash
corepack yarn install --frozen-lockfile
corepack yarn host:check
corepack yarn prepare:ios
# --clean 会重建生成的原生目录；先保全任何手工 native 修改。
cd app
npx expo prebuild --platform ios --clean
npx expo run:ios --configuration Release --no-bundler
```

验收时检查构建后的 `.app/Info.plist` 中的 SceneManifest，而不只看 app.json；
确认冷启动不再出现 `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`，
能进入书库并打开 PDF/EPUB。再验证前后台往返、系统文件选择器返回、冷/热启动
`hamsterreader://` 链接、已有书籍/标注恢复、WebView 重载与持久化、明暗主题。

随后补做 HAM-130 5.2：PDF Text 长按、原生选区手柄、页边拖选不翻页、系统编辑菜单
全抑制与高亮 Popover、侧栏滚动、横竖屏、同原页翻两屏后关闭重开；回归 EPUB 共用外壳。
记录设备/系统版本、Release 构建日志、启动与交互证据。

Linux 无 Xcode/UIKit/模拟器，因此本次没有原生 Release 编译或启动成功证据；
HAM-130 5.2 的 iOS/Android 验收仍挂起，不能据本次静态与 JS 检查勾选通过。
