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

`Reader` is parser-agnostic. It accepts an intermediate document (produced by parser packages such as `@hamster-note/pdf-parser`, `@hamster-note/docx-parser`, etc.) and renders it through the intermediate-document renderer. Pages are rendered in `contain` fit mode by default (hardcoded inside `IntermediateDocumentViewer`).

The renderer lazily loads page content on demand via a visibility-debounced queue with concurrency control and offscreen-release, designed for long documents without blocking the main thread.

#### Lazy Page Loading Props

The following optional props control the lazy loading queue:

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialLoadedPages` | `number` | `1` | Number of pages to load immediately on mount (before visibility-based queue kicks in). |
| `pageLoadConcurrency` | `number` | `3` | Maximum number of pages loaded concurrently. |
| `pageLoadEnterDelayMs` | `number` | `500` | A non-initial page must remain continuously visible for this duration (ms) before its content load is enqueued. Prevents fast-scroll from triggering loads. |
| `pageUnloadDelayMs` | `number` | `5000` | After a loaded page leaves the visible window, wait this duration (ms) before unloading its content back to an empty shell. Re-entering before the delay cancels the unload. |

#### Render Timing

To diagnose bottlenecks in the render pipeline, you can opt in to stage-by-stage timing logs. Production builds emit **no timing output by default**.

**Activation paths:**

1. **Callback prop** — receive every timing entry in code:
   ```tsx
   <Reader
     document={document}
     onIntermediateDocumentRenderTiming={(entry) => {
       console.table(entry)
     }}
   />
   ```

2. **Environment flag** — print `console.debug` logs when no callback is provided:
   ```bash
   VITE_HAMSTER_READER_INTERMEDIATE_TIMING=true
   ```

Each entry has the following shape:

| Field | Type | Description |
|---|---|---|
| `stage` | `string` | One of `document-resolution`, `shell-rendering`, `initial-page-loading`, `content-extraction`, `page-content-rendering`, `visibility-lazy-loading`, `offscreen-unload`, `ocr-processing`. |
| `startedAt` | `number` | Start timestamp (ms). |
| `endedAt` | `number` | End timestamp (ms). |
| `durationMs` | `number` | `endedAt - startedAt`. |
| `pageNumber` | `number` *(optional)* | Present for page-scoped stages. |
| `detail` | `object` *(optional)* | Stage-specific context such as `pageCount`, `textCount`, `imageCount`, or `status`. |

#### Demo Upload Formats

The browser Demo supports uploading and previewing the following formats:

- **PDF** (`.pdf`)
- **TXT** (`.txt`)
- **DOCX** (`.docx`)
- **Markdown** (`.md`, `.markdown`)

EPUB (`.epub`) is **not supported** in this browser Demo because `@hamster-note/epub-parser` is Node.js-only and requires a separate server-side design.

## API Notes

Enable OCR for visible pages with the `ocr` prop, and listen for text selection updates with `onTextSelectionChange` and `onTextSelectionEnd`.

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

### Text render mode

`Reader` uses `renderMode='layout'` by default. Set `renderMode='text'` to render a text-only reading view that mounts and loads only the virtual pages currently visible in the scroll viewport.

Text mode renders document text as normal flow content. It does not render page images, intermediate images, or OCR output, and it does not convert existing layout-mode highlight geometry into text-flow highlight geometry.

### Text, rectangle, and drawing tools

In layout mode, `selectedTool` switches the active page interaction without replacing the virtualized reader. Existing zoom, page-range, OCR, lazy loading, and linked-selection behavior therefore remains available in every tool mode.

```tsx
const [selectedTool, setSelectedTool] = useState<ReaderPageTool>('text-selection')
const [pagePaintings, setPagePaintings] = useState<ReaderPagePaintingMap>({})

<Reader
  document={document}
  selectedTool={selectedTool}
  pagePaintings={pagePaintings}
  onPagePaintingsChange={setPagePaintings}
