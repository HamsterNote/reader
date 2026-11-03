import { describe, it, expect } from 'vitest'
import { buttonOnlyInput } from '../src/components/reading/buttonOnlyInput'

describe('shared button-only input', () => {
  it('blocks paper input, exempts controls and independent panels, and cleans up', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<span>paper</span><button>next</button><input/><aside role="complementary">sidebar</aside>'
    document.body.append(root)
    const remove = buttonOnlyInput(
      root,
      (event) => !(event.target as Element).closest('[role="complementary"]')
    )
    const send = (target: Element, type: string, key?: string) => {
      const event =
        type === 'keydown'
          ? new KeyboardEvent(type, { key, bubbles: true, cancelable: true })
          : new Event(type, { bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(send(root.firstElementChild!, 'wheel')).toBe(true)
    expect(send(root, 'touchmove')).toBe(true)
    expect(send(root, 'keydown', 'PageDown')).toBe(true)
    expect(send(root.querySelector('button')!, 'keydown', ' ')).toBe(false)
    expect(send(root.querySelector('input')!, 'keydown', 'ArrowDown')).toBe(
      false
    )
    expect(send(root.querySelector('aside')!, 'wheel')).toBe(false)
    expect(send(root, 'pointerdown')).toBe(false)
    remove()
    expect(send(root, 'wheel')).toBe(false)
    expect(send(root, 'keydown', 'PageDown')).toBe(false)
    root.remove()
  })
})
