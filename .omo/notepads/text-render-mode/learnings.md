# Learnings

## 2026-07-05 Session start
- Worktree is currently on branch `feature/highlight-popover-auto-highlight`; plan was generated for `feature-pdf-reader` worktree path.
- `git status --short` returned no output, so the worktree is currently clean. Pre-existing dirty files from planning may already be committed/staged; still treat the three named files (`IntermediateDocumentViewer.tsx`, `useLazyPageQueue.ts`, `reader.scss`) as protected and avoid overwriting unrelated changes.
- Plan tasks are grouped in waves: Wave 1 = T1 + T2 (parallel); Wave 2 = T3/T4/T5; Wave 3 = T6/T7/T8.

## 2026-07-05 Task 1 harness
- TanStack Virtual can be made deterministic in jsdom by pairing a ResizeObserver mock with per-element `getBoundingClientRect` fixtures and explicit scroll-container dimensions.

## 2026-07-05 T2 — text render-mode API
- `ReaderRenderMode = 'layout' | 'text'` added to `Reader.tsx` and exported from
  `src/index.ts`. Branch is in `renderDocumentContent()`: `renderMode === 'text'`
  → `IntermediateDocumentTextViewer` (text-mode prop subset only); default →
  existing `IntermediateDocumentViewer` with ALL props forwarded unchanged.
- New `IntermediateDocumentTextViewer` is a typed shell (`data-testid=
  "intermediate-document-text-viewer"`, no VirtualPaper). Real impl deferred to
  T3–T7. Accepts the full text-mode prop surface so T3+ can fill in behavior.
- `IntermediateDocumentViewerProps` deliberately does NOT get a `renderMode`
  prop — text mode is a separate component boundary, not an internal switch.
- Commit `bb8cd89` had previously removed an older `renderMode` and left a RED
  contract test (`test/types.test.ts`) guarding its absence. T2 re-introduces
  renderMode with a new design; that contract test was flipped to GREEN.
- `makeLazyDocument()` from `test/reader.test.tsx` produces a runtime
  `IntermediateDocument` — works for both layout and text mode smoke tests.
- Verification: `yarn typecheck` PASS, full `yarn test:run` 313/313 PASS.

## 2026-07-05 T3 — virtualized text viewer shell
- Exported `getRuntimeDocument` and `getVisiblePageNumbers` from
  `IntermediateDocumentViewer.tsx` (added `export` keyword only — zero behavior
  change) so `IntermediateDocumentTextViewer` can reuse the exact same
  document-resolution and page-range-filtering logic as layout mode.
- `useVirtualizer` config: `count: pageNumbers.length`,
  `getScrollElement: () => scrollContainerRef.current`, `estimateSize: () => 800`,
  `getItemKey: (index) => pageNumbers[index]`, `overscan: 0`. Page divs use
  `ref={virtualizer.measureElement}`, `data-index`, `transform: translateY(start)`,
  `position: absolute` inside a relative spacer with `height: getTotalSize()`.
- **Critical jsdom finding**: TanStack's `measureElement` ref registers each
  rendered page with the mock ResizeObserver, which fires synchronously on
  `observe()` (see `test/setup.ts` MockResizeObserver). In jsdom,
  `getBoundingClientRect().height` is 0 for all elements → every page collapses
  to `start=0` → the virtual range expands to all pages → all pages render.
  Solution: a `measureElement` OPTION (not the ref) that falls back to 800 when
  the measured height is 0. Inert in production (real elements have height > 0).
- The existing `TextModeVirtualizerHarness` test avoids the cascade by using a
  custom `setRowRef` that calls `mockElementSize` BEFORE `virtualizer.measureElement`.
  T3's production component must use `ref={virtualizer.measureElement}` directly
  (per task spec), so the cascade can only be prevented via the `measureElement`
  option fallback.
- Verification: `yarn typecheck` PASS, targeted test PASS, full
  `intermediate-document-viewer.test.tsx` 148/148 PASS,
  `reader.test.tsx` 48/48 PASS.

