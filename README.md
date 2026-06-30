# @hamster-note/reader

React reader component package for Hamster Note.

## 安装

Install the package and its peer dependencies:

```bash
yarn add @hamster-note/reader react react-dom
```

## 使用

Styles are not injected automatically. Import `@hamster-note/reader/style.css` explicitly before rendering `Reader`.

```tsx
import { Reader } from '@hamster-note/reader'
import type { ReaderProps } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'

const document: NonNullable<ReaderProps['document']> = {
  id: 'demo-document',
  title: 'Hello Hamster',
  pages: []
}

export function App() {
  return <Reader document={document} emptyText='No document' />
}
```

### How It Works

`Reader` is parser-agnostic. It accepts an intermediate document (produced by parser packages such as `@hamster-note/pdf-parser`, `@hamster-note/docx-parser`, etc.) and renders it through one of three render modes, controlled by the optional `renderMode` prop:

| `renderMode` | Description | Default? |
|---|---|---|
| `'intermediate-document'` | New lazy renderer. Renders stable page shells first, then loads page content on demand via a visibility-debounced queue with concurrency control and offscreen-release. Designed for long documents without blocking the main thread. | **Yes** — used when `renderMode` is omitted. |
| `'html-parser'` | Decodes each page to an HTML fragment via `@hamster-note/html-parser` (`HtmlParser.decodePageToHtml`). The original render path; retained for explicit compatibility. Text-selection (`@hamster-note/selection`) linked-range features are fully active in this mode. | No — opt in with `renderMode='html-parser'`. |
| `'direct'` | Renders intermediate-document content (texts, images, OCR) directly without html-parser. Useful when you want the raw document structure without HTML conversion. | No — opt in with `renderMode='direct'`. |

> **Note**: `@hamster-note/html-parser` remains a dependency and is **not** removed. Users who need the html-parser path (e.g., for linked-range selection features) can explicitly opt in via `renderMode='html-parser'`. When `Reader` successfully renders through html-parser, text-selection and OCR overlays rely on the html-parser output markup and may behave differently than on the direct or intermediate-document paths. If html-parser decoding fails for a page, the component falls back to direct rendering for that page.

#### Lazy Page Loading Props (`intermediate-document` mode only)

When `renderMode` is omitted (or set to `'intermediate-document'`), the following optional props control the lazy loading queue:

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialLoadedPages` | `number` | `1` | Number of pages to load immediately on mount (before visibility-based queue kicks in). |
| `pageLoadConcurrency` | `number` | `3` | Maximum number of pages loaded concurrently. |
| `pageLoadEnterDelayMs` | `number` | `500` | A non-initial page must remain continuously visible for this duration (ms) before its content load is enqueued. Prevents fast-scroll from triggering loads. |
| `pageUnloadDelayMs` | `number` | `5000` | After a loaded page leaves the visible window, wait this duration (ms) before unloading its content back to an empty shell. Re-entering before the delay cancels the unload. |

These props are ignored in `'html-parser'` and `'direct'` modes.

#### Demo Upload Formats

The browser Demo supports uploading and previewing the following formats:

- **PDF** (`.pdf`)
- **TXT** (`.txt`)
- **DOCX** (`.docx`)
- **Markdown** (`.md`, `.markdown`)

EPUB (`.epub`) is **not supported** in this browser Demo because `@hamster-note/epub-parser` is Node.js-only and requires a separate server-side design.

## API Notes

Enable OCR for visible pages with the `ocr` prop, and listen for text selection updates with `onTextSelectionChange` and `onTextSelectionEnd`.

> **Note**: To use the linked-range text-selection features described below, set `renderMode='html-parser'` explicitly. In the default `'intermediate-document'` mode, text selection relies on the lazy-rendered page content markup and may behave differently. The component falls back to direct rendering when html-parser decoding fails.

```tsx
<Reader
  document={document}
  ocr
  onTextSelectionChange={(text, detail) => {
    // handle selection change
  }}
  onTextSelectionEnd={(text, detail) => {
    // handle selection end
  }}
