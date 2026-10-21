import baseConfig from '@system-ui-js/development-base/eslint.config.js'

export default [
  {
    ignores: [
      'dist/**',
      'demo-dist/**',
      'webview-dist/**',
      'app/android/**',
      'app/ios/**',
      'app/.expo/**',
      'app/assets/**',
      'vendor/**',
      'package/dist/**',
      '.yalc/**',
      '.omo/**'
    ]
  },
  ...baseConfig
]
