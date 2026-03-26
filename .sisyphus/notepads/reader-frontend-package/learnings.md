2026-03-24: TS 配置沿用 `@system-ui-js/development-base/tsconfig.json`，并将声明产物单独放到 `tsconfig.build.json`。
2026-03-24: `src/index.ts` 先使用 `export {}` 作为库入口占位，避免提前暴露 Reader 或样式副作用。
2026-03-24: `vite.config.ts` 直接切到 `vitest/config` 的 `defineConfig`，可在保留 Vite demo 构建配置时同文件声明 `test`。
2026-03-24: `ReaderProps` 首版只保留 `document`、`className`、`emptyText` 三个公开字段，组件内部仅做标题/空态占位渲染。
2026-03-24: `IntermediateDocumentSerialized` 在测试里可用最小 fixture `{ id, title, pages: [] }`，无需伪造页面内容。
2026-03-24: JSX 选项应放在根 `tsconfig.json`，这样 `typecheck`、Vitest 与 `tsconfig.build.json` 都能共享 `react-jsx` 配置。
2026-03-24: Demo 可在 `demo/App.tsx` 内联最小 `IntermediateDocumentSerialized` fixture，并通过包名入口配合显式 `style.css` 保持演示稳定。
2026-03-24: README 首版保持最小公开文档范围，需覆盖安装、使用示例、显式 `@hamster-note/reader/style.css` 导入、React peer 依赖、当前 package scripts 与 `version/*` 发版分支规则。
2026-03-24: 发布校验使用 `scripts/check-pack.mjs` 解析 `npm pack --json --dry-run`，仅允许 `dist/**` 与标准元数据文件进入 tarball，并显式拦截 `demo/`、`demo-dist/`、`src/`、`test/`、`.github/`。
2026-03-26: F4 范围审查时，除功能代码外还需核对依赖边界；未被公开 API / Demo / 测试消费的新增依赖应视为潜在 scope drift。
