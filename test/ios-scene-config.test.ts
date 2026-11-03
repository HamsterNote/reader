/* eslint-disable sonarjs/no-os-command-from-path -- Read Expo's bundled native template using tar without a shell. */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { configureAppDelegate } = require('../app/plugins/with-ios-scene.cjs')
const template = execFileSync(
  'tar',
  [
    '-xOf',
    resolve('node_modules/expo/template.tgz'),
    'package/ios/HelloWorld/AppDelegate.swift'
  ],
  { encoding: 'utf8' }
)

describe('SDK 57 UIScene adoption', () => {
  it('starts React Native only through the scene, preserving its factory and linking hooks', () => {
    const source = configureAppDelegate(template)
    expect(source).toContain('ExpoAppDelegate, ExpoReactNativeFactoryProvider')
    expect(source).toContain('reactNativeFactory = factory')
    expect(source).toContain(
      'delegate.dependencyProvider = RCTAppDependencyProvider()'
    )
    expect(source).not.toContain('UIWindow(frame:')
    expect(source).not.toContain('factory.startReactNative(')
    expect(source).toContain(
      'RCTLinkingManager.application(app, open: url, options: options)'
    )
    expect(source).toContain(
      'continue: userActivity, restorationHandler: restorationHandler'
    )
    expect(source).toContain('bridge.bundleURL ?? bundleURL()')
    expect(configureAppDelegate(source)).toBe(source)
  })

  it('rejects a changed template instead of silently generating a scene-less host', () => {
    expect(() =>
      configureAppDelegate(
        template.replace('class AppDelegate:', 'class OtherDelegate:')
      )
    ).toThrow('AppDelegate declaration')
    expect(() =>
      configureAppDelegate(
        template.replace(
          'window = UIWindow(frame:',
          'window = CustomWindow(frame:'
        )
      )
    ).toThrow('startup block')
  })

  it('registers the SDK scene delegate in the resolved Info.plist', () => {
    const config = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '../node_modules/expo/bin/cli',
          'config',
          '--type',
          'introspect',
          '--json'
        ],
        {
          cwd: resolve('app'),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
    )
    expect(
      config._internal.modResults.ios.infoPlist.UIApplicationSceneManifest
    ).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate'
          }
        ]
      }
    })
  })
})
