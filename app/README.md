# Hamster Reader Expo host

Expo SDK 54 dev client that hosts the Web reader in a `react-native-webview`.

```bash
# from repository root
yarn install --frozen-lockfile
yarn prepare:ios            # pinned native edit-menu fix; rerun after installing dependencies
yarn build:webview          # writes app/assets/webreader.zip
yarn verify:webview
yarn host:prebuild
yarn host:android           # or: yarn host:ios on macOS
```

`app/assets/webreader.zip` is generated (gitignored). The app refuses to start the
reader until the zip exists. See `../docs/expo-host.md` for architecture, security
rules and the verification matrix.

The iOS scripts apply the pinned react-native-webview patch automatically.
When building an existing Xcode workspace directly, run `yarn prepare:ios` from
the repository root first, then rebuild the native app. Metro reload alone does
not install this fix. The script rejects unsupported or divergent native sources.

Publication cache records use paths relative to the current Documents directory.
Legacy absolute URIs are resolved by stable file ID in the current container, so
covering an existing installation does not require reimporting its books.

The production entry now renders the EPUB/PDF reader. The former diagnostic entry
is retained as source in `webview/diagnostics.html`, outside the production bundle.
See `../docs/integration-acceptance.md` for current results and unpassed gates.
