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

`Reader` remains parser-agnostic. It accepts an intermediate document and internally renders it through `@hamster-note/html-parser`, converting the structured document data into HTML for display. Consumers (including the browser Demo) use parser packages to produce intermediate documents before passing them to `Reader`. Producers such as `@hamster-note/pdf-parser` can continue feeding the same intermediate-document contract. No consumer-side changes are required.

#### Demo Upload Formats

The browser Demo supports uploading and previewing the following formats:

- **PDF** (`.pdf`)
- **TXT** (`.txt`)
- **DOCX** (`.docx`)
- **Markdown** (`.md`, `.markdown`)

EPUB (`.epub`) is **not supported** in this browser Demo because `@hamster-note/epub-parser` is Node.js-only and requires a separate server-side design.

## API Notes

Enable OCR for visible pages with the `ocr` prop, and listen for text selection updates with `onTextSelectionChange` and `onTextSelectionEnd`.

> **Note**: When `Reader` successfully renders through the html-parser path, text-selection and OCR overlays rely on the html-parser output markup and may behave differently than on the legacy direct-render fallback path. If you need full text-selection or OCR fidelity, the component automatically falls back to the direct renderer when html-parser decoding fails.

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

`Reader` integrates [`@hamster-note/selection`](https://www.npmjs.com/package/@hamster-note/selection) to provide rich text-selection features — highlighted ranges, popovers, and programmatic control — on top of the native browser `Selection` API.

The `<Selection>` component wraps the html-parser output **inside** `<VirtualPaper>` and **outside** the html-parser rendered content. It is active only in `html-parser` render mode; the `direct` render path is unaffected.

### Quick Start

```tsx
import { Reader } from '@hamster-note/reader'
import type { ReaderSelectionRange } from '@hamster-note/reader'
import '@hamster-note/reader/style.css'   // includes Selection CSS
import { useState } from 'react'

export function App() {
  // 受控模式：Reader 不内部修改 ranges，由 onSelect 回调外部追加
  const [ranges, setRanges] = useState<ReaderSelectionRange[]>([])

  return (
    <Reader
      document={document}
      renderMode='html-parser'
      ranges={ranges}
      overlayRectType='percent'
      onSelect={(range) => setRanges((prev) => [...prev, range])}
    />
  )
}
```

### Props

| Prop | Type | Description |
|---|---|---|
| `ranges` | `ReaderSelectionRange[]` | Controlled highlight ranges. Reader does not mutate this array. |
| `defaultRanges` | `ReaderSelectionRange[]` | Initial ranges for uncontrolled mode (when `ranges` is omitted). |
| `selectedRangeId` | `string \| null` | Controlled currently-selected range ID. |
| `defaultSelectedRangeId` | `string \| null` | Initial selected range ID for uncontrolled mode. |
| `onSelect` | `(range: ReaderSelectionRange) => void` | Fired when the user finishes a new selection. In uncontrolled mode, Reader appends the range internally before calling this. |
| `onSelectRange` | `(id: string \| null) => void` | Fired when the user clicks an existing highlight. |
| `onHighlight` | `(range: ReaderSelectionRange) => void` | Fired when a range is highlighted via the ref API. |
| `onSelectionStart` | `(mousePos: ReaderMousePosition, selection: Selection) => void` | Fired when a selection gesture begins. |
| `onSelectionEnd` | `(mousePos: ReaderMousePosition, selection: Selection) => void` | Fired when a selection gesture ends (mouseup-based; touch selection may not trigger this). |
| `highlightColor` | `string` | CSS color for highlight overlays. |
| `selectionColor` | `string` | CSS color for active selection overlay. |
| `selectionPopover` | `React.ReactNode` | Custom popover content shown during active selection. |
| `selectionRef` | `React.Ref<ReaderSelectionRef>` | Ref to the Selection component. Exposes `highlight()` and `clear()`. |
| `overlayRectType` | `ReaderSelectionOverlayRectType` | Controls whether selection overlay rectangles are stored/rendered as pixel (`'px'`) or percentage (`'percent'`) coordinates relative to the selection container. Defaults to `'percent'`. |

### Exported Types

```ts
import type {
  ReaderSelectionRange,    // { id, text, start, end, createdAt, overlayRectType?, rects? }
  ReaderSelectionOverlayRectType,  // 'px' | 'percent'
  ReaderSelectionRef,      // { highlight(): void; clear(): void }
  ReaderMousePosition      // { x, y } — viewport coordinates (clientX/clientY)
} from '@hamster-note/reader'
```

### CSS

`@hamster-note/reader/style.css` already bundles the Selection library CSS (`.hsn-selection-*` classes). No additional import is needed.

### Legacy Selection Callbacks

The existing `onTextSelectionChange`, `onTextSelectionEnd`, and `onSelectText` callbacks are preserved for backward compatibility. They continue to fire through the native `mouseup`/`touchend`/`selectionchange` listeners on the viewer root element, independent of the `<Selection>` component.

> **Note**: `onSelectionEnd` is **mouseup-based**. On touch devices, the selection-end signal relies on the legacy `touchend` listener (which fires `onTextSelectionEnd` / `onSelectText`), not `onSelectionEnd`.

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
