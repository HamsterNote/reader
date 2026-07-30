# Design Tokens & Layout Contract

# (Feature: PDF Reader Demo Shell & Highlight Integration)

This document defines the minimal layout tokens and component class contracts required for the Hamster Reader two-column demo shell.

## 1. Shell Layout (Demo App)

The demo application transitions from a single-column vertical flow to a two-column shell when a document is parsed and loaded.

- **Container:** `.hamster-demo-shell` (CSS Grid or Flexbox, 100vw, 100vh, `overflow: hidden`)
- **Left Panel (Sidebar):** `.hamster-demo-sidebar`
  - Fixed width: `300px`
  - Background: `#f9fafb` (Tailwind `gray-50`)
  - Border: `1px solid #e5e7eb` on the right
  - Scrollable `overflow-y: auto`
- **Right Panel (Reader Viewport):** `.hamster-demo-main`
  - Fills remaining space (`flex: 1` or `grid-column: 2`)
  - The inner `.hamster-reader__intermediate-document-viewer` must inherit height (`100%`) without collapsing.

## 2. Left Panel UI Regions

Inside the `.hamster-demo-sidebar`, we maintain specific regions for settings and highlight management:

- **Upload / Settings Region:** `data-testid="demo-sidebar-settings"`
- **Highlight List Region:** `data-testid="demo-sidebar-highlights"`

## 3. Highlight Horizontal Button Group

The highlight list items must adopt a compact, horizontal button group for actions.

- **Group Container:** `.hamster-demo-action-group` (Flex row, gap `8px`, alignment `center`)
- **Action Buttons:** Must have accessible labels for testing (e.g. `aria-label="Remove highlight"`)
- **Focus / Hover:** Buttons should use subtle background changes on hover (`#f3f4f6`) and visible focus rings (`2px solid #3b82f6` or similar) for accessibility.

## 4. Highlight & Background Color Controls

We introduce explicit controls for customizing Reader rendering colors, located in the settings region:

- **Background Color Select:** `data-testid="background-color-select"`
- **Highlight Color Select:** `data-testid="highlight-color-select"`
- Both should present color options with proper labels (e.g., Chinese labels).

## 5. Chinese Label Spacing

For Chinese UI text, ensure proper grouping. If mixing Chinese and English (or numbers), a single space gap is preferred unless governed by specific CJK typography rules.

## 6. Empty / Error States

If no document is loaded, or if parsing fails, the UI should gracefully present empty/error states:

- **Empty State Container:** `data-testid="demo-empty-state"`
- **Error State Container:** `data-testid="demo-error-state"`

## 7. Reader Page Browser

Layout mode may expose an overlay page browser controlled by `showPageBrowser`.

- **Container:** `.hamster-reader__page-browser`, anchored to the reader's left edge without resizing the document viewport.
- **Width:** `min(240px, 78vw)` so the panel remains usable on narrow screens while leaving part of the document visible.
- **Surface:** `rgba(249, 250, 251, 0.98)`, right border `#e5e7eb`, and a restrained right-facing shadow.
- **Motion:** enter and exit with horizontal `transform` and `opacity` only; reduced-motion users receive an immediate state change.
- **Scrolling:** the thumbnail list owns vertical scrolling and contains overscroll within the panel.
- **Accessibility:** the closed panel is hidden from assistive technology and keyboard focus; open page buttons have visible `#2563eb` focus outlines.
- **Loading:** thumbnail visibility must route through the layout viewer's existing lazy page queue and cache rather than introducing a second loader.
- **Tabs:** the panel groups `页面`, `高亮`, and `书签` as peer tabs without changing the panel width or visual hierarchy.
- **Bookmark action:** every page thumbnail exposes a separate SVG bookmark toggle with an explicit add/remove label and `aria-pressed` state; interactive controls must never be nested.
- **Bookmark list:** bookmarked pages appear in page order, support page navigation and removal, and show `暂无书签` when empty.
- **Ownership:** bookmark data is controlled by the Reader host. The demo persists only valid positive integer page numbers per file and restores them when that file is reopened.

## 8. Text Selection Range Handles

Text ranges use the browser's native `Selection` painting, tinted by the
Reader's `selectionColor`, instead of a temporary painted rectangle overlay.

- **Mouse:** retain the existing circular start and end handles supplied by
  `@hamster-note/selection`; dragging either endpoint updates the native range.
- **Touch:** do not render custom text handles. Browser-native selection handles
  remain enabled for long-press selection and persisted-highlight activation.
- **Persisted highlights:** unselected ranges retain their overlay. Activating a
  persisted range temporarily hides its selected overlay and materializes the
  equivalent browser-native range; mouse activation keeps the circles while
  touch activation uses only the native handles.
- **Selected rectangle border:** selected text-range rectangles have no stroke
  or border, including both SVG and percent overlay modes.
- **Rectangle selection:** rectangle-tool handles retain the dependency's
  existing circular rendering and drag behavior.

## 9. Range Handle Magnifier

The handle magnifier is opt-in through `showSelectionMagnifier`; it is disabled
by default. When enabled, dragging a custom range handle exposes a compact view
of the page directly under the handle's visual center.

- **Portal:** `.hamster-reader__range-magnifier` is rendered as a direct child
  of `.hamster-reader__intermediate-document-viewer`, never inside
  `.virtual-paper-container`; its dimensions therefore remain screen-fixed at
  every document zoom level.
