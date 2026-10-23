import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const probeOrigin = 'https://magnifier-probe.invalid'

export async function securityFixture(path) {
  const zip = await JSZip.loadAsync(await readFile(path))
  for (const name of ['OPS/chapter1.xhtml', 'OPS/chapter2.xhtml']) {
    const chapter = await zip.file(name).async('string')
    // These survive publication sanitization, but are constrained by its CSP.
    // Keeping them in body reproduces the former importNode(body) escape.
    const probes = `
      <style>
        @import url('${probeOrigin}/import.css');
        #magnifier-host-sentinel { color: rgb(255, 0, 0) !important; }
        body { font-family: MagnifierHostProbe, serif; }
        .resource-probe {
          background-image: url('${probeOrigin}/computed-background.png');
          border-image-source: url('${probeOrigin}/border.png');
          cursor: url('${probeOrigin}/cursor.png'), auto;
          list-style-image: url('${probeOrigin}/list.png');
        }
        .resource-probe::before { content: url('${probeOrigin}/pseudo.png'); }
      </style>
      <link rel="stylesheet" href="${probeOrigin}/linked.css" />
      <div class="resource-probe" style="position:absolute;bottom:0;width:2px;height:2px">
        <img src="${probeOrigin}/image.png" srcset="${probeOrigin}/srcset.png 1x" />
        <svg xmlns="http://www.w3.org/2000/svg"><image href="${probeOrigin}/svg.png" /></svg>
        <img src="images/chapter.png" style="width:2px;height:2px" />
      </div>`
    zip.file(name, chapter.replace('</body>', `${probes}</body>`))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

export async function monitorMagnifierSecurity(page, result) {
  result.probeRequests = []
  // No actual connection to an external service, even in the negative control.
  await page.route(`${probeOrigin}/**`, async (route) => {
    result.probeRequests.push(route.request().url())
    await route.abort()
  })
  await page.addStyleTag({
    content: `@font-face { font-family: MagnifierHostProbe; src: url('${probeOrigin}/host-font.woff2'); }
      #magnifier-host-sentinel { color: rgb(0, 0, 0); }`
  })
  await page.evaluate(() => {
    const sentinel = document.createElement('span')
    sentinel.id = 'magnifier-host-sentinel'
    sentinel.textContent = 'Host style sentinel'
    document.body.append(sentinel)
    window.__magnifierStyleLeaks = []
    window.__magnifierPixelCopies = 0
    const observer = new MutationObserver(() => {
      const color = getComputedStyle(sentinel).color
      if (color !== 'rgb(0, 0, 0)') window.__magnifierStyleLeaks.push(color)
      for (const wrapper of document.querySelectorAll('[aria-hidden="true"]')) {
        window.__magnifierPixelCopies +=
          wrapper.shadowRoot?.querySelectorAll('canvas').length ?? 0
      }
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  })
}

export async function assertMagnifierSecurity(page, result, phase) {
  const state = await page.evaluate(() => {
    const doc = document
      .querySelector('foliate-view')
      .renderer.getContents()[0].doc
    return {
      color: getComputedStyle(
        document.getElementById('magnifier-host-sentinel')
      ).color,
      leaks: window.__magnifierStyleLeaks,
      pixelCopies: window.__magnifierPixelCopies,
      publicationCsp: doc.querySelector(
        'meta[http-equiv="Content-Security-Policy"]'
      )?.content,
      publicationStyle: [...doc.querySelectorAll('body style')].some((style) =>
        style.textContent.includes('#magnifier-host-sentinel')
      ),
      publicationImage: !!doc.querySelector(
        'img[src^="https://magnifier-probe.invalid"]'
      ),
      computedBackground: doc.defaultView.getComputedStyle(
        doc.querySelector('.resource-probe')
      ).backgroundImage
    }
  })
  assert(state.publicationCsp.includes("frame-src 'none'"))
  assert(
    state.publicationStyle && state.publicationImage,
    'real attack fixture must survive sanitization'
  )
  assert(state.computedBackground.includes('computed-background.png'))
  assert.equal(state.color, 'rgb(0, 0, 0)', `${phase}: host CSS escaped`)
  assert.deepEqual(state.leaks, [], `${phase}: transient host CSS escape`)
  assert.deepEqual(
    result.probeRequests,
    [],
    `${phase}: resource request escaped`
  )
  if (phase !== 'before magnifier')
    assert(
      state.pixelCopies > 0,
      'decoded local images must remain available as pixels'
    )
  result.checks.push(
    `${phase}: host CSS unchanged (including transient insertions), zero probe requests; publication CSP unchanged`
  )
}
