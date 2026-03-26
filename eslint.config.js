import baseConfig from '@system-ui-js/development-base/eslint.config.js'

export default [
  {
    ignores: ['dist/**', 'demo-dist/**']
  },
  ...baseConfig
]