/>
```

## Text Selection (@hamster-note/selection)

`Reader` integrates [`@hamster-note/selection`](https://www.npmjs.com/package/@hamster-note/selection) to provide rich text-selection features, highlighted ranges, popovers, and programmatic control on top of the native browser `Selection` API.

The `<Selection>` component wraps the html-parser output **inside** `<VirtualPaper>` and **outside** the html-parser rendered content. It is fully active in `html-parser` render mode (opt-in via `renderMode='html-parser'`). The `direct` render path, the default `intermediate-document` path, and the legacy native callbacks are unaffected by the linked-range Selection component.

### Linked range shape

In `html-parser` mode, `Reader` uses a linked range shape. Each endpoint carries a public page `selectionId`, and overlay rectangles are grouped by that page id in `rectsBySelectionId`.

```ts
{
  id: 'highlight-1',
  text: 'Selected text',
  start: { selectionId: 'page-1', offset: 12 },
  end: { selectionId: 'page-2', offset: 34 },
  createdAt: Date.now(),
  overlayRectType: 'percent',
  rectsBySelectionId: {
    'page-1': [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }],
    'page-2': [{ x: 0.05, y: 0.1, width: 0.4, height: 0.05 }]
  }
}
```

Public page ids are always `page-${pageNumber}` (for example, `page-1`, `page-2`). Internally, each `Reader` instance scopes runtime Selection ids so two Readers on the same page cannot collide, but public callbacks and stored data stay unscoped. You should only read and write the public `page-${pageNumber}` ids.

### Quick Start (html-parser mode with linked selection)

To use the linked-range selection features below, explicitly opt into `html-parser` render mode:

```tsx
import { Reader } from '@hamster-note/reader'
import type { ReaderSelectionRange } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'   // includes Selection CSS
import { useState } from 'react'

const initialRanges: ReaderSelectionRange[] = [
  {
    id: 'highlight-1',
    text: 'Selected text on page 1',
    start: { selectionId: 'page-1', offset: 12 },
    end: { selectionId: 'page-1', offset: 34 },
    createdAt: Date.now(),
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-1': [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }]
    }
  }
]

