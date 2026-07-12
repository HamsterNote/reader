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
