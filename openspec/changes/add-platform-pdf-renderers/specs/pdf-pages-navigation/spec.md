# Spec Delta

## Purpose

Provide a consistent page browsing contract for local PDF documents, including original page numbers, asynchronous thumbnails, current-page feedback and direct navigation on every supported platform.

## ADDED Requirements

### Requirement: PDF page metadata and navigation
The reader SHALL expose total page count and current page as one-based original PDF page numbers. Navigation SHALL support first/last and intermediate pages without wrapping. Out-of-range requests SHALL retain the current page with recoverable feedback and SHALL NOT crash or reopen the source. Scrolling or native page changes SHALL update the same current-page state.

#### Scenario: Jump and scroll
- **WHEN** the user jumps to page 3 in a PDF of at least 4 pages and then scrolls into page 4
- **THEN** the current-page indicator and selected Pages item change to 3 and then 4 respectively

#### Scenario: Boundary navigation
- **WHEN** the reader is on the final page and a next or invalid-page request occurs
- **THEN** navigation does not wrap and the displayed page remains unchanged

### Requirement: Left Pages rail
The PDF reader SHALL display a left-side Pages rail containing every page number and its asynchronously loaded thumbnail, with a stable placeholder while loading. Activating an item SHALL navigate the main PDF view and identify the current item accessibly. On narrow viewports the same left rail SHALL be collapsible and reachable via an accessible Pages control without obscuring the entire reading workflow. Thumbnail failure SHALL retain page-number navigation and SHALL NOT fail the main document.

#### Scenario: Pages item is activated
- **WHEN** the user activates a thumbnail or its page-number item
- **THEN** the main document navigates to that page and exposes the matching current-page state

#### Scenario: Thumbnail fails or is pending
- **WHEN** a thumbnail is pending or cannot be generated
- **THEN** the item keeps stable dimensions and a usable page number and jump action

#### Scenario: Narrow display
- **WHEN** the reader is displayed in a narrow mobile viewport
- **THEN** the user can open the left Pages rail, select a page and return to an unobstructed document

### Requirement: Thumbnail resource isolation
Thumbnail requests and caches SHALL be bounded to visible/nearby Pages items and the current document session. A replaced source SHALL NOT contribute thumbnails or page numbers to the new rail.

#### Scenario: Replacement during thumbnail loading
- **WHEN** PDF B replaces PDF A while A has pending thumbnail work
- **THEN** B's rail contains only B's pages and old thumbnail results are discarded and released
