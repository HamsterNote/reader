// @vitest-environment node
//
// HAM-87 / OpenSpec change migrate-reader-to-expo-webview 共同前置任务 1.1。
// 同文件 v2/v3/v4 高亮 JSON 的旧读入器 round-trip：
// - 三个版本全部可读，ranges 逐字段保留（id/text/端点/createdAt/单位/样式/rects）。
// - v2 不含 rects/paintings，读取后按既有兼容规则补默认 []/{}。
// - 任意版本读取后以 v4 回写，再读取结果与 v4 样本一致（升级幂等）。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseHighlights,
  serializeHighlights
} from '../../demo/highlightStorage'

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'highlights')

function readJsonFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), 'utf8')
}

const families = ['epub-duplicate-text', 'pdf-two-column'] as const

describe('compat fixtures: highlight json v2/v3/v4 round trip', () => {
  for (const family of families) {
    describe(family, () => {
      const v2Raw = readJsonFixture(`${family}.v2.json`)
      const v3Raw = readJsonFixture(`${family}.v3.json`)
      const v4Raw = readJsonFixture(`${family}.v4.json`)

      it('reads v2 with ranges intact and rects/paintings defaulted', () => {
        const parsed = parseHighlights(v2Raw)
        const rawJson = JSON.parse(v2Raw)

        // v2 历史格式只有 ranges；旧读入器不丢任何 range 字段。
        expect(parsed.ranges).toEqual(rawJson.ranges)
        expect(parsed.rects).toEqual([])
        expect(parsed.paintings).toEqual({})
        expect(parsed.ranges.map((range) => range.id)).toEqual([
          rawJson.ranges[0].id,
          rawJson.ranges[1].id
        ])
      })

      it('reads v3 with ranges and rects intact and paintings defaulted', () => {
        const parsed = parseHighlights(v3Raw)
        const rawJson = JSON.parse(v3Raw)

        expect(parsed.ranges).toEqual(rawJson.ranges)
        expect(parsed.rects).toEqual(rawJson.rects)
        expect(parsed.paintings).toEqual({})
      })

      it('reads v4 with ranges, rects and paintings intact', () => {
        const parsed = parseHighlights(v4Raw)
        const rawJson = JSON.parse(v4Raw)

        expect(parsed.ranges).toEqual(rawJson.ranges)
        expect(parsed.rects).toEqual(rawJson.rects)
        expect(parsed.paintings).toEqual(rawJson.paintings)
      })

      it('keeps identical ranges across v2/v3/v4 for the same file', () => {
        // 同文件三个版本表达同一组标注：ranges 必须逐字段一致。
        const v2Ranges = parseHighlights(v2Raw).ranges
        const v3Ranges = parseHighlights(v3Raw).ranges
        const v4Ranges = parseHighlights(v4Raw).ranges
        expect(v3Ranges).toEqual(v2Ranges)
        expect(v4Ranges).toEqual(v2Ranges)
      })

      it.each([2, 3, 4] as const)(
        'round-trips v%i losslessly through the v4 write envelope',
        (version) => {
          const raw = [undefined, undefined, v2Raw, v3Raw, v4Raw][version]
          if (!raw) throw new Error('missing fixture')
          const parsed = parseHighlights(raw)

          // When: 旧读入器读取后以现行 v4 格式回写，再读取。
          const reserialized = serializeHighlights(
            [...parsed.ranges],
            [...parsed.rects],
            parsed.paintings
          )
          const reparsed = parseHighlights(reserialized)

          // Then: 回写包络是 v4；该版本能表达的内容逐字段无损。
          expect(JSON.parse(reserialized).version).toBe(4)
          expect(reparsed.ranges).toEqual(parsed.ranges)
          expect(reparsed.rects).toEqual(parsed.rects)
          expect(reparsed.paintings).toEqual(parsed.paintings)
        }
      )

      it('upgrades v2/v3 to v4 keeping ranges identical to the v4 fixture', () => {
        // 同文件升级契约：v2 升级只补 rects=[]/paintings={} 默认，
        // v3 升级只补 paintings={}；ranges 与 v4 样本逐字段一致，
        // 不凭空生成或丢弃标注。
        const v4Parsed = parseHighlights(v4Raw)

        const v2Upgraded = parseHighlights(
          serializeHighlights(
            [...parseHighlights(v2Raw).ranges],
            [...parseHighlights(v2Raw).rects],
            parseHighlights(v2Raw).paintings
          )
        )
        expect(v2Upgraded.ranges).toEqual(v4Parsed.ranges)
        expect(v2Upgraded.rects).toEqual([])
        expect(v2Upgraded.paintings).toEqual({})

        const v3Parsed = parseHighlights(v3Raw)
        const v3Upgraded = parseHighlights(
          serializeHighlights(
            [...v3Parsed.ranges],
            [...v3Parsed.rects],
            v3Parsed.paintings
          )
        )
        expect(v3Upgraded.ranges).toEqual(v4Parsed.ranges)
        expect(v3Upgraded.rects).toEqual(v4Parsed.rects)
        expect(v3Upgraded.paintings).toEqual({})
      })

      it('preserves px and percent overlay rect units verbatim', () => {
        const parsed = parseHighlights(v4Raw)

        // px/percent 是持久化契约的一部分，读取不得归一化。
        const rangeUnits = parsed.ranges.map((range) => range.overlayRectType)
        expect(rangeUnits).toEqual(['percent', 'px'])
        const rectUnits = parsed.rects.map((rect) => rect.overlayRectType)
        expect(rectUnits).toEqual(['px', 'percent'])
      })
    })
  }
})
