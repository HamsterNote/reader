# Hamster Reader Expo host

Expo SDK 57 dev client that hosts the Web reader in a `react-native-webview`.

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

## Internal iOS IPA (EAS)

From the repository root, install with `yarn install --frozen-lockfile`, then:

```bash
cd app
eas build -p ios --profile preview
```

The `preview` profile produces an ad-hoc signed Release IPA with the JavaScript
bundle and Web reader assets embedded; it runs without Metro. The project is
`wszxdhr/hamster-reader`. Register the target device with EAS and include its UDID
in the ad-hoc provisioning profile before building. Adding a device requires a
new build or re-signing the IPA.

For a development client that can coexist with the preview app:

```bash
cd app # from the repository root
eas build -p ios --profile development
```

`development` inherits the same Node/Yarn versions and build hooks, uses Debug
with `developmentClient: true`, and sets `APP_VARIANT=development`. The dynamic
app config gives this iOS app the name **Hamster Reader Dev**, Bundle ID
`com.hamsternote.reader.dev`, and URL scheme `hamsterreader-dev`. It opens the
development launcher, where you can enter `http://192.168.0.145:8092` to connect
to the current Metro server. Allow Local Network access and keep the phone on a
network that can reach the server.

For a new Metro session using this variant, run from the repository root:

```bash
APP_VARIANT=development yarn host:start --port 8092
```

This also makes Expo's generated launch URL use the dev app's scheme. The
existing Metro server can still be entered manually in the dev launcher.
Signing this separate Bundle ID requires its own ad-hoc provisioning profile;
include the target UDID when setting up the EAS credentials.

`app/yarn.lock` links to the repository's pinned lockfile for EAS's frozen host
dependency install. Keep dependency updates and installs at the repository root
so the shared lockfile continues to cover the library and build tools.
The pre-install hook installs those root build tools. The post-install hook
builds and verifies the gitignored Web reader ZIP
and applies the iOS WebView patch to the host's resolved native dependency.
These hooks must run on the cloud builder; generating assets only on the machine
submitting the build does not cover builds from a clean Git checkout.

App version and iOS build number are local values in `app.json`; increment the
build number before distributing a subsequent IPA of the same app version.

The iOS scripts apply the pinned react-native-webview patch automatically.
After upgrading from SDK 54, regenerate the native project with
`yarn host:prebuild --platform ios --clean` before building on macOS. This runs
the UIScene config plugin; Metro reload cannot update the native lifecycle.
Only use `--clean` when native directories contain no manual changes.
When building an existing Xcode workspace directly, run `yarn prepare:ios` from
the repository root first, then rebuild the native app. Metro reload alone does
not install this fix. The script rejects unsupported or divergent native sources.
See `../docs/ham140-ios-scene.md` for the lifecycle change and pending device checks.

Publication cache records use paths relative to the current Documents directory.
Legacy absolute URIs are resolved by stable file ID in the current container, so
covering an existing installation does not require reimporting its books.

The production entry now renders the EPUB/PDF reader. The former diagnostic entry
is retained as source in `webview/diagnostics.html`, outside the production bundle.
See `../docs/integration-acceptance.md` for current results and unpassed gates.
