# Spec Delta

## Purpose

Define temporary text selection and a custom React selection popover for PDF reading, keeping platform text selection usable while suppressing native action menus and deferring all highlight data changes.

## ADDED Requirements

### Requirement: Temporary PDF text selection
On iOS, Android and Web, selecting non-empty PDF text SHALL make the selected text and its visible bounds available to the outer reader's temporary selection state. Drag/long-press and adjusting selection handles SHALL remain usable. Empty or image-only pages SHALL remain readable without emitting fabricated text. Selection events SHALL be bound to the active document session.

#### Scenario: Selection is adjusted
- **WHEN** a user selects text and changes its endpoints
- **THEN** the selected text and bounds update while selection handles or browser selection remain usable

#### Scenario: Image-only PDF
- **WHEN** a user attempts text selection on a page with no text layer
- **THEN** the page remains readable and no text-selection Popover or OCR text is fabricated

### Requirement: React selection Popover
Non-empty PDF selection SHALL show an outer React Popover anchored to the selected visible text with exactly one visible “高亮” button. Its position SHALL account for zoom, scrolling, page rotation, platform view offsets, safe areas and viewport bounds. Scrolling/zoom/rotation SHALL update the anchor or dismiss the Popover and selection consistently. Clearing selection, changing page through Pages, replacing source or unmounting SHALL dismiss stale Popovers.

#### Scenario: Selection near a viewport edge
- **WHEN** selected text is near the viewport edge or changes position after zoom/scroll
- **THEN** the Popover stays within the visible reader surface with a correct anchor, or is dismissed with the temporary selection

#### Scenario: Selection is cleared or source changes
- **WHEN** selection becomes empty, a Pages jump occurs, or another source replaces the PDF
- **THEN** the old Popover disappears and stale selection events cannot reopen it

### Requirement: Highlight button is a placeholder
Activating “高亮” in the PDF selection Popover SHALL create no highlight, persistent annotation, undo history or storage/network write and SHALL NOT invoke existing highlight mutation callbacks. The interaction SHALL leave text selection usable. Existing EPUB annotation behavior SHALL remain unchanged.

#### Scenario: Placeholder is pressed repeatedly
- **WHEN** the user presses the PDF “高亮” button one or more times
- **THEN** no annotation is drawn or saved, no highlight callback fires and selecting text again still works

### Requirement: Native Context Menu is suppressed without disabling selection
For PDF text selection the reader SHALL prevent the iOS system, Android WebView and browser native Context Menu from appearing, while retaining text selection and selection adjustment. Blanket touch cancellation, disabling selection, or hiding all selection handles SHALL NOT satisfy this requirement. Suppression SHALL be scoped to the PDF surface.

#### Scenario: Platform native menu trigger
- **WHEN** the user long-presses selected PDF text on iOS/Android or invokes the browser context menu on the Web PDF surface
- **THEN** native action menus do not appear, the custom Popover is available for non-empty selection and selection remains adjustable

#### Scenario: EPUB or surrounding application selection
- **WHEN** the user interacts outside the PDF surface
- **THEN** PDF-specific menu interception does not change the existing behavior of that surface
