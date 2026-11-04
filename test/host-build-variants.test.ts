import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const configure = require('../app/app.config.js')
const { expo: baseConfig } = require('../app/app.json')

afterEach(() => vi.unstubAllEnvs())

describe('iOS host build variants', () => {
  it('keeps preview separate after EAS writes the dev bundle ID into the static config', () => {
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

  it('gives the dev launcher a separate identity while preserving host settings', () => {
    vi.stubEnv('APP_VARIANT', 'development')
    const development = configure({ config: baseConfig })
    expect(development.ios.bundleIdentifier).toBe('com.hamsternote.reader.dev')
    expect(development.scheme).toBe('hamsterreader-dev')
    expect(development.name).toBe('Hamster Reader Dev')
    expect(development.extra.eas).toEqual(baseConfig.extra.eas)
    expect(development.ios.buildNumber).toBe(baseConfig.ios.buildNumber)
    expect(development.plugins).toEqual([
      ...baseConfig.plugins,
      ['expo-dev-client', { addGeneratedScheme: false, launchMode: 'launcher' }]
    ])
  })
})
