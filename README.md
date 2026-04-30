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

## API Notes

Enable OCR for visible pages with the `ocr` prop, and listen for text selection updates with `onTextSelectionChange` and `onTextSelectionEnd`.

```tsx
<Reader
  document={document}
  ocr
  onTextSelectionChange={(text, detail) => {
    console.log('selection changed', text, detail.selectedText)
  }}
  onTextSelectionEnd={(text, detail) => {
    console.log('selection ended', text, detail.selectedText)
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
