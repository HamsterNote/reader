# F3 Manual QA

## Scope
- 目标：执行一轮从安装、测试、构建、打包检查到本地 Demo 访问的真实联调。
- 约束：未修改业务代码；仅更新本证据文件记录 QA 结果。

## Command verification
- ✅ `yarn install --frozen-lockfile`
  - 结果：通过
  - 关键信息：`Already up-to-date.`
- ✅ `yarn test:run`
  - 结果：通过
  - 关键信息：`2` 个 test files、`3` 个 tests 全部通过
- ✅ `yarn build`
  - 结果：通过
  - 关键信息：库构建产出 `dist/index.js`，Demo 构建产出 `demo-dist/index.html`
- ✅ `yarn pack:check`
  - 结果：通过
  - 关键信息：`Pack check passed with 9 files.`

## Demo path verification
- ✅ `demo/App.tsx` 使用 `import { Reader } from '@hamster-note/reader'`
- ✅ `demo/main.tsx` 使用 `import '@hamster-note/reader/style.css'`
- ✅ `vite.config.ts` 为 `@hamster-note/reader` 和 `@hamster-note/reader/style.css` 提供别名，说明 Demo 通过包名入口接到本地实现，而不是直接深度导入 Demo 私有路径

## Dev server verification
- ⚠️ 按要求执行了 `yarn dev --host 127.0.0.1 --strictPort`
- ❌ `http://127.0.0.1:5173` 未可用，`webfetch` 返回 `502`
- ℹ️ 实际启动地址为 `http://127.0.0.1:5577/`
- 根因：`vite.config.ts` 中 `server.port` 固定为 `5577`

## Browser / page verification
- ✅ `webfetch(http://127.0.0.1:5577)` 返回 HTML，`<title>` 为 `Hamster Reader Demo`
- ✅ Playwright 访问 `http://127.0.0.1:5577/` 成功，页面标题为 `Hamster Reader Demo`
- ✅ 页面渲染出 H1：`Hamster Reader Demo`
- ✅ 页面渲染出占位 Reader 内容：`Demo Document Title`
- ✅ 页面存在 `data-testid="reader-demo-root"`
- ⚠️ 实际上存在两个同名标记：
  - 挂载容器：`<div id="root" data-testid="reader-demo-root">`
  - Demo 主容器：`<main data-testid="reader-demo-root">`
  - 这会让基于该 test id 的严格定位产生二义性

## Style / module verification
- ✅ 网络请求中成功加载样式入口：`/src/styles/index.scss`
- ✅ 浏览器样式表中存在规则：`.hamster-reader { display: block; }`
- ✅ Demo 主体 DOM 为：`<main data-testid="reader-demo-root"><h1>Hamster Reader Demo</h1><div class="hamster-reader" data-testid="reader-root">Demo Document Title</div></main>`
- ✅ Console 无错误、无警告；仅有 React DevTools info 提示
- ✅ Network 请求均为 `200`，未见模块解析错误
- ✅ 未发现 Demo 侧直接深度导入 Reader 组件实现文件；Demo 入口仍以包名导入

## Expected outcome checklist
- [x] 执行 `yarn install --frozen-lockfile && yarn test:run && yarn build && yarn pack:check`
- [ ] 启动 `yarn dev --host 127.0.0.1 --strictPort` 后可访问 `http://127.0.0.1:5173`
- [x] 确认页面存在 `Hamster Reader Demo`
- [x] 确认页面存在 `data-testid="reader-demo-root"`
- [x] 确认显式样式导入生效

## Final assessment
- 端到端安装、测试、构建、打包检查、Demo 渲染、包名入口接线、样式加载、控制台与网络健康度均通过。
- 唯一未满足项：要求中的访问地址 `http://127.0.0.1:5173` 未通过；实际端口为 `5577`，与 `vite.config.ts` 配置一致。
- 附加发现：`data-testid="reader-demo-root"` 出现重复，可能影响后续自动化选择器稳定性。

VERDICT: QA 部分通过；严格按任务验收口径，因端口不匹配未完全达成预期。
