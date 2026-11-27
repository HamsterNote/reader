import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { PdfOutline } from '../../src/pdf/PdfOutline'

const pageHeads: Record<number, string> = {
  3: '书名页',
  7: '作者序言',
  8: '目 录\n引言 自由或死亡\n第一章 揭开网络引战的面纱',
  12: '引言 自由或死亡\n我听说过关于这个网站的一些谣言。',
  22: '第一章 揭开网络引战的面纱\n在生命之树的顶端没有爱，只有幸灾乐祸。',
  25: '匿名回复： 哈哈哈哈她把脸书账号删了。',
  52: '第二章 独行者\n我第一次见到保罗是在英格兰北部一座小城。',
  74: '第三章 潜入“高尔特峡谷”\n赛博朋克将致力于打造匿名系统。',
  106: '第四章 三次点击\nTor 的隐匿服务网站很难进入浏览器。',
  127: '第五章 在路上\n互联网改变了商务交易的模式。',
  153: '第六章 灯光、网络摄像头，行动起来\n我在街对面认出了韦克斯。',
  178: '第七章 维特效应\n“耶！欢迎加入小组，你会喜欢这里的！”',
  203: '结语 科技乐观主义与悲观主义之\n争\n技术的转型像把双刃剑。',
  221: '尾注\n《暗网》一书参考了大量的网络信息来源。',
  225: '第一章 揭开网络引战的面纱\n“一场生活的灾难……”',
  290: '致谢\n首先，我要感谢所有人。'
}

function makeDarkWebDocument() {
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: async () => ({
      items: [{ str: pageHeads[pageNumber] ?? '正文内容' }]
    })
  }))
  const getOutline = vi.fn().mockResolvedValue([
    { title: '书名页', dest: [2], items: [] },
    { title: '版权页', dest: [2], items: [] },
    { title: '目录', dest: [7], items: [] },
    { title: '作者序言', dest: [6], items: [] },
    { title: '引言 自由或死亡', dest: [11], items: [] },
    { title: '第一章 揭开网络引战的面纱', dest: [15], items: [] },
    { title: '第二章 独行者', dest: [18], items: [] },
    { title: '第三章 潜入“高尔特峡谷”', dest: [21], items: [] },
    { title: '第四章 三次点击', dest: [24], items: [] },
    { title: '第五章 在路上', dest: [28], items: [] },
    { title: '第六章 灯光、网络摄像头，行动起来', dest: [33], items: [] },
    { title: '第七章 维特效应', dest: [36], items: [] },
    { title: '结语 科技乐观主义与悲观主义之争', dest: [40], items: [] },
    { title: '尾注', dest: [44], items: [] },
    { title: '延伸阅读', dest: [47], items: [] },
    { title: '致谢', dest: [51], items: [] }
  ])
  const document = {
    numPages: 294,
    getOutline,
    getDestination: vi.fn().mockResolvedValue(null),
    getPageIndex: vi.fn(async (ref: { num: number }) => ref.num - 1),
    getPage
  } as unknown as PDFDocumentProxy
  return { document, getPage }
}

const pageNumbers = Array.from({ length: 294 }, (_, index) => index + 1)

function renderOutline(
  document: PDFDocumentProxy,
  currentPageNumber: number,
  onNavigate = vi.fn()
) {
  return render(
    <PdfOutline
      document={document}
      isActive
      currentPageNumber={currentPageNumber}
      pageNumbers={pageNumbers}
      onNavigate={onNavigate}
    />
  )
}

describe('PdfOutline with a forward-offset PDF outline', () => {
  it('cold click goes to the real chapter page and highlights it', async () => {
    const { document } = makeDarkWebDocument()
    const onNavigate = vi.fn()
    const view = renderOutline(document, 1, onNavigate)
    const chapter = await screen.findByRole('button', {
      name: '第一章 揭开网络引战的面纱'
    })

    fireEvent.click(chapter)
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith(22))
    expect(onNavigate).not.toHaveBeenCalledWith(16)

    view.rerender(
      <PdfOutline
        document={document}
        isActive
        currentPageNumber={22}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    )
    await waitFor(() => expect(chapter).toHaveAttribute('data-active', 'true'))
  })

  it('highlights the chapter that actually contains the current page', async () => {
    const { document } = makeDarkWebDocument()
    const view = renderOutline(document, 25)
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: '第一章 揭开网络引战的面纱'
        })
      ).toHaveAttribute('data-active', 'true')
    )

    for (const [page, title] of [
      [60, '第二章 独行者'],
      [80, '第三章 潜入“高尔特峡谷”'],
      [180, '第七章 维特效应'],
      [225, '尾注']
    ] as const) {
      view.rerender(
        <PdfOutline
          document={document}
          isActive
          currentPageNumber={page}
          pageNumbers={pageNumbers}
          onNavigate={vi.fn()}
        />
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: title })).toHaveAttribute(
          'data-active',
          'true'
        )
      )
    }

    expect(
      screen.getByRole('button', {
        name: '第一章 揭开网络引战的面纱'
      })
    ).not.toHaveAttribute('data-active')
  })

  it('keeps highlighting correct when landing exactly on chapter pages', async () => {
    const { document } = makeDarkWebDocument()
    const view = renderOutline(document, 22)
    for (const [page, title] of [
      [22, '第一章 揭开网络引战的面纱'],
      [52, '第二章 独行者'],
      [74, '第三章 潜入“高尔特峡谷”'],
      [178, '第七章 维特效应']
    ] as const) {
      view.rerender(
        <PdfOutline
          document={document}
          isActive
          currentPageNumber={page}
          pageNumbers={pageNumbers}
          onNavigate={vi.fn()}
        />
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: title })).toHaveAttribute(
          'data-active',
          'true'
        )
      )
    }
  })

  it('does not treat the repeated chapter title inside the endnotes as a chapter start', async () => {
    const { document } = makeDarkWebDocument()
    renderOutline(document, 225)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '尾注' })).toHaveAttribute(
        'data-active',
        'true'
      )
    )
    expect(
      screen.getByRole('button', {
        name: '第一章 揭开网络引战的面纱'
      })
    ).not.toHaveAttribute('data-active')
  })
})
