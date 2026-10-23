import { useRef, useState } from 'react'
import { Icon } from '@hamster-note/components'
import type { IntermediateDocument } from '@hamster-note/types'
import { Reader } from '../../src/components/Reader'
import type { ReaderEngineSource } from '../../src/types/engineSource'
import type { ReaderSelectionRef } from '../../src/types/selection'
import type { ReaderFontScale } from '../../src/types/fontScale'
import type { ReaderSnapshot } from '../../src/host/readerSnapshot'
import { serializeReaderSnapshot } from '../../src/host/readerSnapshot'
import { removeHighlightFromComments } from '../../src/storage/commentStorage'
import { CommentPanel } from '../../demo/CommentPanel'

export function ReaderSurface({
  source,
  document,
  initial,
  onChange
}: {
  readonly source: ReaderEngineSource
  readonly document: IntermediateDocument
  readonly initial: ReaderSnapshot
  readonly onChange: (data: Record<string, unknown>) => void
}) {
  const [snapshot, setSnapshot] = useState(initial)
  const current = useRef(snapshot)
  current.current = snapshot
  const [rangeId, setRangeId] = useState<string | null>(null)
  const [rectId, setRectId] = useState<string | null>(null)
  const [commentId, setCommentId] = useState<string | null>(null)
  const [browser, setBrowser] = useState(false)
  const [fontScale, setFontScale] = useState<ReaderFontScale>(1.5)
  const [color, setColor] = useState('#ffc107')
  const selection = useRef<ReaderSelectionRef>(null)
  const update = (next: ReaderSnapshot) => {
    current.current = next
    setSnapshot(next)
    onChange(serializeReaderSnapshot(next))
  }
  const dataChange = (data: ReaderSnapshot['data']) =>
    update({ ...current.current, data })
  const remove = (id: string, rectangle: boolean) => {
    const next = current.current
    update({
      ...next,
      data: {
        ...next.data,
        ranges: rectangle
          ? next.data.ranges
          : next.data.ranges?.filter((item) => item.id !== id),
        rects: rectangle
          ? next.data.rects?.filter((item) => item.id !== id)
          : next.data.rects
      },
      comments: removeHighlightFromComments(next.comments, id)
    })
    setRangeId(null)
    setRectId(null)
  }
  return (
    <>
      <Reader
        document={document}
        engineSource={source}
        isEpub={source.format === 'epub'}
        isPdf={source.format === 'pdf'}
        data={snapshot.data}
        onDataChange={dataChange}
        useVirtualPaper={false}
        selectionRef={selection}
        selectedRangeId={rangeId}
        onSelectRange={setRangeId}
        selectedRectId={rectId}
        onSelectRect={setRectId}
        onHighlight={(range) => {
          const next = current.current
          if (!next.data.ranges?.some((item) => item.id === range.id))
            dataChange({
              ...next.data,
              ranges: [...(next.data.ranges ?? []), range]
            })
          setRangeId(range.id)
        }}
        onUpdateRange={(range) =>
          dataChange({
            ...current.current.data,
            ranges: current.current.data.ranges?.map((item) =>
              item.id === range.id ? range : item
            )
          })
        }
        onRemoveRange={(id) => remove(id, false)}
        onRemoveRect={(id) => remove(id, true)}
        onUpdateRect={(rect) =>
          dataChange({
            ...current.current.data,
            rects: current.current.data.rects?.map((item) =>
              item.id === rect.id ? rect : item
            )
          })
        }
        onCreateRect={(rect) => {
          if (!current.current.data.rects?.some((item) => item.id === rect.id))
            dataChange({
              ...current.current.data,
              rects: [...(current.current.data.rects ?? []), rect]
            })
        }}
        onPagePaintingsChange={(pagePaintings) =>
          dataChange({ ...current.current.data, pagePaintings })
        }
        annotationHistory={{ enabled: true, resetKey: document.id }}
        onAnnotationHistoryChange={(next, detail) => {
          setRangeId(next.selectedRangeId)
          setRectId(next.selectedRectId)
          if (detail.source !== 'reset')
            dataChange({
              ...current.current.data,
              ranges: next.ranges,
              rects: next.rects
            })
        }}
        fontScale={
          source.format === 'epub' || snapshot.data.renderMode === 'text'
            ? fontScale
            : undefined
        }
        onFontScaleChange={setFontScale}
        highlightColor={color}
        onHighlightColorChange={setColor}
        showPageBrowser={browser}
        onPageBrowserClose={() => setBrowser(false)}
        onEdgeCropApply={(pageNumber, crop) =>
          dataChange({
            ...current.current.data,
            edgeCrop:
              pageNumber === null
                ? { ...current.current.data.edgeCrop, all: crop }
                : {
                    ...current.current.data.edgeCrop,
                    pages: {
                      ...current.current.data.edgeCrop?.pages,
                      [`page-${pageNumber}`]: crop
                    }
                  }
          })
        }
        comments={snapshot.comments}
        onCommentHighlight={async (range) => {
          setCommentId(range.id)
          return range
        }}
        onCommentRect={async (rect) => {
          setCommentId(rect.id)
          return rect
        }}
      />
      <button
        type='button'
        className='reader-outline-toggle'
        aria-label='页面与标注'
        title='页面与标注'
        onClick={() => setBrowser((value) => !value)}
      >
        <Icon name='menu' />
      </button>
      {commentId && (
        <CommentPanel
          comments={snapshot.comments}
          ranges={snapshot.data.ranges ?? []}
          activeHighlightId={commentId}
          onCommentsChange={(comments) =>
            update({ ...current.current, comments })
          }
          onJumpToHighlight={(id) => selection.current?.scrollToRange(id)}
          onClose={() => setCommentId(null)}
        />
      )}
    </>
  )
}
