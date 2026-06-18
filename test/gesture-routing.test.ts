/**
 * gestureRouting.ts 单元测试。
 *
 * 覆盖完整路由表：default / stylus 两种模式 × mouse / touch / pen 三种指针。
 */

import { describe, expect, it } from 'vitest'

import type { ReaderInteractionMode } from '../src/components/IntermediateDocumentViewer'
import {
  isBlankClick,
  shouldArmLongPress,
  shouldForceBlockSelection,
  shouldStartSelectionOnPointerDown,
  toReaderPointerType
} from '../src/components/gestureRouting'

// ── toReaderPointerType ──────────────────────────────────────────────

describe('toReaderPointerType', () => {
  it('归一化已知 pointerType', () => {
    expect(toReaderPointerType('mouse')).toBe('mouse')
    expect(toReaderPointerType('touch')).toBe('touch')
    expect(toReaderPointerType('pen')).toBe('pen')
  })

  it('未知值返回 unknown', () => {
    expect(toReaderPointerType('')).toBe('unknown')
    expect(toReaderPointerType(undefined)).toBe('unknown')
    expect(toReaderPointerType('stylus')).toBe('unknown')
  })
})

// ── shouldStartSelectionOnPointerDown ────────────────────────────────

describe('shouldStartSelectionOnPointerDown', () => {
  const modes: ReaderInteractionMode[] = ['default', 'stylus']

  it('落点不在文本上时一律 false', () => {
    for (const mode of modes) {
      expect(
        shouldStartSelectionOnPointerDown({
          interactionMode: mode,
          pointerType: 'mouse',
          isOnText: false
        })
      ).toBe(false)
    }
  })

  it('default 模式：鼠标和手写笔在文本上立即选择', () => {
    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'default',
        pointerType: 'mouse',
        isOnText: true
      })
    ).toBe(true)

    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'default',
        pointerType: 'pen',
        isOnText: true
      })
    ).toBe(true)

    // 触摸走长按路径，不立即选择
    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'default',
        pointerType: 'touch',
        isOnText: true
      })
    ).toBe(false)
  })

  it('stylus 模式：仅手写笔在文本上选择', () => {
    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'stylus',
        pointerType: 'pen',
        isOnText: true
      })
    ).toBe(true)

    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'stylus',
        pointerType: 'mouse',
        isOnText: true
      })
    ).toBe(false)

    expect(
      shouldStartSelectionOnPointerDown({
        interactionMode: 'stylus',
        pointerType: 'touch',
        isOnText: true
      })
    ).toBe(false)
  })
})

// ── shouldArmLongPress ───────────────────────────────────────────────

describe('shouldArmLongPress', () => {
  it('default 模式下触摸启用手长按', () => {
    expect(
      shouldArmLongPress({ interactionMode: 'default', pointerType: 'touch' })
    ).toBe(true)
  })

  it('default 模式下鼠标/手写笔不启用手长按', () => {
    expect(
      shouldArmLongPress({ interactionMode: 'default', pointerType: 'mouse' })
    ).toBe(false)
    expect(
      shouldArmLongPress({ interactionMode: 'default', pointerType: 'pen' })
    ).toBe(false)
  })

  it('stylus 模式下任何指针都不启用手长按', () => {
    expect(
      shouldArmLongPress({ interactionMode: 'stylus', pointerType: 'touch' })
    ).toBe(false)
    expect(
      shouldArmLongPress({ interactionMode: 'stylus', pointerType: 'mouse' })
    ).toBe(false)
    expect(
      shouldArmLongPress({ interactionMode: 'stylus', pointerType: 'pen' })
    ).toBe(false)
  })
})

// ── isBlankClick ─────────────────────────────────────────────────────

describe('isBlankClick', () => {
  it('不在文本上为空白点击', () => {
    expect(isBlankClick({ isOnText: false })).toBe(true)
  })

  it('在文本上不是空白点击', () => {
    expect(isBlankClick({ isOnText: true })).toBe(false)
  })
})

// ── shouldForceBlockSelection ────────────────────────────────────────

describe('shouldForceBlockSelection', () => {
  it('stylus 模式下阻止非手写笔的选择', () => {
    expect(shouldForceBlockSelection('stylus', 'mouse')).toBe(true)
    expect(shouldForceBlockSelection('stylus', 'touch')).toBe(true)
    expect(shouldForceBlockSelection('stylus', 'pen')).toBe(false)
  })

  it('default 模式下不阻止任何选择', () => {
    expect(shouldForceBlockSelection('default', 'mouse')).toBe(false)
    expect(shouldForceBlockSelection('default', 'touch')).toBe(false)
    expect(shouldForceBlockSelection('default', 'pen')).toBe(false)
  })
})
