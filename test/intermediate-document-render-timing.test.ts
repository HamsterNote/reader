import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIntermediateDocumentRenderTiming,
  type IntermediateDocumentRenderTimingCallback,
  type IntermediateDocumentRenderTimingClock,
  type IntermediateDocumentRenderTimingEntry
} from '../src/components/IntermediateDocumentViewer/renderTiming'

describe('createIntermediateDocumentRenderTiming', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleDebugSpy.mockRestore()
  })

  it('reports durationMs, startedAt, endedAt to callback when callback is provided', () => {
    // Given: 可注入时钟，第一次返回 10，第二次返回 35
    const clock: IntermediateDocumentRenderTimingClock = {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35)
    }
    const onTiming: IntermediateDocumentRenderTimingCallback = vi.fn()

    // When: 用 measure 测量一个 stage
    createIntermediateDocumentRenderTiming({ callback: onTiming, clock }).measure(
      'page-content-rendering',
      { pageNumber: 1 },
      () => 'result'
    )

    // Then: callback 收到正确的 timing entry，且 fn 返回值被透传
    expect(onTiming).toHaveBeenCalledTimes(1)
    const entry = (onTiming as ReturnType<typeof vi.fn>).mock.calls[0][0] as IntermediateDocumentRenderTimingEntry
    expect(entry.durationMs).toBe(25)
    expect(entry.startedAt).toBe(10)
    expect(entry.endedAt).toBe(35)
    expect(entry.stage).toBe('page-content-rendering')
    expect(entry.pageNumber).toBe(1)
  })

  it('does not call console.debug when no callback and env flag is disabled', () => {
    // Given: 没有 callback，显式禁用 env
    const clock: IntermediateDocumentRenderTimingClock = { now: () => 10 }

    // When: 测量一个 stage
    createIntermediateDocumentRenderTiming({ clock, envEnabled: false }).measure(
      'page-content-rendering',
      undefined,
      () => {}
    )

    // Then: console.debug 未被调用
    expect(consoleDebugSpy).not.toHaveBeenCalled()
  })

  it('calls console.debug exactly once with stage name when env flag is enabled and no callback', () => {
    // Given: env 启用，没有 callback
    const clock: IntermediateDocumentRenderTimingClock = {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35)
    }

    // When: 测量一个 stage
    createIntermediateDocumentRenderTiming({ clock, envEnabled: true }).measure(
      'page-content-rendering',
      { pageNumber: 1, detail: { foo: 'bar' } },
      () => {}
    )

    // Then: console.debug 被调用一次，entry 包含完整信息
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1)
    const entry = (consoleDebugSpy as ReturnType<typeof vi.fn>).mock.calls[0][1] as IntermediateDocumentRenderTimingEntry
    expect(entry.durationMs).toBe(25)
    expect(entry.stage).toBe('page-content-rendering')
    expect(entry.pageNumber).toBe(1)
    expect(entry.detail).toEqual({ foo: 'bar' })
  })

  it('emits callback and console.debug when both callback and env are enabled', () => {
    const clock: IntermediateDocumentRenderTimingClock = {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(35)
    }
    const onTiming: IntermediateDocumentRenderTimingCallback = vi.fn()

    createIntermediateDocumentRenderTiming({ callback: onTiming, clock, envEnabled: true }).measure(
      'document-resolution',
      undefined,
      () => {}
    )

    expect(onTiming).toHaveBeenCalledTimes(1)
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1)
  })

  it('returns fn result and emits no entry when disabled', () => {
    const clock: IntermediateDocumentRenderTimingClock = { now: () => 10 }
    const onTiming: IntermediateDocumentRenderTimingCallback = vi.fn()

    const result = createIntermediateDocumentRenderTiming({ clock, envEnabled: false }).measure(
      'page-content-rendering',
      undefined,
      () => 'hello'
    )

    expect(result).toBe('hello')
    expect(onTiming).not.toHaveBeenCalled()
    expect(consoleDebugSpy).not.toHaveBeenCalled()
  })

  it('supports start/finish pattern for async or manual timing', () => {
    const clock: IntermediateDocumentRenderTimingClock = {
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(50)
    }
    const onTiming: IntermediateDocumentRenderTimingCallback = vi.fn()
    const timing = createIntermediateDocumentRenderTiming({ callback: onTiming, clock })

    const finish = timing.start('content-extraction', { pageNumber: 2 })
    finish()

    expect(onTiming).toHaveBeenCalledTimes(1)
    const entry = (onTiming as ReturnType<typeof vi.fn>).mock.calls[0][0] as IntermediateDocumentRenderTimingEntry
    expect(entry.durationMs).toBe(40)
    expect(entry.pageNumber).toBe(2)
  })
})
