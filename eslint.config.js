import baseConfig from '@system-ui-js/development-base/eslint.config.js'

export default [
  {
    ignores: [
      'dist/**',
      'demo-dist/**',
      'package/dist/**',
      '.yalc/**',
      '.omo/**',
      // 第三方 vendored 资产保持上游原样（vendor/foliate-js/MANIFEST.md 锁定
      // sha256），不参与本仓库 lint/format。
      'vendor/foliate-js/**/*.js',
      // pdf.js 是 reader 自有桩（非上游文件），仍受 lint 约束。
      '!vendor/foliate-js/pdf.js'
    ]
  },
  ...baseConfig
]
