import { useMemo } from 'react'
import type { EpubEngineTocEntry } from '../epub/foliateEpubEngine'
import type { OutlineTreeNode } from './OutlineTree'
import { OutlineTree } from './OutlineTree'

function toOutlineNodes(
  items: readonly EpubEngineTocEntry[],
  pageNumbers: readonly number[] | undefined,
  parentId = ''
): readonly OutlineTreeNode[] {
  return items.map((item, index) => {
    const id = parentId ? `${parentId}.${index}` : String(index)
    const targetPage =
      item.pageNumber !== null &&
      (!pageNumbers || pageNumbers.includes(item.pageNumber))
        ? item.pageNumber
        : null
    return {
      id,
      label: item.label,
      targetPage,
      disabled: !item.href || targetPage === null,
      children: toOutlineNodes(item.subitems, pageNumbers, id)
    }
  })
}

function indexOutlineItems(
  items: readonly EpubEngineTocEntry[],
  parentId = '',
  out = new Map<string, EpubEngineTocEntry>()
) {
  items.forEach((item, index) => {
    const id = parentId ? `${parentId}.${index}` : String(index)
    out.set(id, item)
    indexOutlineItems(item.subitems, id, out)
  })
  return out
}

export function EpubOutline({
  items,
  pageNumbers,
  currentPageNumber,
  onNavigate
}: {
  readonly items: readonly EpubEngineTocEntry[]
  readonly pageNumbers?: readonly number[]
  readonly currentPageNumber?: number | null
  readonly onNavigate: (href: string) => void
}) {
  const nodes = useMemo(
    () => toOutlineNodes(items, pageNumbers),
    [items, pageNumbers]
  )
  const entryById = useMemo(() => indexOutlineItems(items), [items])
  if (!items.length)
    return <p role='status'>此文档没有章节目录，可使用页面导航。</p>
  return (
    <OutlineTree
      items={nodes}
      currentPage={currentPageNumber ?? null}
      pageNumbers={pageNumbers}
      documentKey={items}
      onNavigate={(node) => {
        const entry = entryById.get(node.id)
        if (entry?.href) onNavigate(entry.href)
      }}
    />
  )
}
