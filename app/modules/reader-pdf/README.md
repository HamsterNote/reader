# ReaderPdf native module

The iOS podspec includes every Swift file under `ios/`. After adding or renaming a Swift source file, refresh an existing dev-client Pods project with `cd app/ios && pod install --no-repo-update` before running `yarn host:ios`; Expo autolinking discovers this module through `nativeModulesDir` and `expo-module.config.json`.
