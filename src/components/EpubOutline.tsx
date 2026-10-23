import type { EpubEngineTocEntry } from '../epub/foliateEpubEngine'

function OutlineItems({
  items,
  onNavigate
}: {
  readonly items: readonly EpubEngineTocEntry[]
  readonly onNavigate: (href: string) => void
}) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item.href}:${index}`}>
          <button
            type='button'
            disabled={!item.href || item.pageNumber === null}
            onClick={() => item.href && onNavigate(item.href)}
          >
            {item.label}
          </button>
          {item.subitems.length > 0 && (
            <OutlineItems items={item.subitems} onNavigate={onNavigate} />
          )}
        </li>
      ))}
    </ul>
  )
}

export function EpubOutline({
  items,
  onNavigate
}: {
  readonly items: readonly EpubEngineTocEntry[]
  readonly onNavigate: (href: string) => void
}) {
  if (!items.length) return null
  return (
    <details className='hamster-reader__epub-outline'>
      <summary>目录</summary>
      <OutlineItems items={items} onNavigate={onNavigate} />
    </details>
  )
}