/>
```

- `text-selection` uses the existing linked text-selection API (`ranges`, `onSelect`, `onUpdateRange`).
- `rect-selection` uses the existing rectangle API (`rects`, `onCreateRect`, `onUpdateRect`).
- `drawing` enables a per-page `DrawingSurface`; painting map keys use stable public IDs such as `page-1` and `page-2`.
- An explicitly supplied legacy `tool` prop takes precedence over the text/rectangle mapping from `selectedTool`.
- `renderMode='text'` remains text-only and does not mount drawing or rectangle overlays.

## Text Selection (@hamster-note/selection)

`Reader` integrates [`@hamster-note/selection`](https://www.npmjs.com/package/@hamster-note/selection) to provide rich text-selection features, highlighted ranges, popovers, and programmatic control on top of the native browser `Selection` API.

The `<Selection>` component wraps page content inside `<VirtualPaper>` and is active by default. The legacy native callbacks (`onTextSelectionChange`, `onTextSelectionEnd`, `onSelectText`) continue to fire alongside the linked-range Selection component.

### Linked range shape

`Reader` uses a linked range shape. Each endpoint carries a public page `selectionId`, and overlay rectangles are grouped by that page id in `rectsBySelectionId`.

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

### Quick Start (linked selection)

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
| `highlightColor` | `string` | Default CSS color for highlight overlays. A range-specific `markerStyle.backgroundColor` takes precedence. |
| `selectionColor` | `string` | CSS color for active selection overlay. |
| `selectionPopover` | `React.ReactNode` | Custom popover content shown during active selection (before it becomes a highlight). |
| `highlightPopover` | `React.ReactNode \| ((highlight: ReaderSelectionRange) => React.ReactNode)` | Custom popover content shown when an existing highlight is clicked. The renderer receives the original range object, so range-specific color and metadata can be displayed. |
| `onCommentHighlight` | `(highlight: ReaderSelectionRange) => Promise<ReaderSelectionRange>` | Adds a comment button to the existing-highlight popover. The callback receives the original range reference. Resolve with that same range when the host comment UI closes; Reader then closes the popover. |
| `selectionRef` | `React.Ref<ReaderSelectionRef>` | Reader-owned command ref, distinct from the upstream Selection component ref. Exposes `highlight()`, `clear()`, and additive `scrollToRange(id)` for jumping to an existing range. |
| `overlayRectType` | `ReaderSelectionOverlayRectType` | Controls whether selection overlay rectangles are stored/rendered as pixel (`'px'`) or percentage (`'percent'`) coordinates relative to the selection container. Defaults to `'percent'`. |
| `containMarginX` | `number` | Horizontal whitespace around the virtual paper. |
| `containMarginTop` | `number` | Independent top whitespace around the virtual paper. |
| `containMarginBottom` | `number` | Independent bottom whitespace around the virtual paper. |
| `containMarginY` | `number` | Deprecated symmetric vertical whitespace fallback. It is ignored when either independent vertical margin is supplied. |
| `showPageBrowser` | `boolean` | Shows a left-side, vertically scrollable page browser in layout mode. Its thumbnails use the same lazy-loading queue and cache as the main view. Defaults to `false`. |

The existing-highlight popover can use range-specific data and delegate the comment lifecycle to the host:

```tsx
<Reader
  ranges={ranges}
  selectedRangeId={selectedRangeId}
  highlightPopover={(highlight) => (
    <input
      type='color'
      value={String(highlight.markerStyle?.backgroundColor ?? '#ffc107')}
    />
  )}
  onCommentHighlight={(highlight) =>
    new Promise((resolve) => {
      openCommentEditor(highlight, () => resolve(highlight))
    })
  }
/>
```

### Exported Types

```ts
import type {
  ReaderSelectionRange,    // linked: { id, text, start, end, rectsBySelectionId, overlayRectType? }
  ReaderSelectionOverlayRectType,  // 'px' | 'percent'
  ReaderSelectionRef,      // { highlight(): void; clear(): void; scrollToRange(id: string): void }
  ReaderMousePosition      // { x, y }, viewport coordinates (clientX/clientY)
} from '@hamster-note/reader'
```

### Touch pan mode

`Reader` uses single-finger document panning by default:

```tsx
<Reader document={document} touchPanMode='single-finger' />
```

Set `touchPanMode='two-finger'` when the host app needs one-finger touch gestures for something else. In this mode, one finger no longer moves the document, while two-finger pinch zoom and pinch movement keep the same behavior as the default layout reader.

This prop applies to layout mode only. `renderMode='text'` does not mount `VirtualPaper`, so touch pan mode has no effect there.

### CSS

`@hamster-note/reader/style.css` already bundles the Selection library CSS (`.hsn-selection-*` classes). No additional import is needed.

### Legacy Selection Callbacks

The existing `onTextSelectionChange`, `onTextSelectionEnd`, and `onSelectText` callbacks are preserved for backward compatibility. They continue to fire through the native `mouseup`/`touchend`/`selectionchange` listeners on the viewer root element, independent of the `<Selection>` component. They are not affected by the linked range shape.

> **Note**: `onSelectionEnd` is **mouseup-based**. On touch devices, the selection-end signal relies on the legacy `touchend` listener (which fires `onTextSelectionEnd` / `onSelectText`), not `onSelectionEnd`.

### Demo localStorage Migration

The browser Demo persists highlights to localStorage keyed by filename. The stored shape is now `{ version: 2, ranges: ReaderSelectionRange[] }`. Older unversioned bare arrays, or legacy objects with flat numeric `start`/`end` and `rects`, are ignored and return `[]`. Their page ownership cannot be proven, so the demo does not attempt to migrate them. If you have old data, recreate the highlights instead.

### Programmatic Control

`selectionRef` exposes Reader-level commands. `highlight()` and `clear()` are forwarded to the active page Selection instances; `scrollToRange(id)` is implemented by Reader to translate the VirtualPaper viewport to an existing range while preserving the current scale.

```tsx
import { useRef } from 'react'
import type { ReaderSelectionRef } from '@hamster-note/reader'

const selectionRef = useRef<ReaderSelectionRef>(null)

// Highlight the current native selection as a range
selectionRef.current?.highlight()

// Clear all highlights
selectionRef.current?.clear()

// Scroll the viewer to a specific range by id
selectionRef.current?.scrollToRange('highlight-1')
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

- Push a `vX.Y.Z` tag for stable releases.
- Push a `vX.Y.Z-<prerelease>` tag for pre-releases (e.g. `v1.0.0-beta`, `v1.0.0-dev`).
- Publish tag selection follows the package version suffix: no suffix -> `latest`, `-dev` -> `dev`, `-beta` -> `beta`.
