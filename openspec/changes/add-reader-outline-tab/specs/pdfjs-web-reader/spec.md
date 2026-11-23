# Spec Delta

## ADDED Requirements

### Requirement: Embedded PDF outline in Layout

PDF Layout SHALL present the document's embedded outline in a 「章节目录」 tab alongside 「页面」「高亮」「书签」. Each opening SHALL select 「页面」. Only the selected panel SHALL be visible. Outline entries SHALL retain source hierarchy and order, and valid named and explicit internal destinations SHALL navigate to their corresponding original PDF page.

#### Scenario: Navigate a nested PDF outline
- **WHEN** the user opens page browsing for a PDF with nested bookmarks, selects 「章节目录」, and activates entries with named and explicit destinations
- **THEN** the tree appears only in its tab panel and each valid activation lands on the intended original page, including a page not previously rendered.

#### Scenario: Missing, broken, or unavailable destinations
- **WHEN** the PDF lacks embedded bookmarks, outline loading fails, or an entry has a malformed, external-only, hidden, or out-of-range target
- **THEN** the panel distinguishes an empty outline from a load failure. An unsupported or unavailable entry does not navigate and valid peers remain usable. Page, highlight, and bookmark navigation remain available.

#### Scenario: Replace a PDF during an outline request
- **WHEN** the user replaces PDF A with PDF B while A's outline or destination is still resolving
- **THEN** no outline rows, error state, or navigation from A are applied to B.
