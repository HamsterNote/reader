import { createServer } from 'vite'
import { chromium } from 'playwright'
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/native-pdf.html`
  )
  const result = await page.evaluate(async () => await window.nativeProbe)
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        environment: 'Linux Chromium (not PDFKit/iOS)',
        pages: result
      },
      null,
      2
    )
  )
} finally {
  await browser?.close()
  await server.close()
}
