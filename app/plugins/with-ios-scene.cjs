/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads config plugins through CommonJS. */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins')

// SDK 57 ships ExpoAppSceneDelegate, but its template still starts RN in a
// scene-less window. Keep factory creation in AppDelegate and let Expo create
// the window and forward lifecycle/linking events when the scene connects.
const legacyStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`
const sceneStartup =
  '    // ExpoAppSceneDelegate creates the window and starts React Native.'

function configureAppDelegate(source) {
  const declaration = 'class AppDelegate: ExpoAppDelegate'
  const sceneDeclaration = `${declaration}, ExpoReactNativeFactoryProvider`
  if (!source.includes(sceneDeclaration)) {
    if (!source.includes(`${declaration} {`))
      throw new Error('UIScene: unsupported SDK 57 AppDelegate declaration')
    source = source.replace(declaration, sceneDeclaration)
  }
  if (source.includes(legacyStartup))
    return source.replace(legacyStartup, sceneStartup)
  if (!source.includes(sceneStartup))
    throw new Error('UIScene: unsupported SDK 57 React Native startup block')
  return source
}

module.exports = function withIosScene(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate'
          }
        ]
      }
    }
    return config
  })
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift')
      throw new Error('UIScene: expected the SDK 57 Swift AppDelegate')
    config.modResults.contents = configureAppDelegate(
      config.modResults.contents
    )
    return config
  })
}

module.exports.configureAppDelegate = configureAppDelegate
