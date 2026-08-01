import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { act } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Reader } from '../src'

const readerDocument = {
  id: 'hydration-document',
  title: 'Hydrated document',
  pages: [
    {
      id: 'hydration-page-1',
      number: 1,
      width: 100,
      height: 150,
      content: []
    }
  ]
} satisfies IntermediateDocumentSerialized

describe('Reader hydration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('hydrates a populated desktop Reader without regenerating the toolbar', async () => {
    // Given: 服务端输出固定首屏，客户端则是宽屏浅色环境。
    const browserWindow = window
    vi.stubGlobal('window', undefined)
    const html = renderToString(<Reader document={readerDocument} />)
    vi.stubGlobal('window', browserWindow)
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024
    })
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)
    const recoverableErrors: unknown[] = []

    // When: React 在浏览器状态与服务端默认值不同的情况下 hydration。
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, <Reader document={readerDocument} />, {
        onRecoverableError: (error) => recoverableErrors.push(error)
      })
    })

    // Then: 首次 hydration 完全匹配，effect 随后切换为桌面工具栏。
    expect(recoverableErrors).toEqual([])
    expect(
      container.querySelector('[data-testid="tool-bottom-bar-tool-menu"]')
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="tool-bottom-bar-text-selection"]')
    ).not.toBeNull()

    await act(async () => root?.unmount())
  })
})