## 2026-07-05 T4 — text-mode virtual visibility lazy loading
- `useLazyPageQueue` now has `mode?: 'layout' | 'text'` defaulting to layout. Text mode reuses the same queued/in-flight/generation stale-document semantics but skips `getBaseImageFromPage`, filters only `IntermediateText`, and always returns `images: []`.
- `IntermediateDocumentTextViewer` keeps `textsByPageNumber` state keyed by page number and drives queue loads exclusively from `virtualizer.getVirtualItems()` → `pageNumbers[item.index]`; no IntersectionObserver is introduced for text mode.
- Initial text enqueue is the first virtual visible set only. Subsequent virtual-range changes enqueue newly visible pages and schedule delayed unload for loaded pages leaving the virtual range.
- Default text-mode loaded cap is `max(5, visibleCount + 2)` unless `maxLoadedPages` is explicitly provided.
- Regression test `text mode lazy loads only visible pages` guards that page 20 is never requested and thumbnail/base-image loading is not invoked in text mode.
- Verification: `yarn typecheck` PASS, targeted text lazy test PASS, full `intermediate-document-viewer.test.tsx` 149/149 PASS.

## 2026-07-05 T5 — text-mode document-flow content renderer
- `IntermediateDocumentTextPageContent` is a pure functional component that maps
  `IntermediateText[]` to document-flow `<span>` nodes with `isEOL` `<br />`
  breaks. No absolute positioning, no images, no OCR, no `dangerouslySetInnerHTML`.
- Reuses the existing `IntermediateDocumentSetTextRef` type from
  `IntermediateDocumentPageContent.tsx` (signature:
  `(text, pageNumber) => (element) => void`). The task spec mentioned an
  alternative `(pageNumber, textId, element)` shape, but the actual codebase
  type is the curried form — used the real type for type-safety and
  cross-mode consistency.
- `isRenderableText` mirrors layout mode's filter (`content.length > 0`) with
  an added `typeof === 'string'` guard for defensive null/undefined handling.
- `<br />` placement: must use `<Fragment key={key}>` wrapping
  `<span> + conditional <br />` to interleave them in DOM order. A two-pass
  approach (spans first, then `<br />`s batched at the end) produces wrong
  DOM order — the breaks would all appear after all spans.
- Text viewer page div now carries class `hamster-reader__intermediate-text-page`
  and inline `padding: '5px'` (SCSS finalization deferred to T7).
- `setTextRef` is optional in the content component; text viewer does not wire
  it yet (no selection tracking infrastructure in text mode — deferred to a
  future task). Spans still carry `data-text-id` / `data-page-number` for
  future selection support.
- Exported `IntermediateDocumentTextPageContent` + props type from
  `index.ts` for external consumers.
- Verification: `yarn typecheck` PASS, targeted T5 test PASS, full
  `intermediate-document-viewer.test.tsx` 150/150 PASS (was 149, +1 new).

## 2026-07-05 T6 — text mode mounted selection callbacks
- 复用 layout 模式的 selection infrastructure 原样：
  - `textElementsRef`: `Map<string, { text, pageNumber }>` keyed by `text.id` — 与 layout 模式完全同型。
  - `setTextRef`: 柯里化 `(text, pageNumber) => (element) => void`，同 layout；非 null 时注册
    `textElementsRef.current.set(text.id, { text, pageNumber })` 并同步
    `textElementRecords.set(element, { text, pageNumber })`；null 时删除。
  - `getSelectionDetail`: 镜像 layout 但省略 `shouldRejectOverBroadSelection`
    （文本模式无页面背景图，不存在拖选超出范围的整页误判）。
  - `emitSelectionEnd`: 鼠标/触摸选择结束时调用 `onTextSelectionEnd` 与 `onSelectText`。
