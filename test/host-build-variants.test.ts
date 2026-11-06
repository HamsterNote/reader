import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const configure = require('../app/app.config.js')
const { expo: baseConfig } = require('../app/app.json')

afterEach(() => vi.unstubAllEnvs())

describe('iOS host build variants', () => {
  it('uses the provisioned identifier even if static config contains an old variant ID', () => {
    vi.stubEnv('APP_VARIANT', '')
    const config = {
      ...baseConfig,
      ios: { ...baseConfig.ios, bundleIdentifier: 'com.hamsternote.reader.dev' }
    }
    const preview = configure({ config })
    expect(preview.ios.bundleIdentifier).toBe('com.hamsternote.reader')
    expect(preview.scheme).toBe('hamsterreader')
    expect(config.ios.bundleIdentifier).toBe('com.hamsternote.reader.dev')
  })

  it('gives the dev launcher its own name and scheme with the existing signing identity', () => {
    vi.stubEnv('APP_VARIANT', 'development')
    const development = configure({ config: baseConfig })
    expect(development.ios.bundleIdentifier).toBe('com.hamsternote.reader')
    expect(development.scheme).toBe('hamsterreader-dev')
    expect(development.name).toBe('Hamster Reader Dev')
    expect(development.extra.eas).toEqual(baseConfig.extra.eas)
    expect(development.ios.buildNumber).toBe('2')
    expect(development.ios.supportsTablet).toBe(baseConfig.ios.supportsTablet)
    expect(development.plugins).toEqual([
      ...baseConfig.plugins,
      ['expo-dev-client', { addGeneratedScheme: false, launchMode: 'launcher' }]
    ])
  })
})
