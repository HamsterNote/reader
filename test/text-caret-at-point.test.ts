import { afterEach, expect, it, vi } from 'vitest'
import { textCaretAtPoint } from '../src/components/selection/textCaretAtPoint'

afterEach(() => vi.restoreAllMocks())

it.each(['position', 'range', 'empty', 'throw'] as const)(
  'queries beneath menu children and restores inline priorities (%s)',
  (result) => {
    const root = document.createElement('div')
    root.innerHTML = `
      <p>PDF text</p>
      <div class="hamster-reader__engine-popover hsn-selection-popover" style="pointer-events:auto!important">
        <button style="pointer-events:auto!important">Highlight</button>
        <span>Menu text</span>
      </div>
      <div class="hsn-selection-popover"><button>Other menu</button></div>
      <button class="hamster-reader__engine-handle" style="pointer-events:all">Handle</button>`
    document.body.append(root)
    const controls = Array.from(
      root.querySelectorAll<HTMLElement>('div, button, span')
    )
    const previous = controls.map((el) => el.style.cssText)
    const setters = controls.map((el) => vi.spyOn(el.style, 'setProperty'))
    const node = root.querySelector('p')!.firstChild!
    const caret = document.createRange()
    caret.setStart(node, 3)
    caret.collapse(true)
    const check = () => {
      controls.forEach((el, index) => {
        expect(el.style.pointerEvents).toBe('none')
        // JSDOM drops pointer-events priority; the browser regression checks it.
        expect(setters[index]).toHaveBeenCalledWith(
          'pointer-events',
          'none',
          'important'
        )
      })
    }
    const positionQuery = vi.fn(() => {
      check()
      if (result === 'throw') throw new Error('query failed')
      return result === 'position' ? { offsetNode: node, offset: 3 } : null
    })
    const rangeQuery = vi.fn(() => {
      check()
      return result === 'range' ? caret : null
    })
    const positionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint'
    )
    const rangeDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretRangeFromPoint'
    )
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: positionQuery
    })
    Object.defineProperty(document, 'caretRangeFromPoint', {
      configurable: true,
      value: rangeQuery
    })
    try {
      if (result === 'throw')
        expect(() => textCaretAtPoint(document, 40, 120)).toThrow(
          'query failed'
        )
      else {
        const actual = textCaretAtPoint(document, 40, 120)
        if (result === 'empty') expect(actual).toBeNull()
        else {
          expect(actual?.startContainer).toBe(node)
          expect(actual?.startOffset).toBe(3)
        }
      }
      expect(controls.map((el) => el.style.cssText)).toEqual(previous)
    } finally {
      if (positionDescriptor)
        Object.defineProperty(
          document,
          'caretPositionFromPoint',
          positionDescriptor
        )
      else Reflect.deleteProperty(document, 'caretPositionFromPoint')
      if (rangeDescriptor)
        Object.defineProperty(document, 'caretRangeFromPoint', rangeDescriptor)
      else Reflect.deleteProperty(document, 'caretRangeFromPoint')
      root.remove()
    }
  }
)
