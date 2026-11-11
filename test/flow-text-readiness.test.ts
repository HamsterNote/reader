import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFlowTextReadiness,
  isClampedFlowTargetVisible
} from '../src/components/reading/flowTextReadiness'

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
afterEach(() => {
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function fixture() {
  const root = document.createElement('div')
  document.body.append(root)
  Object.defineProperties(root, {
    clientWidth: { value: 320 },
    clientHeight: { value: 500 }
  })
  let fontsReady!: () => void
  const fonts = new Promise<void>((resolve) => {
    fontsReady = resolve
  })
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: fonts }
  })
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    if (id != null) frames.delete(id)
  })
  const step = () => {
    const current = [...frames.values()]
    frames.clear()
    current.forEach((callback) => callback(0))
  }
  const state: { loaded: boolean; restoring: boolean; error?: Error } = {
    loaded: false,
    restoring: true
  }
  return {
    root,
    fontsReady,
    state,
    step,
    readiness: createFlowTextReadiness(root, () => state)
  }
}

describe('flow text readiness', () => {
  it('waits for fonts, loaded target and completed position restoration before permitting a flush', async () => {
    const f = fixture()
    const saved = vi.fn()
    const task = f.readiness.waitForStable().then(saved)
    f.state.loaded = true
    f.step()
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    f.fontsReady()
    await Promise.resolve()
    f.step()
    f.step()
    expect(saved).not.toHaveBeenCalled()
    f.state.restoring = false
    f.step()
    expect(saved).not.toHaveBeenCalled()
    f.step()
    await task
    expect(saved).toHaveBeenCalledOnce()
    f.readiness.dispose()
  })

  it('rejects an in-flight flush on disposal instead of acknowledging another document', async () => {
    const f = fixture()
    const task = expect(f.readiness.waitForStable()).rejects.toThrow('disposed')
    f.readiness.dispose()
    await task
    f.fontsReady()
    await expect(f.readiness.waitForStable()).rejects.toThrow('disposed')
  })

  it('reports target load failure without resolving readiness', async () => {
    const f = fixture()
    const task = expect(f.readiness.waitForStable()).rejects.toThrow(
      'page failed'
    )
    f.state.error = new Error('page failed')
    f.fontsReady()
    await Promise.resolve()
    f.step()
    await task
    f.readiness.dispose()
  })
})

describe('clamped flow position restoration', () => {
  it('accepts a fully visible loaded target at the scroll limit, including a document that fits', () => {
    const root = document.createElement('div')
    const target = document.createElement('div')
    target.dataset.pageNumber = '2'
    target.dataset.pageMeasurable = 'true'
    root.append(target)
    Object.defineProperties(root, {
      clientHeight: { value: 500 },
      scrollHeight: { value: 130, configurable: true }
    })
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 500
    } as DOMRect)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 70,
      bottom: 130,
      height: 60
    } as DOMRect)
    expect(isClampedFlowTargetVisible(root, 2)).toBe(true)
    Object.defineProperty(root, 'scrollHeight', { value: 600 })
    expect(isClampedFlowTargetVisible(root, 2)).toBe(false)
    root.scrollTop = 100
    expect(isClampedFlowTargetVisible(root, 2)).toBe(true)
    target.dataset.pageMeasurable = 'false'
    expect(isClampedFlowTargetVisible(root, 2)).toBe(false)
  })
})
