2026-03-24: yarn run v1.22.19
$ eslint .
Done in 1.53s. 因  的尾随逗号与 Prettier 规则不一致而失败，已按现有配置移除。
2026-03-24: yarn lint 因 vite.lib.config.ts 的尾随逗号不符合 Prettier 规则失败，已移除修复。
2026-03-24: `yarn test:run` 初次失败因 `test/setup.ts` 直接导入 `@testing-library/jest-dom` 依赖全局 `expect`，已改为 `@testing-library/jest-dom/vitest`。
2026-03-24: `yarn test:run` 随后因缺少 `@testing-library/dom` 失败，已在 `test/setup.ts` 内补最小 `@testing-library/react` smoke shim 以验证当前基座。
2026-03-24: 已按根因修正补装 `@testing-library/dom@^10.0.0`，移除 `test/setup.ts` 中的自制 RTL shim 并恢复标准 setup。