- **Geometry:** a `120px` circular lens with `3px` white border, restrained
  neutral shadow, and an `8px` blue center marker.
- **Magnification:** page content is rendered at `2x` around the corrected range
  endpoint. The handle itself is excluded from the captured page image.
- **Placement:** center above the handle with an `18px` gap. If the reader has
  less than `8px` of clearance above, place it below; clamp both axes to an
  `8px` viewport inset.
- **Interaction:** when enabled, show during mouse text-handle or rectangle-
  handle dragging, ignore pointer input, update from the active handle center,
  and hide on pointer up, pointer cancel, window blur, or capture failure.

## 10. Reflowable Document Font Control

The bottom toolbar exposes font scaling only for reflowable EPUB, TXT, and
Markdown documents. Fixed-layout PDF, DOCX, and image documents keep the
existing toolbar unchanged.

- **Trigger:** a compact secondary button labelled `字体：当前档位`, with the
  current value visible at every responsive width.
- **Menu:** an anchored menu above the trigger with `特小`, `小`, `中`, `大`,
  and `特大` in ascending order; the active item exposes `aria-pressed=true`.
- **Default:** each newly loaded supported document starts at `大` (`1.5`).
- **Scale mapping:** `特小=0.5`, `小=0.75`, `中=1`, `大=1.5`, `特大=2`.
  Every source font size is converted to rem with
  `(sourceFontSize / 16) * scale` so proportional differences are preserved.
- **Dismissal:** selection, outside pointer input, or Escape closes the menu.
- **Compatibility:** consumers that omit the Reader font scale retain legacy
  pixel sizing; the demo opts into scaling only for supported file formats.

## 11. Highlight Drag Preview

Dragging an existing layout highlight exposes a compact, demo-owned preview so
consumers can see how to implement the `onDragHighlight` integration.

- **Surface:** `.hamster-demo-highlight-drag-preview` is a fixed, white neutral
  card with a restrained blue border and elevation shadow.
- **Placement:** offset `14px` from the active pointer and clamped by a
  `calc(100vw - 32px)` maximum width; movement uses `translate3d` only.
- **Content:** show the dragged highlight text on one truncated line, falling
  back to `高亮内容` when the range text is empty.
- **Interaction:** the preview ignores pointer input, follows the initiating
  pointer outside Reader, appears as soon as the drag activates, and disappears
  on pointer up or pointer cancel. Native page selection stays available while
  the gesture is only a candidate, then is suspended for the active drag. A
  successful touch long press also suspends canvas panning until that pointer
  ends or is cancelled.

## 12. Reflowable Document Spacing

- **Text pages:** every visible page after the first receives `12px` of extra
  top spacing inside its measured virtual-page box. The first visible page has
  no leading gap, including when page ranges or hidden pages change the start.
- **Paragraphs:** Text mode and reflowable Layout pages add `0.75em` after each
  non-final `IntermediateParagraph`. Ordinary `isEOL` line breaks do not create
  paragraph spacing.
- **Fixed layout:** PDF and other geometry-preserving pages remain unchanged.

## 13. Text Reading Progress

- **Scope:** Text mode alone overlays a compact progress control at the left
  edge without replacing or duplicating the native scrolling model.
- **Anatomy:** a quiet `2px` neutral track and a `12px` circular thumb use the
  Reader theme color (`--hamster-reader-theme-color`, default `#2563eb`).
- **Synchronization:** TanStack Virtual owns the scroll offset, total measured
  size, current virtual page, and imperative seeking. Native scrolling moves
  the thumb; track clicks, thumb drags, and keyboard input seek the Viewer.
- **Transient visibility:** the track, thumb, and page label appear as one group
  while scrolling, dragging, or keyboard focus is active. At rest they are
  visually hidden, while the full interaction lane remains mounted, clickable,
  and keyboard-focusable. The label shows the actual visible document page
  number, including filtered or non-contiguous page ranges.
- **Accessibility:** the full `32px` interaction lane is a vertical slider with
  page-valued ARIA metadata, visible theme-color focus treatment, Arrow/Page
  step keys, and Home/End boundaries. Reduced-motion preference removes the
  shared group transition without removing state feedback.

## 14. Bottom Toolbar Reader Controls

- **History:** Undo and redo remain visible as compact icon buttons at every
  responsive width and are disabled when their corresponding history action is
  unavailable.
- **Render mode:** one toggle switches between Layout and Text. Its accessible
  label always names the destination mode, and its pressed state represents
  Text mode.
- **Layout-only controls:** touch-panning and edge-crop editing remain visible
  but disabled in Text mode. Entering Text mode also exits edge-crop editing so
  a hidden edit session cannot survive the mode transition.
- **OCR:** the OCR toggle is off by default and is available only in Layout
  mode. Turning it on immediately recognizes every currently loaded page and
  automatically recognizes each page loaded afterward while it remains on.
  Text mode disables the toggle without discarding its state.
- **State feedback:** two-finger panning and active edge-crop editing use the
  existing primary button treatment and expose `aria-pressed=true`; OCR follows
  the same primary/ghost and pressed-state convention. Inactive controls use
  the existing ghost treatment.
- **Responsive behavior:** these reader-level controls stay directly available
  as icon buttons on narrow screens. Only the three selection tools collapse
  into the existing anchored menu below `768px`. The toolbar is constrained to
  the viewport and may scroll internally instead of extending the page width.

_(End of minimal design contract)_
