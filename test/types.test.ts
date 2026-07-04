import { describe, expect, it } from 'vitest'

import type {
  ReaderLinkedSelectionRange,
  ReaderProps,
  ReaderRenderMode,
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
 * GREEN 合约测试（T2 text-render-mode）：ReaderProps 现在重新接受 renderMode 属性，
 * 类型为 ReaderRenderMode ('layout' | 'text')。
 * 历史 commit bb8cd89 曾移除旧版 render modes 并用 RED 测试锁定移除；
 * T2 以新的 'layout' | 'text' 设计重新引入，此测试随之翻转为 GREEN。
 */
type RenderModeInReaderProps = 'renderMode' extends keyof ReaderProps
  ? true
  : false
const _renderModeAccepted: RenderModeInReaderProps = true

const _renderModeValue: ReaderRenderMode = 'layout'
const _readerPropsRenderMode: ReaderProps['renderMode'] = _renderModeValue

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
   * GREEN 合约测试（运行时辅助，T2 text-render-mode）：确认 ReaderProps 类型
   * 已重新接受 renderMode 属性且类型为 ReaderRenderMode。编译通过即证明契约成立。
   */
  it('ReaderProps type accepts renderMode as ReaderRenderMode', () => {
    expect(_renderModeAccepted).toBe(true)
    expect(_readerPropsRenderMode).toBe('layout')
  })
})
