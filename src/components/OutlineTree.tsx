import { useEffect, useMemo, useState } from 'react'

export type OutlineTreeNode = {
  readonly id: string
  readonly label: string
  readonly targetPage: number | null
  readonly disabled: boolean
  readonly children: readonly OutlineTreeNode[]
}

type Candidate = {
  readonly id: string
  readonly page: number
  readonly depth: number
}

function collectCandidates(
  items: readonly OutlineTreeNode[],
  depth: number,
  out: Candidate[]
) {
  for (const item of items) {
    if (item.targetPage !== null) {
      out.push({ id: item.id, page: item.targetPage, depth })
    }
    collectCandidates(item.children, depth + 1, out)
  }
}

/** 当前项取「目标页不晚于当前页」中目标页最大者；同页时取层级更深、目录顺序更靠后者。
 *  当前页早于所有目标时不返回任何项。 */
export function findActiveOutlineNodeId(
  items: readonly OutlineTreeNode[],
  currentPage: number | null
): string | null {
  if (currentPage === null) return null
  const candidates: Candidate[] = []
  collectCandidates(items, 0, candidates)
  let active: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.page > currentPage) continue
    if (
      active === null ||
      candidate.page > active.page ||
      (candidate.page === active.page && candidate.depth >= active.depth)
    ) {
      active = candidate
    }
  }
  return active?.id ?? null
}

const listStyle = { margin: 0, padding: 0, listStyle: 'none' } as const

function OutlineItems({
  items,
  depth,
  activeId,
  collapsed,
  onToggle,
  onNavigate
}: {
  readonly items: readonly OutlineTreeNode[]
  readonly depth: number
  readonly activeId: string | null
  readonly collapsed: ReadonlySet<string>
  readonly onToggle: (id: string) => void
  readonly onNavigate: (node: OutlineTreeNode) => void
}) {
  return (
    <ul style={listStyle}>
      {items.map((node) => {
        const hasChildren = node.children.length > 0
        const isCollapsed = collapsed.has(node.id)
        const isActive = node.id === activeId
        return (
          <li key={node.id} data-outline-item={node.id}>
            <div
              className='hamster-reader__outline-row'
              data-outline-depth={depth}
              style={{ paddingLeft: `${depth}em` }}
            >
              {hasChildren ? (
                <button
                  type='button'
                  className='hamster-reader__outline-toggle'
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? '展开' : '收起'} ${node.label}`}
                  onClick={() => onToggle(node.id)}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span
                  aria-hidden='true'
                  className='hamster-reader__outline-toggle-placeholder'
                />
              )}
              <button
                type='button'
                className='hamster-reader__outline-item'
                disabled={node.disabled}
                aria-current={isActive ? 'location' : undefined}
                data-active={isActive ? 'true' : undefined}
                style={
                  isActive
                    ? { color: 'var(--hamster-reader-theme-color, #2563eb)' }
                    : undefined
                }
                onClick={() => onNavigate(node)}
              >
                {node.label}
              </button>
            </div>
            {hasChildren && !isCollapsed && (
              <OutlineItems
                items={node.children}
                depth={depth + 1}
                activeId={activeId}
                collapsed={collapsed}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function OutlineTree({
  items,
  currentPage,
  onNavigate
}: {
  readonly items: readonly OutlineTreeNode[]
  readonly currentPage: number | null
  readonly onNavigate: (node: OutlineTreeNode) => void
}) {
  const activeId = useMemo(
    () => findActiveOutlineNodeId(items, currentPage),
    [items, currentPage]
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  useEffect(() => setCollapsed(new Set()), [items])
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <OutlineItems
      items={items}
      depth={0}
      activeId={activeId}
      collapsed={collapsed}
      onToggle={toggle}
      onNavigate={onNavigate}
    />
  )
}
