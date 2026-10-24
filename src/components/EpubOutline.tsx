import type { EpubEngineTocEntry } from '../epub/foliateEpubEngine'

function OutlineItems({
  items,
  pageNumbers,
  onNavigate
}: {
  readonly items: readonly EpubEngineTocEntry[]
  readonly pageNumbers?: readonly number[]
  readonly onNavigate: (href: string) => void
}) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item.href}:${index}`}>
          <button
            type='button'
            disabled={
              !item.href ||
              item.pageNumber === null ||
              (pageNumbers && !pageNumbers.includes(item.pageNumber))
            }
            onClick={() => item.href && onNavigate(item.href)}
          >
            {item.label}
          </button>
          {item.subitems.length > 0 && (
            <OutlineItems
              items={item.subitems}
              pageNumbers={pageNumbers}
              onNavigate={onNavigate}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

export function EpubOutline({
  items,
  pageNumbers,
  onNavigate
}: {
  readonly items: readonly EpubEngineTocEntry[]
  readonly pageNumbers?: readonly number[]
  readonly onNavigate: (href: string) => void
}) {
  if (!items.length) return null
  return (
    <details className='hamster-reader__epub-outline'>
      <summary>目录</summary>
      <OutlineItems
        items={items}
        pageNumbers={pageNumbers}
        onNavigate={onNavigate}
      />
    </details>
  )
}
