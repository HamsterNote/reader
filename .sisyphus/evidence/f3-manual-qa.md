# F3 Manual QA

## Command verification
- `yarn install --frozen-lockfile`: passed. Yarn reported `Already up-to-date.`
- `yarn test:run`: passed. `2` test files and `3` tests all passed.
- `yarn build`: passed. Library build emitted `dist/index.js` and demo build emitted `demo-dist/index.html`.
- `yarn pack:check`: passed. Pack guard reported `Pack check passed with 9 files.`

## Demo path verification
- `demo/App.tsx` imports `Reader` from `@hamster-note/reader`.
- `demo/main.tsx` imports styles from `@hamster-note/reader/style.css`.
- `vite.config.ts` keeps the dev aliases for `@hamster-note/reader` and `@hamster-note/reader/style.css`, so local preview still exercises the package-name demo path.

## Browser QA
- Dev server started with `yarn dev --host 127.0.0.1 --strictPort` and loaded successfully at `http://127.0.0.1:5173/`.
- Playwright confirmed page title `Hamster Reader Demo`.
- Playwright confirmed root marker `[data-testid="reader-demo-root"]` exists.
- Playwright confirmed placeholder content renders as `Demo Document Title`.
- Playwright console inspection found `Errors: 0, Warnings: 0`; only one React DevTools info message appeared.

## Cleanup
- Dev server process was stopped after QA.

## Final assessment
- Final Wave F3 manual QA passes end-to-end for install, test, build, pack, dev preview, package-name demo wiring, rendered content, and browser console cleanliness.

VERDICT: APPROVE
