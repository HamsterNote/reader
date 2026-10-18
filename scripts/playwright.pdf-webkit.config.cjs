const { existsSync } = require('node:fs')
const { default: config } = require('/work/playwright.pdf.config.ts')
const reader = existsSync('/work/test/browser/pdf-reader.spec.ts')

module.exports = {
  ...config,
  testDir: reader ? '/work/test/browser' : '/work/tests/e2e',
  outputDir: '/work/test-results/pdf-webkit',
  webServer: {
    ...config.webServer,
    command: reader
      ? 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5589 --strictPort'
      : 'node /pdf-test-tools/serve-pdf-export.mjs',
    cwd: '/work',
    timeout: 120000
  }
}
