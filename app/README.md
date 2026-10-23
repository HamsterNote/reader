# Hamster Reader Expo host

Expo SDK 54 dev client that hosts the Web reader in a `react-native-webview`.

```bash
# from repository root
yarn install --frozen-lockfile
yarn build:webview          # writes app/assets/webreader.zip
yarn verify:webview
yarn host:prebuild
yarn host:android           # or: yarn host:ios on macOS
```

`app/assets/webreader.zip` is generated (gitignored). The app refuses to start the
reader until the zip exists. See `../docs/expo-host.md` for architecture, security
rules and the verification matrix.

The production entry now renders the EPUB/PDF reader. The former diagnostic entry
is retained as source in `webview/diagnostics.html`, outside the production bundle.
See `../docs/integration-acceptance.md` for current results and unpassed gates.
