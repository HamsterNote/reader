import baselines from '../fixtures/native-pdf/v5-host-baselines.json'
// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDocument } from '../../src/pdf/pdfjsRuntime'
import { buildCanonicalPageText } from '../../src/pdf/pdfTextMapping'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../../src/host/readerSnapshot'
import manifest from '../fixtures/native-pdf/hashes.json'
const root = resolve(__dirname, '../..')
const bytes = (p: string) => new Uint8Array(readFileSync(resolve(root, p)))
describe('native PDF fixed baseline', () => {
  it('pins generated V5 host snapshots to matching legacy blob hashes', () => {
    for (const [key, baseline] of Object.entries(baselines)) {
      const path = `test/compat/fixtures/highlights/pdf-two-column.${key}.json`
      expect(createHash('sha256').update(bytes(path)).digest('hex')).toBe(
        baseline.sourceSha256
      )
      expect(
        serializeReaderSnapshot(
          restoreReaderSnapshot(baseline.hostSnapshot.data)
        )
      ).toEqual(baseline.hostSnapshot.data)
    }
  })
  it('pins existing documents and old blobs by SHA256', () => {
    for (const [path, expected] of Object.entries(manifest))
      expect({
        bytes: bytes(path).length,
        sha256: createHash('sha256').update(bytes(path)).digest('hex')
      }).toEqual(expected)
  })
  it.each([2, 3, 4])(
    'migrates matching v%s into a V5 host envelope without changing endpoints',
    (version) => {
      const raw = readFileSync(
        resolve(
          root,
          `test/compat/fixtures/highlights/pdf-two-column.v${version}.json`
        ),
        'utf8'
      )
      const input = JSON.parse(raw)
      const snapshot = restoreReaderSnapshot({
        highlights: input,
        readerData: { hiddenPages: [2], futureOptional: { android: true } },
        futureEnvelope: 'kept'
      })
      const v5 = serializeReaderSnapshot(snapshot)
      expect(v5).not.toHaveProperty('highlights')
      expect(v5.annotations).toMatchObject({
        version: 5,
        ranges: input.ranges.map((r: unknown) => r)
      })
      expect(v5.readerData).toMatchObject({ futureOptional: { android: true } })
      expect(v5.futureEnvelope).toBe('kept')
      expect(serializeReaderSnapshot(restoreReaderSnapshot(v5))).toEqual(v5)
      expect(
        readFileSync(
          resolve(
            root,
            `test/compat/fixtures/highlights/pdf-two-column.v${version}.json`
          ),
          'utf8'
        )
      ).toBe(raw)
    }
  )
  it('canonical offsets include positioned whitespace and never use native text order', async () => {
    const task = getDocument({
      data: bytes('test/fixtures/pdf/positioned-runs.pdf'),
      isEvalSupported: false
    })
    try {
      const pdf = await task.promise
      const p = await pdf.getPage(1)
      const text = await p.getTextContent()
      const canonical = buildCanonicalPageText(
        1,
        text.items.filter((i): i is typeof i & { str: string } => 'str' in i)
      )
      expect(canonical.text.slice(38, 51)).toBe('mno pqr stu v')
    } finally {
      await task.destroy()
    }
  })
  it('has an actual raster-only scan and a two-hundred-page document', async () => {
    for (const [path, count] of [
      ['scan.pdf', 1],
      ['two-hundred-pages.pdf', 200]
    ] as const) {
      const task = getDocument({
        data: bytes(`test/fixtures/native-pdf/${path}`),
        isEvalSupported: false
      })
      try {
        const pdf = await task.promise
        expect(pdf.numPages).toBe(count)
        const p = await pdf.getPage(count)
        const content = await p.getTextContent()
        if (count === 1) expect(content.items).toHaveLength(0)
        else
          expect(
            content.items.some((i) => 'str' in i && i.str.includes('Page 200'))
          ).toBe(true)
      } finally {
        await task.destroy()
      }
    }
    const bad = getDocument({
      data: bytes('test/fixtures/native-pdf/corrupt.pdf'),
      isEvalSupported: false
    })
    try {
      await expect(bad.promise).rejects.toThrow()
    } finally {
      await bad.destroy()
    }
  })
})
