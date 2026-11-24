import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EpubOutline } from '../src/components/EpubOutline'
import type { OutlineTreeNode } from '../src/components/OutlineTree'
import {
  findActiveOutlineNodeId,
  OutlineTree
} from '../src/components/OutlineTree'
import type { EpubEngineTocEntry } from '../src/epub/foliateEpubEngine'

const themeColor = 'var(--hamster-reader-theme-color, #2563eb)'

const threeLevels: readonly OutlineTreeNode[] = [
  {
    id: '0',
    label: '第一章',
    targetPage: 1,
    disabled: false,
    children: [
      {
        id: '0.0',
        label: '第一节',
        targetPage: 2,
        disabled: false,
        children: [
          {
            id: '0.0.0',
            label: '小节',
            targetPage: 3,
            disabled: false,
            children: []
          }
        ]
      }
    ]
  },
  { id: '1', label: '第二章', targetPage: 5, disabled: false, children: [] }
]

function indentationOf(label: string) {
  return screen
    .getByRole('button', { name: label })
    .closest('[data-outline-depth]')
    ?.getAttribute('style')
}

describe('findActiveOutlineNodeId', () => {
  it('picks the deepest item whose target page has been reached', () => {
    expect(findActiveOutlineNodeId(threeLevels, 0)).toBeNull()
    expect(findActiveOutlineNodeId(threeLevels, 1)).toBe('0')
    expect(findActiveOutlineNodeId(threeLevels, 2)).toBe('0.0')
    expect(findActiveOutlineNodeId(threeLevels, 3)).toBe('0.0.0')
    expect(findActiveOutlineNodeId(threeLevels, 4)).toBe('0.0.0')
    expect(findActiveOutlineNodeId(threeLevels, 5)).toBe('1')
    expect(findActiveOutlineNodeId(threeLevels, null)).toBeNull()
  })

  it('prefers the deeper item when a parent and child share a target page', () => {
    const shared: readonly OutlineTreeNode[] = [
      {
        id: 'parent',
        label: 'Parent',
        targetPage: 4,
        disabled: false,
        children: [
          {
            id: 'child',
            label: 'Child',
            targetPage: 4,
            disabled: false,
            children: []
          }
        ]
      }
    ]
    expect(findActiveOutlineNodeId(shared, 4)).toBe('child')
  })

  it('only considers targets on currently visible pages', () => {
    const pages: readonly OutlineTreeNode[] = [
      {
        id: 'hidden',
        label: 'Hidden',
        targetPage: 4,
        disabled: false,
        children: []
      },
      {
        id: 'visible',
        label: 'Visible',
        targetPage: 5,
        disabled: false,
        children: []
      }
    ]

    expect(findActiveOutlineNodeId(pages, 5)).toBe('visible')
    expect(findActiveOutlineNodeId(pages, 5, [1, 5])).toBe('visible')
    expect(findActiveOutlineNodeId(pages, 5, [1, 4])).toBe('hidden')
    expect(findActiveOutlineNodeId(pages, 3, [1, 2, 3])).toBeNull()
    expect(findActiveOutlineNodeId(pages, 5, [1, 2, 3])).toBeNull()
  })
})

