# F4 Scope Fidelity Check（范围忠实度审查）

## 审查结论
- **总体结论：CONDITIONAL PASS（有 1 项范围偏移风险）**
- 主体交付仍在计划范围：脚手架 + 占位 API + Demo + CI/发布 + 文档。
- 发现一项需关注的越界迹象：`package.json` 增加了 `@hamster-note/pdf-parser` 依赖，但当前公开 API / Demo / 测试并未使用该依赖，且不在原始请求与计划最小依赖模型中。

---

## 1) 新增文件清单与目录结构审阅

### 顶层关键结构（与计划匹配）
- `src/`：库源码（`index.ts`、`components/Reader.tsx`、`styles/*`）
- `demo/`：本地演示（`App.tsx`、`main.tsx`）
- `test/`：Vitest + RTL 测试基线（`smoke.test.tsx`、`reader.test.tsx`、`setup.ts`）
- `.github/workflows/`：CI 与发布工作流（`ci-pr.yml`、`publish.yml`、`sync-master-to-dev.yml`）
- `scripts/check-pack.mjs`：npm 发布物边界校验
- `README.md`、`CHANGELOG.md`：文档

### 与计划目标的一致性
- 与 `reader-frontend-package` 计划定义一致（库包脚手架 + 占位组件 + Demo + CI/publish + docs）。

---

## 2) Must NOT Have 对照（逐项）

### 2.1 不得引入 Storybook / GitHub Pages / SSR / MDX / Monorepo / 自动版本管理器
- 检查结果：**PASS**
- 证据：
  - `.storybook/**/*`、`**/*.stories.*`、`**/*.mdx`、`**/next.config.*`、`pnpm-workspace.yaml`、`turbo.json`、`.changeset/**/*`、`**/*semantic-release*` 全部未命中。

### 2.2 不输出 CJS / UMD
- 检查结果：**PASS**
- 证据：
  - `vite.lib.config.ts` 中 `build.lib.formats = ['es']`。
  - `exports` 仅指向 `dist/index.js` 与 `dist/style.css`。
  - 未发现 `.cjs` / `umd` 产物配置。

### 2.3 JS 入口不得自动注入样式副作用
- 检查结果：**PASS**
- 证据：
  - `src/index.ts` 仅导出 `Reader`、`ReaderProps`，无 `import './styles...'`。
  - `README` 与 `demo/main.tsx` 均采用显式 `import '@hamster-note/reader/style.css'`。

### 2.4 Demo / 测试资源不得进入 npm 发布物
- 检查结果：**PASS**
- 证据：
  - `package.json` 使用 `files: ["dist"]`。
  - `scripts/check-pack.mjs` 显式禁入：`demo/`、`demo-dist/`、`src/`、`test/`、`.github/`。

### 2.5 不引入 `any` 逃逸类型
- 检查结果：**PASS**
- 证据：
  - 已审阅 `src/`、`demo/`、`test/`、`vite*.ts` 关键 TS/TSX 文件，未见 `any` 显式逃逸类型。

### 2.6 不引入真实 Reader 业务逻辑
- 检查结果：**PASS（实现层面）/ WARNING（依赖层面）**
- 证据：
  - `src/components/Reader.tsx` 为占位渲染：仅显示 `document?.title ?? emptyText`。
  - 未发现翻页、缩放、解析、请求、懒加载等真实业务实现。
  - **但** `package.json` 新增 `@hamster-note/pdf-parser` 依赖（`dependencies`），超出当前最小占位 API 的必要依赖集合，存在“提前引入未来能力依赖”的范围偏移风险。

---

## 3) README 范围承诺核查

- 检查结果：**PASS**
- 结论：README 仅承诺已落地内容（安装、显式样式导入、最小用法、peer 依赖、开发脚本、version 分支发布规则），未出现 Storybook/SSR/在线站点/未来高级能力等虚假承诺。

---

## 4) 对照“用户原始请求”的范围判定

用户原始请求核心：
- 技术栈固定：TypeScript + Vite + SCSS + React
- 包名固定：`@hamster-note/reader`
- 依赖 `@hamster-note/types`
- 面向 npm 可发布

判定：
- 主体已满足。
- **偏移点**：`@hamster-note/pdf-parser` 不属于该最小请求的显式依赖要求，且当前代码未消费，建议回收以保持 scope fidelity。

---

## 5) 建议处置

1. 若无当前功能必要性，移除 `@hamster-note/pdf-parser` 依赖，避免超前耦合。
2. 若必须保留，请在 README 或架构说明中明确“当前未启用，仅为即将到来的功能预留”，并经计划变更批准。

---

## Final Verdict

**CONDITIONAL PASS**

- 核心交付范围基本忠实。
- 存在 1 项范围偏移风险（未使用且未在最小范围声明中的额外 dependency：`@hamster-note/pdf-parser`）。
