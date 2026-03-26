# F4 Scope Fidelity Check

## Scope verdict
- 审计结果：当前仓库交付仍严格落在“脚手架 + 占位 API + Demo + CI/发布 + 文档/打包护栏”范围内。
- 未发现真实 Reader 业务逻辑、Storybook、SSR、额外发布渠道或无关基础设施。

## Evidence

### 1. 占位 API 仍然最小化
- `src/index.ts` 仅导出 `Reader` 与 `ReaderProps`。
- `src/components/Reader.tsx` 只读取 `document?.title ?? emptyText` 并渲染到 `data-testid="reader-root"`；没有翻页、缩放、解析、网络请求、懒加载或 hooks 业务。
- `src/styles/index.scss` 仅转发 `src/styles/reader.scss`；`src/styles/reader.scss` 只有 `.hamster-reader { display: block; }` 占位样式。
- 对 `src/**/*.ts(x)` 的关键词检查未命中 `fetch(`、`axios`、`useEffect`、`IntersectionObserver`、`zoom`、`parser`、`api` 等真实 Reader/基础设施实现迹象。

### 2. Demo 保持最小且按包入口消费
- `demo/App.tsx` 只构造一个 `IntermediateDocumentSerialized` 示例并渲染标题，页面标题为 `Hamster Reader Demo`。
- `demo/main.tsx` 通过 `@hamster-note/reader/style.css` 和 `./App` 组装 Demo，没有深度导入 `src/components/Reader`。
- `vite.config.ts` 中的 alias 仅用于本地 dev/test 把 `@hamster-note/reader` 与 `@hamster-note/reader/style.css` 映射到源码入口，符合“Demo 通过包名消费”的限定。

### 3. 目录结构没有越界基础设施
- 根目录主要是 `src/`、`demo/`、`test/`、`scripts/`、`.github/workflows/` 以及构建产物 `dist/`、`demo-dist/`，与脚手架型库包一致。
- `.github/workflows/` 下只有 `ci-pr.yml`、`publish.yml` 两个工作流，没有 Storybook、GitHub Pages、SSR、额外部署或多渠道发布配置。
- 针对 `.storybook/**`、`**/*.stories.*`、`**/next.config.*`、`**/storybook/**`、`**/server/**` 的目录/文件检查均为空。
- 对仓库关键词检查未命中 `storybook`、`SSR`、`mdx`、`monorepo`、`turbo`、`lerna`、`changeset`、`semantic-release` 等越界基础设施痕迹。

### 4. README 只承诺已实现能力
- `README.md` 只声明安装、显式样式导入、最小使用示例、peer 依赖、开发脚本与 `version/*` 发版规则。
- README 示例与实现一致：示例仅展示 `Reader` + `style.css` + 带 `title` 的文档数据，没有承诺翻页、分页渲染、解析器、远程加载等未实现功能。
- 文档没有把 Demo 描述成正式站点，也没有写未来功能承诺。

### 5. CI / publish 范围匹配 package-only 目标
- `.github/workflows/ci-pr.yml` 只执行 `yarn install --frozen-lockfile`、`yarn lint`、`yarn test:run`、`yarn build:all`、`npm pack --dry-run`，范围聚焦库包与 Demo 校验。
- `.github/workflows/publish.yml` 仅在 `version/[0-9]+.[0-9]+.[0-9]+` 与 `version/[0-9]+.[0-9]+.[0-9]+-**` 分支触发，并只发布 npm，dist-tag 仅有 `latest` / `dev` / `beta`。
- `scripts/check-pack.mjs` 仅做发布物护栏，明确排除 `demo/`、`demo-dist/`、`src/`、`test/`、`.github/`，与“包发布边界校验”目标一致，没有扩展成额外发布系统。

## Final assessment
- 按计划中的 Must NOT Have、Success Criteria 与 Final Wave F4 要求审计，未发现超范围实现。
- 当前仓库内容与“占位 Reader 包脚手架”定位一致，应通过本轮 Scope Fidelity Check。

VERDICT: APPROVE