describe('OutlineTree', () => {
  it('indents one em per level, with level one flush left', () => {
    render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        onNavigate={vi.fn()}
      />
    )

    expect(indentationOf('第一章')).toContain('padding-left: 0em')
    expect(indentationOf('第一节')).toContain('padding-left: 1em')
    expect(indentationOf('小节')).toContain('padding-left: 2em')
  })

  it('shows every level by default and only marks the current item with the theme color', () => {
    const { rerender } = render(
      <OutlineTree items={threeLevels} currentPage={0} onNavigate={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: '第一章' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第一节' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '小节' })).toBeInTheDocument()
    expect(document.querySelector('[data-active="true"]')).toBeNull()

    rerender(
      <OutlineTree items={threeLevels} currentPage={3} onNavigate={vi.fn()} />
    )
    const active = screen.getByRole('button', { name: '小节' })
    expect(active).toHaveAttribute('data-active', 'true')
    expect(active).toHaveAttribute('aria-current', 'location')
    expect(active.style.color).toBe(themeColor)
    expect(screen.getByRole('button', { name: '第一章' }).style.color).toBe('')
    expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(1)

    rerender(
      <OutlineTree items={threeLevels} currentPage={5} onNavigate={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '第二章' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(screen.getByRole('button', { name: '小节' })).not.toHaveAttribute(
      'data-active'
    )

    rerender(
      <OutlineTree items={threeLevels} currentPage={0} onNavigate={vi.fn()} />
    )
    expect(document.querySelector('[data-active="true"]')).toBeNull()
  })

  it('collapses and restores children without navigating with the toggle', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        onNavigate={onNavigate}
      />
    )

    await user.click(screen.getByRole('button', { name: '收起 第一章' }))
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()
    expect(screen.queryByRole('button', { name: '小节' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开 第一章' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(onNavigate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '展开 第一章' }))
    expect(screen.getByRole('button', { name: '第一节' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '小节' })).toBeInTheDocument()
  })

  it('toggles a focused expand control with Enter and Space', async () => {
    const user = userEvent.setup()
    render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        onNavigate={vi.fn()}
      />
    )

    const toggle = screen.getByRole('button', { name: '收起 第一章' })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: '第一节' })).toBeInTheDocument()
  })

  it('keeps title clicks navigating after collapsing is available', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        onNavigate={onNavigate}
      />
    )

    await user.click(screen.getByRole('button', { name: '第一章' }))
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ id: '0' })
    )
  })

  it('keeps collapse choices when nodes are rebuilt for the same document', async () => {
    const user = userEvent.setup()
    const view = render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        documentKey='doc-a'
        onNavigate={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: '收起 第一章' }))
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    const rebuilt = threeLevels.map((node) => ({ ...node }))
    view.rerender(
      <OutlineTree
        items={rebuilt}
        currentPage={null}
        documentKey='doc-a'
        onNavigate={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    view.rerender(
      <OutlineTree
        items={rebuilt}
        currentPage={3}
        documentKey='doc-a'
        onNavigate={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()
    expect(
      screen.getByRole('button', { name: '展开 第一章' })
    ).toBeInTheDocument()
  })

  it('resets collapse choices only when the document changes', async () => {
    const user = userEvent.setup()
    const view = render(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        documentKey='doc-a'
        onNavigate={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: '收起 第一章' }))
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    view.rerender(
      <OutlineTree
        items={threeLevels}
        currentPage={null}
        documentKey='doc-b'
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '第一节' })).toBeInTheDocument()
  })

  it('marks the nearest visible ancestor while the current item is collapsed', async () => {
    const user = userEvent.setup()
    render(
      <OutlineTree items={threeLevels} currentPage={3} onNavigate={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: '小节' })).toHaveAttribute(
      'data-active',
      'true'
    )

    await user.click(screen.getByRole('button', { name: '收起 第一章' }))
    const ancestor = screen.getByRole('button', { name: '第一章' })
    expect(ancestor).toHaveAttribute('data-active', 'true')
    expect(ancestor).toHaveAttribute('aria-current', 'location')
    expect(
      globalThis.document.querySelectorAll('[data-active="true"]')
    ).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: '展开 第一章' }))
    expect(screen.getByRole('button', { name: '小节' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(screen.getByRole('button', { name: '第一章' })).not.toHaveAttribute(
      'data-active'
    )
  })

  it('ignores highlight candidates on pages that are not currently visible', () => {
    const pages: readonly OutlineTreeNode[] = [
      {
        id: 'visible',
        label: '可见页章节',
        targetPage: 1,
        disabled: false,
        children: []
      },
      {
        id: 'hidden',
        label: '隐藏页章节',
        targetPage: 4,
        disabled: false,
        children: []
      }
    ]
    const view = render(
      <OutlineTree
        items={pages}
        currentPage={5}
        pageNumbers={[1, 5]}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '可见页章节' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(
      screen.getByRole('button', { name: '隐藏页章节' })
    ).not.toHaveAttribute('data-active')

    view.rerender(
      <OutlineTree
        items={pages}
        currentPage={5}
        pageNumbers={[1, 4, 5]}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '隐藏页章节' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(
      screen.getByRole('button', { name: '可见页章节' })
    ).not.toHaveAttribute('data-active')
  })
})

const epubToc: readonly EpubEngineTocEntry[] = [
  {
    label: '第一章',
    href: 'chapter-1.html',
    pageNumber: 1,
    subitems: [
      {
        label: '第一节',
        href: 'chapter-1.html#s1',
        pageNumber: 2,
        subitems: [
          {
            label: '小节',
            href: 'chapter-1.html#s1-1',
            pageNumber: 3,
            subitems: []
          }
        ]
      }
    ]
  },
  { label: '第二章', href: 'chapter-2.html', pageNumber: 5, subitems: [] }
]

describe('EpubOutline', () => {
  it('highlights the section matching the current spine page and navigates by href', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <EpubOutline
        items={epubToc}
        pageNumbers={[1, 2, 3, 5]}
        currentPageNumber={2}
        onNavigate={onNavigate}
      />
    )

    expect(screen.getByRole('button', { name: '第一节' })).toHaveAttribute(
      'data-active',
      'true'
    )
    expect(indentationOf('第一章')).toContain('padding-left: 0em')
    expect(indentationOf('第一节')).toContain('padding-left: 1em')
    expect(indentationOf('小节')).toContain('padding-left: 2em')

    rerender(
      <EpubOutline
        items={epubToc}
        pageNumbers={[1, 2, 3, 5]}
        currentPageNumber={5}
        onNavigate={onNavigate}
      />
    )
    expect(screen.getByRole('button', { name: '第二章' })).toHaveAttribute(
      'data-active',
      'true'
    )

    await user.click(screen.getByRole('button', { name: '第二章' }))
    expect(onNavigate).toHaveBeenCalledWith('chapter-2.html')
  })

  it('keeps collapse choices across page changes and resets for another book', async () => {
    const user = userEvent.setup()
    const view = render(
      <EpubOutline
        items={epubToc}
        pageNumbers={[1, 2, 3, 5]}
        currentPageNumber={2}
        onNavigate={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: '收起 第一章' }))
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    view.rerender(
      <EpubOutline
        items={epubToc}
        pageNumbers={[1, 2, 3, 5]}
        currentPageNumber={5}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: '第一节' })).toBeNull()

    view.rerender(
      <EpubOutline
        items={[
          {
            label: '另一章',
            href: 'other.html',
            pageNumber: 1,
            subitems: [
              {
                label: '另一节',
                href: 'other.html#s1',
                pageNumber: 2,
                subitems: []
              }
            ]
          }
        ]}
        pageNumbers={[1, 2]}
        currentPageNumber={1}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '另一节' })).toBeInTheDocument()
  })

  it('leaves everything unhighlighted before the first outline target', () => {
    render(
      <EpubOutline
        items={epubToc}
        pageNumbers={[1, 2, 3, 5]}
        currentPageNumber={0}
        onNavigate={vi.fn()}
      />
    )
    expect(document.querySelector('[data-active="true"]')).toBeNull()
  })
})
