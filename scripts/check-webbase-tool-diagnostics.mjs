// Read-only probe: transforms diagnostic counters in memory, never edits WebBase.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const host = resolve(process.env.WEBBASE_ROOT ?? '../WebBase', 'webview')
const output = resolve('test-results/workspace-interactions')
await mkdir(output, { recursive: true })
const { createServer } = await import(
  pathToFileURL(resolve(host, 'node_modules/vite/dist/node/index.js')).href
)
const server = await createServer({
  root: host,
  configFile: resolve(host, 'vite.config.ts'),
  resolve:
    process.env.READER_PROBE_LOCAL === '1'
      ? {
          dedupe: ['react', 'react-dom'],
          alias: [
            {
              find: /^@hamster-note\/reader$/,
              replacement: resolve('dist/index.js')
            },
            {
              find: /^@hamster-note\/reader\/style\.css$/,
              replacement: resolve('dist/style.css')
            }
          ]
        }
      : undefined,
  plugins: [
    {
      name: 'ham276-read-only-counters',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/ReaderEditorPane.tsx'))
          return code
            .replace(
              '  const toolbar = usePaneToolbar()',
              `
      const probe = (window as any).__readerProbe
      if (probe.source !== state.engineSource) { probe.sourceChanges++; probe.source = state.engineSource }
      probe.path = state.filePath
      probe.loading = state.loading
      const toolbar = usePaneToolbar()`
            )
            .replace(
              'onDataChange={data => {',
              'onDataChange={data => { (window as any).__readerProbe.data = data;'
            )
            .replace(
              'onEngineReady={() => {',
              'onEngineReady={() => { (window as any).__readerProbe.ready++;'
            )
            .replace(
              'onEngineDisposal={trackReaderDisposal}',
              'onEngineDisposal={p => { (window as any).__readerProbe.disposals++; trackReaderDisposal(p) }}'
            )
        if (id.endsWith('/useReaderDocument.ts'))
          return code.replace(
            'const loadFile = useCallback(async () => {',
            'const loadFile = useCallback(async () => { (window as any).__readerProbe.loads++;'
          )
        if (id.endsWith('/browser-native-host.ts'))
          return code.replace(
            'function postMessage(serializedMessage: string): void {',
            'function postMessage(serializedMessage: string): void { (window as any).__readerProbe.messages.push(JSON.parse(serializedMessage));'
          )
      }
    }
  ],
  server: {
    host: '127.0.0.1',
    port: 49576,
    strictPort: false,
    fs: { allow: [host, resolve('.')] }
  }
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  page.setDefaultTimeout(20000)
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
  await page.addInitScript(() => {
    window.__readerProbe = {
      ready: 0,
      disposals: 0,
      loads: 0,
      sourceChanges: 0,
      messages: []
    }
  })
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/?demo=1`
  )
  for (const file of [
    'test/browser/eight-pages.pdf',
    'test/compat/fixtures/epub/duplicate-text.epub'
  ]) {
    await page.locator('input[type=file]').setInputFiles(resolve(file))
    await page.getByText('写入并打开', { exact: true }).click()
    await page.waitForFunction(
      () => window.__readerProbe.ready > 0 && !window.__readerProbe.loading
    )
    await page.screenshot({ path: resolve(output, 'host-debug.png') })
    const take = () =>
      page.evaluate(() => {
        const p = window.__readerProbe
        const c = document.querySelector('.reader-fullscreen')
        if (!window.__readerContainer) window.__readerContainer = c
        return {
          ready: p.ready,
          disposals: p.disposals,
          loads: p.loads,
          sourceChanges: p.sourceChanges,
          timeOrigin: performance.timeOrigin,
          navigations: performance.getEntriesByType('navigation').length,
          sameContainer: window.__readerContainer === c,
          messages: p.messages.map((m) => ({ type: m.type, event: m.event })),
          data: p.data,
          sourceId: p.source?.format,
          pageTop: document.querySelector(
            '.hamster-reader__pdf-viewer-container'
          )?.scrollTop
        }
      })
    if (file.endsWith('.pdf')) {
      await page.getByRole('slider').focus()
      for (let n = 0; n < 4; n++) await page.keyboard.press('ArrowDown')
      await page.waitForFunction(
        () =>
          document.querySelector('.hamster-reader__pdf-viewer-container')
            ?.scrollTop > 300
      )
    } else {
      await page.getByRole('button', { name: '下一页', exact: true }).click()
      await page.waitForFunction(
        () => window.__readerProbe.data?.layoutReadingProgress?.textId
      )
    }
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    const before = await take()
    const scope = page.getByRole('region', { name: 'WebView 预览' })
    for (let i = 0; i < 10; i++)
      for (const label of ['绘图工具', '文字工具']) {
        const menu = scope.getByRole('button', {
          name: '工具菜单',
          exact: true
        })
        if (await menu.count()) await menu.click()
        await scope
          .getByTestId(
            label === '绘图工具'
              ? 'tool-bottom-bar-drawing'
              : 'tool-bottom-bar-text-selection'
          )
          .click()
      }
    const after = await take()
    for (const name of [
      'ready',
      'disposals',
      'loads',
      'sourceChanges',
      'timeOrigin',
      'navigations'
    ])
      assert.equal(after[name], before[name], name)
    assert.equal(after.sameContainer, true)
    if (file.endsWith('.pdf'))
      assert(
        Math.abs(after.pageTop - before.pageTop) <= 1,
        JSON.stringify({ before, after })
      )
    else
      assert.deepEqual(
        after.data.layoutReadingProgress,
        before.data.layoutReadingProgress
      )
    console.log(JSON.stringify({ file, before, after }))
    await writeFile(
      resolve(output, `host-${file.endsWith('.pdf') ? 'pdf' : 'epub'}.json`),
      JSON.stringify({ file, before, after }, null, 2)
    )
    await page.evaluate(() => {
      window.__readerProbe.ready = 0
      window.__readerProbe.data = null
      window.__readerContainer = null
    })
  }
} finally {
  await browser?.close()
  await server.close()
}
