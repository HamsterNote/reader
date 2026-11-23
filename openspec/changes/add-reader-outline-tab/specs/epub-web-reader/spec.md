# Spec Delta

## ADDED Requirements

### Requirement: EPUB outline in page browser tabs

Reader SHALL display EPUB chapter navigation in a 「章节目录」 tab in the same tablist as the existing page browser tabs. Only the selected panel SHALL be visible. The tab SHALL support the tablist's keyboard navigation. Each opening SHALL select 「页面」 when available, and 「高亮」 otherwise.

#### Scenario: Open, navigate, and reopen
- **WHEN** a user opens the browser in Layout, selects 「章节目录」 by keyboard or pointer, and activates a nested chapter
- **THEN** the browser starts on 「页面」 with no chapter content above the tabs, shows the chapter tree only when selected, and displays the selected chapter in the reader. Reopening selects 「页面」.

#### Scenario: Browse in text mode or with no chapters
- **WHEN** the user opens the browser in EPUB text mode or selects 「章节目录」 for an EPUB without a chapter tree
- **THEN** text mode starts on 「高亮」 and still offers 「章节目录」. An EPUB without chapters shows an empty state in the directory panel. Other tabs remain usable.
