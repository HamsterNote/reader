import type { IntermediateDocumentSerialized } from '@hamster-note/types'

export type ReaderProps = {
  document?: IntermediateDocumentSerialized | null
  className?: string
  emptyText?: string
}

export function Reader({
  document,
  className,
  emptyText = 'No document'
}: ReaderProps) {
  const content = document?.title ?? emptyText
  const rootClassName = className
    ? `hamster-reader ${className}`
    : 'hamster-reader'

  return (
    <div className={rootClassName} data-testid='reader-root'>
      {content}
    </div>
  )
}
