// @vitest-environment node
//
// 同文件 v2/v3/v4 高亮 JSON 的旧读入器兼容：
// - 三个版本全部可读，ranges 逐字段保留（id/text/端点/createdAt/单位/样式/rects）。
// - v2 不含 rects/paintings，读取后按既有兼容规则补默认 []/{}。
// - v4 写入入口已删除，旧样本只作为只读输入；升级由 V5 存储层与画库迁移承担。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseHighlights } from '../../demo/highlightStorage'

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
        'keeps v%i ranges/rects/paintings readable without a v4 write step',
        (version) => {
          const raw = [undefined, undefined, v2Raw, v3Raw, v4Raw][version]
          if (!raw) throw new Error('missing fixture')
          const parsed = parseHighlights(raw)

          // 写入端已删除：只断言旧样本仍可读，且重复读取幂等。
          expect(parseHighlights(raw)).toEqual(parsed)
        }
      )

      it('reads v2/v3 with the same ranges as the v4 fixture', () => {
        // 同文件升级契约：v2/v3 的 ranges 与 v4 样本逐字段一致，
        // 缺失的 rects/paintings 按兼容规则补默认，不凭空生成或丢弃标注。
        const v4Parsed = parseHighlights(v4Raw)

        const v2Parsed = parseHighlights(v2Raw)
        expect(v2Parsed.ranges).toEqual(v4Parsed.ranges)
        expect(v2Parsed.rects).toEqual([])
        expect(v2Parsed.paintings).toEqual({})

        const v3Parsed = parseHighlights(v3Raw)
        expect(v3Parsed.ranges).toEqual(v4Parsed.ranges)
        expect(v3Parsed.rects).toEqual(v4Parsed.rects)
        expect(v3Parsed.paintings).toEqual({})
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
