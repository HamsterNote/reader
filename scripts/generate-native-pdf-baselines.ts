import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  restoreReaderSnapshot,
  serializeReaderSnapshot
} from '../src/host/readerSnapshot'
const snapshots: Record<string, unknown> = {}
for (const version of [2, 3, 4]) {
  const path = `test/compat/fixtures/highlights/pdf-two-column.v${version}.json`
  const bytes = readFileSync(path)
  const source = JSON.parse(bytes.toString())
  snapshots[`v${version}`] = {
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    hostSnapshot: {
      revision: 7,
      progress: null,
      data: serializeReaderSnapshot(
        restoreReaderSnapshot({
          highlights: source,
          readerData: {
            hiddenPages: [],
            renderMode: 'layout',
            futureOptional: { platformHint: 'future' }
          },
          comments: [],
          futureEnvelope: { preserved: true }
        })
      )
    }
  }
}
writeFileSync(
  'test/fixtures/native-pdf/v5-host-baselines.json',
  JSON.stringify(snapshots, null, 2) + '\n'
)
console.log('Generated 3 V5 host baselines from immutable v2/v3/v4 blobs')
