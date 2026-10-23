# Hamster Reader Expo host

Expo SDK 54 dev client that hosts the Web reader in a `react-native-webview`.

```bash
# from repository root
yarn install --frozen-lockfile
yarn build:webview          # writes app/assets/webreader.zip
yarn verify:webview
cd app && npx expo prebuild
yarn host:android           # or: yarn host:ios on macOS
```

`app/assets/webreader.zip` is generated (gitignored). The app refuses to start the
reader until the zip exists. See `../docs/expo-host.md` for architecture, security
rules and the verification matrix.

Reading resource self-check: open the app and press “运行资源自检”; the standalone
URL `index.html?selftest=1` runs the same checks automatically.