export function App() {
  // 受控模式：Reader 不内部修改 ranges，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>(initialRanges)

  return (
    <Reader
      document={document}
      renderMode='html-parser'
      ranges={ranges}
      overlayRectType='percent'
      onSelect={(range) => setRanges((prev) => [...prev, range])}
      onUpdateRange={(range) =>
        setRanges((prev) => prev.map((r) => (r.id === range.id ? range : r)))
      }
    />
  )
}
```

### Props

| Prop | Type | Description |
|---|---|---|
| `ranges` | `ReaderSelectionRange[]` | Controlled highlight ranges in the linked shape. Reader does not mutate this array. |
| `defaultRanges` | `ReaderSelectionRange[]` | Initial ranges for uncontrolled mode (when `ranges` is omitted). |
| `selectedRangeId` | `string \| null` | Controlled currently-selected range ID. |
| `defaultSelectedRangeId` | `string \| null` | Initial selected range ID for uncontrolled mode. |
| `onSelect` | `(range: ReaderSelectionRange) => void` | Fired when the user finishes a new selection. In uncontrolled mode, Reader appends the range internally before calling this. |
| `onSelectRange` | `(id: string \| null) => void` | Fired when the user clicks an existing highlight. |
| `onUpdateRange` | `(range: ReaderSelectionRange) => void` | Fired when the user drags a selected highlight range handle. In uncontrolled mode, Reader replaces the matching range internally before calling this; controlled callers must update their `ranges` array. |
| `onHighlight` | `(range: ReaderSelectionRange) => void` | Fired when a range is highlighted via the ref API or via Reader's internal auto-highlight (when `autoHighlight` is enabled). |
| `onSelectionStart` | `(mousePos: ReaderMousePosition, selection: Selection) => void` | Fired when a selection gesture begins. |
| `onSelectionEnd` | `(mousePos: ReaderMousePosition, selection: Selection) => void` | Fired when a selection gesture ends (mouseup-based; touch selection may not trigger this). |
| `autoHighlight` | `boolean` | When true, completing a text selection automatically creates a highlight. Reader fires `onHighlight` but does not append to ranges array. Defaults to `false`. |
| `highlightColor` | `string` | CSS color for highlight overlays. In Phase 1, this applies globally to all highlights. |
| `selectionColor` | `string` | CSS color for active selection overlay. |
| `selectionPopover` | `React.ReactNode` | Custom popover content shown during active selection (before it becomes a highlight). |
| `highlightPopover` | `React.ReactNode` | Custom popover content shown when an existing highlight is clicked. |
| `selectionRef` | `React.Ref<ReaderSelectionRef>` | Ref to the Selection component. Exposes `highlight()` and `clear()`. |
| `overlayRectType` | `ReaderSelectionOverlayRectType` | Controls whether selection overlay rectangles are stored/rendered as pixel (`'px'`) or percentage (`'percent'`) coordinates relative to the selection container. Defaults to `'percent'`. |

### Exported Types

```ts
import type {
  ReaderSelectionRange,    // linked: { id, text, start, end, rectsBySelectionId, overlayRectType? }
  ReaderSelectionOverlayRectType,  // 'px' | 'percent'
  ReaderSelectionRef,      // { highlight(): void; clear(): void }
  ReaderMousePosition      // { x, y }, viewport coordinates (clientX/clientY)
} from '@hamster-note/reader'
```

### CSS

`@hamster-note/reader/style.css` already bundles the Selection library CSS (`.hsn-selection-*` classes). No additional import is needed.

### Legacy Selection Callbacks

The existing `onTextSelectionChange`, `onTextSelectionEnd`, and `onSelectText` callbacks are preserved for backward compatibility. They continue to fire through the native `mouseup`/`touchend`/`selectionchange` listeners on the viewer root element, independent of the `<Selection>` component. They are not affected by the linked range shape.

> **Note**: `onSelectionEnd` is **mouseup-based**. On touch devices, the selection-end signal relies on the legacy `touchend` listener (which fires `onTextSelectionEnd` / `onSelectText`), not `onSelectionEnd`.

### Demo localStorage Migration

The browser Demo persists highlights to localStorage keyed by filename. The stored shape is now `{ version: 2, ranges: ReaderSelectionRange[] }`. Older unversioned bare arrays, or legacy objects with flat numeric `start`/`end` and `rects`, are ignored and return `[]`. Their page ownership cannot be proven, so the demo does not attempt to migrate them. If you have old data, recreate the highlights instead.

### Programmatic Control

```tsx
import { useRef } from 'react'
import type { ReaderSelectionRef } from '@hamster-note/reader'

const selectionRef = useRef<ReaderSelectionRef>(null)

// Highlight the current native selection as a range
selectionRef.current?.highlight()

// Clear all highlights
selectionRef.current?.clear()
```

## Peer Dependencies

- `react@^19.0.0`
- `react-dom@^19.0.0`

## 开发脚本

- `yarn dev`: start the local Vite dev server.
- `yarn build:lib`: build the library output in `dist/`.
- `yarn build:demo`: build the local demo output in `demo-dist/`.
- `yarn build:all`: build the library and demo.
- `yarn build`: run `yarn build:all`.
- `yarn typecheck`: run TypeScript type checking.
- `yarn lint`: run ESLint.
- `yarn test`: start Vitest in watch mode.
- `yarn test:run`: run Vitest once.
- `yarn preview`: preview the demo build.
- `yarn prepublishOnly`: build the library before publish.

## 发版规则

- Push `version/x.y.z` branches for stable releases.
- Push `version/x.y.z-*` branches for pre-releases.
- Publish tag selection follows the package version suffix: no suffix -> `latest`, `-dev` -> `dev`, `-beta` -> `beta`.
