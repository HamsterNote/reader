import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  HIGHLIGHT_DEBUG_STORAGE_KEY,
  traceHighlight
} from '../src/components/IntermediateDocumentViewer/highlightDebug'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('highlight debug trace', () => {
  it('stays silent until the browser debug flag is enabled', () => {
    // Given: 默认浏览器环境没有高亮调试开关。
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    // When: Viewer 尝试记录一次模式切换。
    traceHighlight('mode.render', { mode: 'text', isEpub: true })

    // Then: library 默认不污染宿主控制台。
    expect(info).not.toHaveBeenCalled()
  })

  it('prints enabled traces at a console level visible by default', () => {
    // Given: 开发者通过 localStorage 显式开启高亮 trace。
    localStorage.setItem(HIGHLIGHT_DEBUG_STORAGE_KEY, '1')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    // When: Viewer 记录一次 EPUB Layout 派生决策。
    traceHighlight('layout.geometry', {
      mode: 'layout',
      isEpub: true,
      ranges: [{ id: 'range-1', rectCount: 2 }]
    })

    // Then: 输出稳定事件名和可展开的结构化字段。
    expect(info).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith('[hamster-reader:highlight]', {
      event: 'layout.geometry',
      mode: 'layout',
      isEpub: true,
      ranges: [{ id: 'range-1', rectCount: 2 }]
    })
  })
})
