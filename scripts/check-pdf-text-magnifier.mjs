import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { checkSharedSelectionInteraction } from './check-shared-selection-interaction.mjs'

// The old snapshot/18px-anchor mouse oracle predates managed text lenses.
// Exercise the actual PDF Text surface: touch-only lens, physical sampling,
// glyph scale, safe bounds, insertion marker and saved/draft handle lifecycles.
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const output = resolve('test-results/pdf-text-magnifier')
  await mkdir(output, { recursive: true })
  console.log(
    await checkSharedSelectionInteraction({
      browser,
      base: `http://127.0.0.1:${server.httpServer.address().port}`,
      output,
      surfaces: ['pdf-text']
    })
  )
} finally {
  await browser?.close()
  await server.close()
}
