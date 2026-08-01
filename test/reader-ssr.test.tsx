// @vitest-environment node

import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Reader } from '../src'

describe('Reader SSR', () => {
  it('renders a populated document without browser globals', () => {
    // Given: 服务端环境中存在一份至少包含一页的 Reader 文档。
    const document = {
      id: 'ssr-document',
      title: 'Server rendered document',
      pages: [
        {
          id: 'ssr-page-1',
          number: 1,
          width: 100,
          height: 150,
          content: []
        }
      ]
    } satisfies IntermediateDocumentSerialized

    // When: React 在没有 window 和 document 的 Node 环境执行 SSR。
    const html = renderToString(<Reader document={document} />)

    // Then: Reader 输出文档外壳，而不是因访问浏览器全局变量而抛错。
    expect(html).toContain('data-testid="reader-root"')
    expect(html).toContain('data-testid="tool-bottom-bar"')
  })
})
