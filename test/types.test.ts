import { describe, expect, it } from 'vitest'

import type {
  ReaderLinkedSelectionRange,
  ReaderProps,
  ReaderSelectionRange
} from '../src'

type AssertFalse<Value extends false> = Value

type LegacySelectionRangeFixture = {
  readonly id: string
  readonly text: string
  readonly start: number
  readonly end: number
  readonly createdAt: number
  readonly rects: readonly [
    {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  ]
}

type LegacyRangeAssignableToReaderRange =
  LegacySelectionRangeFixture extends ReaderSelectionRange ? true : false

const legacyRangeRejected: AssertFalse<LegacyRangeAssignableToReaderRange> = false

const linkedRange = {
  id: 'r1',
  text: 't',
  start: { selectionId: 'page-2', offset: 0 },
  end: { selectionId: 'page-2', offset: 5 },
  createdAt: 1,
  rectsBySelectionId: {
    'page-2': [{ x: 1, y: 2, width: 3, height: 4 }]
  }
} satisfies ReaderSelectionRange

const linkedRangeAlias: ReaderLinkedSelectionRange = linkedRange

/**
 * RED 合约测试：ReaderProps 不再接受 renderMode 属性。
 * 若生产代码仍导出 renderMode，此条件类型解析为 true，
 * AssertFalse<true> 将触发 TS 编译错误。
 */
type RenderModeNotInReaderProps = 'renderMode' extends keyof ReaderProps
  ? true
  : false
const _renderModeRejected: AssertFalse<RenderModeNotInReaderProps> = false

describe('Reader public selection types', () => {
  it('accepts linked ranges keyed by public page selection ids', () => {
    expect(legacyRangeRejected).toBe(false)
    expect(linkedRangeAlias.start.selectionId).toBe('page-2')
    expect(linkedRangeAlias.end.selectionId).toBe('page-2')
    expect(linkedRangeAlias.rectsBySelectionId['page-2']).toEqual([
      { x: 1, y: 2, width: 3, height: 4 }
    ])
  })

  /**
   * RED 合约测试（运行时辅助）：确认 ReaderProps 类型不包含 renderMode。
   * 若类型层面已通过编译（说明 renderMode 已从 ReaderProps 移除），
   * 则此运行时断言作为二次保障；若 TS 编译失败，测试不会执行到此处。
   */
  it('ReaderProps type rejects renderMode property', () => {
    // 编译通过即证明 renderMode 已从 ReaderProps 移除；
    // 此处仅做运行时占位断言。
    expect(_renderModeRejected).toBe(false)
  })
})
