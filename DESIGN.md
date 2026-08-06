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
- **Surface:** opaque `#f9fafb`, right border `#e5e7eb`, and a restrained right-facing shadow.
- **Motion:** enter and exit with horizontal `transform` and `opacity` only; reduced-motion users receive an immediate state change.
- **Scrolling:** the thumbnail list owns vertical scrolling and contains overscroll within the panel.
- **Accessibility:** the closed panel is `inert` and hidden from assistive technology; the open panel has a visible close button, closes on Escape, restores focus to the opener, and uses visible `#2563eb` focus outlines.
- **Loading:** thumbnail visibility must route through the layout viewer's existing lazy page queue and cache rather than introducing a second loader.
- **Tabs:** Layout mode groups `页面`, `高亮`, and `书签` as peer tabs. Text mode renders only `高亮` and `书签`; it does not render an unavailable page-preview tab or placeholder thumbnails.
- **Bookmark action:** precise bookmarks capture the concrete text crossing the mode container's top edge. The action stores the text ID, displayed text, page number, and that text's page-local character offset.
- **Bookmark list:** precise bookmarks show their concrete text and page number, support anchored navigation and removal, and show `暂无书签` when empty. Restoration resolves the text ID first and falls back to the offset within that page when the ID no longer exists.
- **Ownership:** precise bookmark data is controlled by the Reader host as full anchors. The demo persists validated anchors per file. Page-thumbnail SVG toggles and positive-integer page bookmarks remain available only through the deprecated page-only API; interactive controls must never be nested.

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

The handle magnifier is enabled by default through `showSelectionMagnifier` and
can be disabled explicitly. Reader delegates both endpoint handles and their
magnifier to `@hamster-note/selection` instead of injecting a custom renderer.

- **Ownership:** the dependency renders its built-in text and rectangle handles
  and owns the magnifier lifecycle; Reader only forwards the public option.
- **Interaction:** when enabled, dragging a built-in Selection handle displays
  the dependency's magnified view around the active endpoint and hides it when
  the handle drag ends or is cancelled.

## 10. Reflowable Document Font Control

The bottom toolbar exposes font scaling in Text mode for supported reflowable
documents. In Layout mode, only EPUB keeps the font scaling control; PDF,
DOCX, image, TXT, and Markdown Layout views hide it.

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

## 13. Reading Progress Rail

- **Scope and layer:** Layout and Text modes each own an independent progress
  rail at the right edge of their mode container. The rail is a direct child of
  the mode shell, outside VirtualPaper, so zooming document content never scales
  or repositions its screen-space geometry.
- **Anatomy:** a persistent neutral-gray track spans the full container height,
  is `4px` wide, and keeps `1px` horizontal margins. A square, theme-colored
  border-only position frame marks the current page; its center stays transparent
  so it never masks the track or highlight ticks. Existing transient page-number
  feedback remains visible while the document is scrolling or transforming,
  while the rail itself never disappears.
- **Native scrolling:** Text mode and VirtualPaper keep their native scrolling
  behavior, including wheel, trackpad, touch, and programmatic scrolling, but
  their browser-provided scrollbar chrome is visually hidden so it cannot cover
  the custom rail. The first native `scroll` event shows the current page label
  immediately; every subsequent event restarts the idle window, and the label
  hides only after `500ms` without scrolling.
- **Mode synchronization:** each rail uses that mode's filtered page list. The
  concrete text crossing the container top supplies the current page and the
  persisted `{ pageNumber, textId, text, offset }` anchor in both modes. Text
  mode seeks through TanStack Virtual, while Layout mode preserves its
  VirtualPaper `x` and `scale` and corrects `y` to the resolved text. Both
  resolve `textId` first and fall back to the page-local offset. The rail remains
  page-valued, and non-contiguous page ranges expose actual document numbers.
- **Highlights:** each page containing a text highlight adds one `4px × 1px`
  marker at that page's proportional rail position. The marker uses the range's
  own `markerStyle.backgroundColor`, falling back to the Reader highlight color.
- **Pointer interaction:** mouse, touch, and pen use Pointer Events with pointer
  capture. Pointer down and drag update only local page feedback; navigation is
  committed exactly once on pointer up. Pointer cancel never navigates. Mouse
  hover and every active drag show the pointed page number immediately. Layout
  mode follows the same live-drag timing as Text mode. During an active touch
  drag, the page label and Layout thumbnail shift an additional `1cm` to the
  left so the reader's finger cannot cover them; mouse and pen geometry does not
  change.
- **Layout preview:** PDF Layout mode also shows the pointed page thumbnail to
  the left of the rail during hover or an active drag. It reuses the Page
  Browser's lazy visibility queue and cached base image; it never creates a
  second loader. Text mode and non-PDF Layout mode intentionally have no image
  preview. Whenever no thumbnail is rendered, the page label stays next to the
  right-side rail. When a thumbnail is rendered, the label moves to the
  thumbnail's left instead. Near the bottom edge, preview feedback is clamped
  above the bottom toolbar safe area instead of rendering behind the controls.
- **Accessibility:** the full interaction lane remains a vertical slider with
  page-valued ARIA metadata, visible theme-color focus treatment, Arrow/Page
  step keys, Home/End boundaries, and a comfortably sized pointer target.
  Reduced-motion preference removes feedback transitions without removing state.

## 14. Bottom Toolbar Reader Controls

- **History:** Undo and redo remain visible as compact icon buttons at every
  responsive width and are disabled when their corresponding history action is
  unavailable.
- **Native layout zoom:** when Layout mode runs without VirtualPaper, a compact
  percentage button follows the history controls as its own toolbar group, with
  separators on both sides. Its anchored menu offers 25%, 50%, 75%, 100%, 150%,
  200%, 300%, and fit width. Fit width is the default selection, while the
  trigger always reports the resolved percentage currently applied to pages.
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

## 15. Layout Zoom Feedback

- **VirtualPaper placement and layer:** VirtualPaper Layout mode renders zoom feedback in the viewer's
  top-left overlay layer, outside VirtualPaper's transformed subtree, so its
  screen-space size and position remain stable while the document scales.
- **Lifecycle:** a real scale change shows the current rounded percentage while
  the zoom transform is active. Pan-only transforms do not open the indicator,
  and the indicator disappears as soon as the transform-end signal arrives.
- **Percentage:** fixed top whitespace from `containMarginTop` (or the legacy
  `containMarginY` fallback) participates in the displayed effective scale but
  remains screen-fixed; the document content height alone receives the active
  VirtualPaper scale.
- **Presentation:** the compact percentage badge uses tabular numerals, remains
  non-interactive, and stays legible over both page content and the reader
  background without competing with document controls.
- **Native viewport:** when VirtualPaper is disabled, Layout mode uses a native
  overflow viewport and does not render the top-left feedback badge. Selecting
  a zoom preset or fit width keeps the page-space point under the viewport
  center at the same screen position, subject only to native scroll clamping.
  Reader-container two-finger pinch zoom is disabled in this mode; ordinary
  native scrolling remains available.

## 16. Demo VirtualPaper Beta Switch

- **Default and scope:** Reader Settings exposes “使用 VirtualPaper（beta）” as
  a native checkbox following the Demo's existing setting pattern. It defaults
  to off and controls only the Demo Reader instance; the library-level Reader
  default remains on for backward compatibility.
- **Mode behavior:** turning the switch on restores the existing VirtualPaper
  transform, gesture, persistence, and top-left zoom-feedback behavior. Turning
  it off selects the native Layout viewport and its bottom-toolbar zoom menu.

_(End of minimal design contract)_
