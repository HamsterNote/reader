2026-03-24: 将 Vite 配置拆分为 `vite.config.ts`（demo/dev）与 `vite.lib.config.ts`（library build），避免后续职责混杂。
2026-03-24: Reader 根节点公开稳定类名 `hamster-reader`，供显式导出的样式入口消费。
2026-03-24: `build:lib` 采用 Vite 输出 JS、`tsc` 仅产出声明、Sass 单独编译 `dist/style.css`，保持 `src/index.ts` 无样式副作用。
2026-03-24: demo/dev 在 `vite.config.ts` 用基于 `import.meta.url` 的绝对路径别名映射公开包入口，避免本地按包名导入失效。
2026-03-24: Vite 多前缀别名改用有序数组并将更具体的 `style.css` 规则放前，避免被包根别名前缀吞掉。
