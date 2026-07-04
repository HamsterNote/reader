# Issues / Problems

## 2026-07-05 Session start
- None yet.

## 2026-07-05 Task 1 preflight
- Preflight `git status --short` reported unrelated untracked `src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer.tsx`; preserved untouched.
- `yarn add @tanstack/react-virtual` emitted existing peer/workspace warnings, but completed successfully and saved the lockfile.
- Targeted virtualizer harness test passed, but React emitted an `act` warning on stderr during the run.

## 2026-07-05 T2 — stale RED contract test in test/types.test.ts blocked typecheck
- `test/types.test.ts` (lines 45–74, added by commit `bb8cd89` "refactor(reader):
  remove render modes") contained a RED contract test asserting
  `'renderMode' extends keyof ReaderProps` resolves to `false` — i.e. it locked in
  the *removal* of `renderMode`.
- T2's core requirement is to RE-ADD `renderMode?: ReaderRenderMode` to
  `ReaderProps`, so the contract test directly contradicted the task and made
  `yarn typecheck` fail (mandatory gate).
- Resolution: flipped the contract test to GREEN — now asserts `renderMode` IS a
  valid `ReaderProps` key typed as `ReaderRenderMode`. Minimal change, no
  production behavior affected. `test/types.test.ts` is technically outside the
  T2 listed scope but is the only way to satisfy the typecheck verification gate.
  Documented in `.omo/evidence/task-2-text-render-mode.md`.
- Open question for reviewer: confirm the `test/types.test.ts` edit is acceptable
  given it is outside the nominal file list; the alternative (failing typecheck)
  violates the task's own verification requirements.

## 2026-07-05 T3 — jsdom 0-height cascade required measureElement fallback
- In jsdom, `HTMLElement.getBoundingClientRect().height` returns 0 for all
  elements. TanStack Virtual v3's `measureElement` ref callback registers each
  rendered page with the test ResizeObserver mock (`test/setup.ts`), which fires
  synchronously on `observe()`. This causes a cascade: page 1 measures as 0 →
  total size collapses → more pages enter the virtual range → they also measure
  as 0 → eventually all pages render at `translateY(0px)`, completely defeating
  virtualization.
- First test run showed only pages 10–20 in the DOM with spacer height 0px —
  page 1 never appeared because all indices collapsed to start=0.
- Resolution: added a `measureElement` OPTION to `useVirtualizer` that returns
  `getBoundingClientRect().height` when > 0, falling back to
  `TEXT_PAGE_ESTIMATED_HEIGHT` (800) otherwise. This is production-safe (a
  real page element has non-zero height) and prevents the cascade in jsdom.
- React emits an `act` warning on stderr ("A component suspended inside an act
  scope") during the test run. This is the same pre-existing warning seen in
  the `TextModeVirtualizerHarness` test and does not affect test correctness.
- Pre-existing LSP diagnostic in `useLazyPageQueue.ts:375` ("more dependencies
  than necessary: runtimeDocument") — protected dirty-worktree file, not
  touched by T3.

## 2026-07-05 T4 — inherited file size and test warnings
- T4 touches existing oversized files (`IntermediateDocumentTextViewer.tsx`,
  `useLazyPageQueue.ts`, and especially `test/intermediate-document-viewer.test.tsx`).
  Splitting them is outside the T4 file list and would risk broad unrelated churn.
- Targeted and full text viewer test runs still emit React act warnings around
  TanStack Virtual updates. These match the pre-existing T3 warning pattern and
  did not cause assertion failures.

## 2026-07-05 T5 — setTextRef type discrepancy and text-page padding
- Task spec described `setTextRef` callback shape as
  `(pageNumber, textId, element) => { ... }`, but the actual codebase type
  `IntermediateDocumentSetTextRef` is curried:
  `(text, pageNumber) => (element) => void`. Used the real type to ensure
  type-safety and cross-mode consistency. The content component's `setTextRef`
  prop is optional — text viewer doesn't wire selection tracking yet (no
  `textElementsRef` infrastructure in text mode; deferred to a future task).
- `padding: 5px` applied as inline style on the page div; SCSS finalization
  is scoped to T7 per the task spec.
- React `act` warnings appear in the new T5 test (same pattern as T3/T4 text
  mode tests). Assertions pass; warnings recorded as pre-existing.

## 2026-07-05 T6 — viewer root class + lint hook
- 在 `IntermediateDocumentTextViewer` scroll container 上添加了
  `hamster-reader__intermediate-document-viewer` class（复用 layout 模式的 CSS
  选择器，使 `getClosestTextElement.closest()` 能找到 viewer root）。inline
  `display: block` 覆盖了 `display:flex` 解决冲突，未改动 `reader.scss`。
- 添加了整改注释（中文段内说明）以保持与仓库 AGENTS.md 的 "尽量多打注释" 一致意图；
  `__intermediate-document-viewer` class 的跨模块 CSS dependency 需要注释说明。
- React `act` warnings 在新 test 中出现，与 T3–T5 text mode tests 相同的
  TanStack Virtual 异步更新模式一致；断言全部通过，记录为 pre-existing 类型。

## 2026-07-05 T7 — CSS source-order override and vitest CSS processing
- `&__intermediate-text--flow` 修饰符首次放置在 `&__intermediate-text` 之前（SCSS
  源码顺序），导致编译后 CSS 中 `--text` 的 `position:absolute` 在 `--flow` 的
  `position:static` 之后，同特异度下后者未覆盖前者。测试失败后修正：将 `--flow`
  移到 `--text` 之后。
- vitest 3 默认不处理 CSS（`test.css` 未配置时为 `false`），`?inline` 导入 SCSS
  返回空字符串。尝试创建 `src/vite-env.d.ts` 引入 `vite/client` 类型（支持 `?inline`
  模块声明），但运行时仍返回空。最终改用 `sass.compile()` 直接编译 SCSS，在测试中
  注入 `<style>` 标签。`src/vite-env.d.ts` 已删除（不再需要）。
- `useLazyPageQueue.ts:375` 的 pre-existing LSP diagnostic（"more dependencies
  than necessary: runtimeDocument"）继续存在，未触碰。

## 2026-07-05 T8 — public docs and final gates
- T8 evidence file was absent before this task; create it rather than overwriting prior evidence.
- `src/index.ts` already has the required `ReaderRenderMode` export, so changing it again would be churn.