- Legacy selection callbacks (`onTextSelectionChange`, `onTextSelectionEnd`,
  `onSelectText`) 在 layout 模式中通过 native 事件（`document.selectionchange` +
  viewer root 的 `mouseup`/`touchend`）触发，而非 `HamsterSelection` 组件 props。
  这是 "equivalent selection surface" — 完整镜像了 native-listener 路径。
- `onSelectText` payload 通过 `buildSelectionPayload(selection)` 构建，该函数依赖
  `getClosestTextElement` 再用 `.hamster-reader__intermediate-document-viewer` class
  定位 viewer root。为此文本模式 scroll container 添加了该 class，同时使用 inline
  `display: block` 覆盖 class 带来的 `display: flex`，保持文本流滚动布局不变。
- 为每页写入了 `data-selection-id={runtimePageSelectionId(scopeId, pageNumber)}`，
  通过 `useId()` 生成 scope，避免多实例冲突。
- React ref callback 在 Component 卸载（React 在 offscreen 页面卸载时调用 ref(null)）时自动
  删除 `textElementsRef` 条目 — 无需手动 offscreen tracked。
- 验证：`typecheck` PASS，full `intermediate-document-viewer.test.tsx` 151/151
  (was 150, +1 new)，`reader.test.tsx` 48/48，targeted selection tests 47 PASS，
  forbidden pattern grep no matches（changed files: IntermediateDocumentTextViewer.tsx，
  IntermediateDocumentTextPageContent.tsx，test/intermediate-document-viewer.test.tsx）。

## 2026-07-05 T7 — scoped text-mode SCSS styles
- 在 `reader.scss` 的 `.hamster-reader { ... }` 块内添加了 5 个 scoped class：
  `&__intermediate-text-viewer` / `&__intermediate-text-scroll`（根/滚动容器，
  `display:block; overflow:auto`）、`&__intermediate-text-spacer`（`position:relative`）、
  `&__intermediate-text-page`（`position:absolute; top:0; left:0; width:100%; padding:5px`）、
  `&__intermediate-text--flow`（`position:static; display:inline; white-space:normal`）。
- `&__intermediate-text-viewer` / `-text-scroll` 定义在 `&__intermediate-document-viewer`
  之后（CSS 源码顺序），覆盖其 `display:flex` / `overflow:hidden`，无需 inline style。
- `&__intermediate-text--flow` 必须定义在 `&__intermediate-text` 之后——同特异度
  class，后定义者覆盖。首次将 `--flow` 放在 `--text` 之前导致 `position:absolute`
  赢出，测试失败后修正。
- `IntermediateDocumentTextViewer.tsx` 移除了所有静态 inline style（overflow/display/
  position/top/left/width/padding），仅保留 TanStack Virtual 动态值：spacer `height`、
  page `transform`。根节点新增 `hamster-reader__intermediate-text-viewer` class，
  保留 `hamster-reader__intermediate-document-viewer`（供 selection root lookup）。
- vitest 3 默认不处理 CSS（`?inline` 导入返回空字符串）。改用 `sass.compile()` 在
  模块级编译 `reader.scss` 为 CSS 字符串，在 `beforeEach` 中注入 `<style>` 标签使
  jsdom 的 `getComputedStyle` 能读取规则。`sass` 包已作为项目依赖安装。
- 验证：`typecheck` PASS，`-t "text mode"` 10/10 PASS，`reader.test.tsx` 48/48 PASS，
  full suite 322/322 PASS（was 317, +5 new），forbidden pattern grep no matches。

## 2026-07-05 T8 — public docs and exports
- `src/index.ts` already exports `ReaderRenderMode` from `./components/Reader`, so no additional public export edit is required for T8.
- README now documents `Reader renderMode='text'`, the default `renderMode='layout'`, visible-only virtual pages, text-only rendering, no images/OCR, and no cross-mode highlight geometry conversion.
- `.omo/evidence/task-8-text-render-mode.md` did not exist at T8 start and will be created with final gate outputs and scope checks.
