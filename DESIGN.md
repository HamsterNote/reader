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
- **Width:** `min(200px, 25vw)` so the document remains partially visible on narrow screens.
- **Surface:** `rgba(249, 250, 251, 0.98)`, right border `#e5e7eb`, and a restrained right-facing shadow.
- **Motion:** enter and exit with horizontal `transform` and `opacity` only; reduced-motion users receive an immediate state change.
- **Scrolling:** the thumbnail list owns vertical scrolling and contains overscroll within the panel.
- **Accessibility:** the closed panel is hidden from assistive technology and keyboard focus; open page buttons have visible `#2563eb` focus outlines.
- **Loading:** thumbnail visibility must route through the layout viewer's existing lazy page queue and cache rather than introducing a second loader.

*(End of minimal design contract)*
