import type { DrawingValue } from '@hamster-note/painting'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized,
  type IntermediateTextSerialized,
  TextDir
} from '@hamster-note/types'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, type RefObject, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeDrawingValue } from '../src/components/PageDrawingLayer'
import {
  SUPPORTED_UPLOAD_ACCEPT,
  SUPPORTED_UPLOAD_COPY
} from '../src/components/Reader'
import type {
  DefaultRectanglePopoverProps,
  ReaderBookmark,
  ReaderComment,
  ReaderCommentChangeDetail,
  ReaderInteractionMode,
  ReaderInteractiveProps,
  ReaderProps,
  ReaderRenderMode,
  ReaderSelectionRange,
  ReaderSelectionRectangle,
  ReaderSelectionRef,
  ReaderTouchPanMode
} from '../src/index'
import { DefaultRectanglePopover, Page, Reader } from '../src/index'
import type {
  LinkedSelectionData,
  LinkedSelectionRange
} from './mocks/selection'
import {
  clearSelectionProps,
  getAllSelectionProps,
  getSelectionPropsById,
  simulateLinkedDataChange,
  simulateLinkedSelect,
  simulateLinkedSelectRange,
  simulateSelectionConfirmRect
} from './mocks/selection'
import { intersectionObserverMock, mockElementSize } from './setup'

let capturedViewerProps: Record<string, unknown> = {}
let capturedTextViewerProps: Record<string, unknown> = {}

vi.mock(
  '../src/components/IntermediateDocumentViewer',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/components/IntermediateDocumentViewer')
      >()
    return {
      ...actual,
      IntermediateDocumentViewer: (props: Record<string, unknown>) => {
        capturedViewerProps = props
        return actual.IntermediateDocumentViewer(
          props as Parameters<typeof actual.IntermediateDocumentViewer>[0]
        )
      }
    }
  }
)

vi.mock(
  '../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../src/components/IntermediateDocumentViewer/IntermediateDocumentTextViewer')
      >()
    return {
      ...actual,
      IntermediateDocumentTextViewer: (props: Record<string, unknown>) => {
        capturedTextViewerProps = props
        return actual.IntermediateDocumentTextViewer(
          props as Parameters<typeof actual.IntermediateDocumentTextViewer>[0]
        )
      }
    }
  }
)

vi.mock('../src/components/PopoverPortal', () => ({
  PopoverPortal: ({
    children,
    visible
  }: {
    children: React.ReactNode
    visible: boolean
  }) => (visible ? children : null)
}))

vi.mock('@system-ui-js/multi-drag', () => {
  const DragOperationType = {
    Start: 'start',
    Move: 'move',
    End: 'end',
    Inertial: 'inertial',
    InertialEnd: 'inertialEnd',
    AllEnd: 'allEnd'
  }

  const makeFinger = (event: MouseEvent | PointerEvent) => ({
    pointerId: (event as PointerEvent).pointerId ?? 1,
    getLastOperation: () => ({
      point: { x: event.clientX, y: event.clientY },
      timestamp: event.timeStamp
    })
  })

  return {
    DragOperationType,
    MixinType: {
      Drag: 'drag',
      Rotate: 'rotate',
      Scale: 'scale'
    },
    Drag: class MockedDrag {
      private readonly listeners = new Map<
        string,
        Array<(fingers: ReturnType<typeof makeFinger>[]) => void>
      >()
      private primaryPointerId: number | null = null

      constructor(private readonly element: HTMLElement) {
        this.element.addEventListener('pointerdown', this.handlePointerDown)
        this.element.addEventListener('pointermove', this.handlePointerMove)
        this.element.addEventListener('pointerup', this.handlePointerEnd)
        this.element.addEventListener('pointercancel', this.handlePointerEnd)
      }

      addEventListener(
        type: string,
        callback: (fingers: ReturnType<typeof makeFinger>[]) => void
      ) {
        const callbacks = this.listeners.get(type) ?? []
        callbacks.push(callback)
        this.listeners.set(type, callbacks)
      }

      removeEventListener(
        type: string,
        callback?: (fingers: ReturnType<typeof makeFinger>[]) => void
      ) {
        if (!callback) {
          this.listeners.delete(type)
          return
        }
        const callbacks = this.listeners.get(type) ?? []
        this.listeners.set(
          type,
          callbacks.filter((listener) => listener !== callback)
        )
      }

      destroy() {
        this.element.removeEventListener('pointerdown', this.handlePointerDown)
        this.element.removeEventListener('pointermove', this.handlePointerMove)
        this.element.removeEventListener('pointerup', this.handlePointerEnd)
        this.element.removeEventListener('pointercancel', this.handlePointerEnd)
      }

      getCurrentOperationType() {
        return this.primaryPointerId === null
          ? DragOperationType.AllEnd
          : DragOperationType.Move
      }

      private emit(type: string, event: MouseEvent | PointerEvent) {
        this.listeners.get(type)?.forEach((listener) => {
          listener([makeFinger(event)])
        })
      }

      private handlePointerDown = (event: MouseEvent | PointerEvent) => {
        if (event.button !== 0) return
        this.primaryPointerId = (event as PointerEvent).pointerId ?? 1
        this.emit(DragOperationType.Start, event)
      }

      private handlePointerMove = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emit(DragOperationType.Move, event)
      }

      private handlePointerEnd = (event: MouseEvent | PointerEvent) => {
        if (this.primaryPointerId === null) return
        this.emit(DragOperationType.End, event)
        this.emit(DragOperationType.AllEnd, event)
        this.primaryPointerId = null
      }
    },
    Mixin: class MockedMixin {
      destroy() {}

      addEventListener() {}

      removeEventListener() {}
    }
  }
})

function makePage(number: number) {
  return {
    id: `page-${number}`,
    texts: [],
    width: 100,
    height: 150,
    number,
    thumbnail: undefined
  }
}

function makeText(id: string, content: string): IntermediateTextSerialized {
  return {
    id,
    content,
    fontSize: 12,
    fontFamily: 'Arial',
    fontWeight: 400,
    italic: false,
    color: '#111111',
    polygon: [
      [10, 20],
      [50, 20],
      [50, 36],
      [10, 36]
    ],
    lineHeight: 16,
    ascent: 10,
    descent: 2,
    dir: TextDir.LTR,
    skew: 0,
    isEOL: false
  }
}

function makeDocument(
  overrides?: Partial<IntermediateDocumentSerialized>
): IntermediateDocumentSerialized {
  return {
    id: 'doc-1',
    pages: [],
    title: 'Hamster Reader Title',
    ...overrides
  }
}

type MockPage = {
  getContent: ReturnType<typeof vi.fn<() => Promise<unknown[]>>>
  thumbnail?: string
  image?: string
}

function makeLazyDocument(pageCount: number = 1): {
  document: IntermediateDocument
  pages: Map<number, MockPage>
} {
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
  const pages = new Map<number, MockPage>()

  pageNumbers.forEach((pageNumber) => {
    pages.set(pageNumber, {
      getContent: vi.fn(async () => [
        makeText(`text-${pageNumber}`, `Page ${pageNumber} text`)
      ])
    })
  })

  const document = {
    id: 'doc-1',
    title: 'Hamster Reader Title',
    pageCount,
    pageNumbers,
    getPageSizeByPageNumber: vi.fn(() => ({ x: 100, y: 150 })),
    getPageByPageNumber: vi.fn((pageNumber: number) =>
      Promise.resolve(pages.get(pageNumber))
    )
  } as unknown as IntermediateDocument

  return { document, pages }
}

type RectInput = {
  left: number
  top: number
  width: number
  height: number
}

const makeDomRect = (rect: RectInput) =>
  ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect
  }) as DOMRect

const mockElementRect = (element: HTMLElement, rect: RectInput) =>
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(makeDomRect(rect))

function requireReaderSelectionRef(
  ref: RefObject<ReaderSelectionRef | null>
): ReaderSelectionRef {
  if (!ref.current) {
    throw new Error('Expected Reader selection ref to be available')
  }

  return ref.current
}

function requireRuntimeSelectionId(pageSuffix = ':page-1'): string {
  const selectionId = getAllSelectionProps().find((props) =>
    props.selectionId?.endsWith(pageSuffix)
  )?.selectionId

  if (!selectionId) {
    throw new Error(`Expected runtime selection id ending with ${pageSuffix}`)
  }

  return selectionId
}

function requireLinkedData(selectionId: string): LinkedSelectionData {
  const linkedData = getAllSelectionProps().find(
    (props) => props.selectionId === selectionId
  )?.linkedData

  if (!linkedData) {
    throw new Error(`Expected linked data for ${selectionId}`)
  }

  return linkedData
}

function makeReaderRange(id: string, text: string): ReaderSelectionRange {
  return {
    id,
    text,
    start: { selectionId: 'page-1', offset: 0 },
    end: { selectionId: 'page-1', offset: text.length },
    createdAt: id.length,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
    }
  }
}

function makeRuntimeRange(
  runtimeSelectionId: string,
  id: string,
  text: string
): LinkedSelectionRange {
  return {
    id,
    text,
    start: { selectionId: runtimeSelectionId, offset: 0 },
    end: { selectionId: runtimeSelectionId, offset: text.length },
    createdAt: id.length,
    overlayRectType: 'percent',
    rectsBySelectionId: {
      [runtimeSelectionId]: [{ x: 10, y: 20, width: 30, height: 10 }]
    }
  }
}

function makeReaderRect(id: string): ReaderSelectionRectangle {
  return {
    id,
    createdAt: id.length,
    overlayRectType: 'percent',
    start: { x: 10, y: 20 },
    end: { x: 40, y: 60 },
    selectionId: 'page-1',
    rect: { x: 10, y: 20, width: 30, height: 40 }
  }
}

function createMockFile(
  name: string,
  size: number,
  type: string = 'application/pdf'
): File {
  const file = new File([], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('Reader public API', () => {
  beforeEach(() => {
    capturedViewerProps = {}
    capturedTextViewerProps = {}
  })

  it('renders the provided document title on the public entry', () => {
    render(<Reader document={makeDocument()} />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Hamster Reader Title')
  })

  it('renders emptyText when document is null', () => {
    render(<Reader document={null} emptyText='Nothing to render' />)

    const root = screen.getByTestId('reader-root')

    expect(root).toBeInTheDocument()
    expect(root).toHaveTextContent('Nothing to render')
  })

  it('renders IntermediateDocumentViewer by default for a paged serialized document', () => {
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
  })

  it('renders IntermediateDocumentViewer by default for a runtime document', () => {
    const runtimeDocument = IntermediateDocument.parse(
      makeDocument({ pages: [makePage(1)] })
    )

    render(<Reader document={runtimeDocument} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
  })

  it('renders a working default bottom bar for paged documents', async () => {
    // Given: 宿主只提供文档，所有底栏状态都由 Reader 自己管理。
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        fontScale={1.5}
      />
    )

    const bottomBar = screen.getByTestId('tool-bottom-bar')
    const rectTool = screen.getByTestId('tool-bottom-bar-rect-selection')
    const edgeCrop = screen.getByTestId('tool-bottom-bar-edge-crop')

    expect(bottomBar.parentElement).toHaveAttribute(
      'data-testid',
      'reader-root'
    )
    expect(capturedViewerProps.selectedTool).toBe('text-selection')
    expect(capturedViewerProps.touchPanMode).toBe('single-finger')
    expect(capturedViewerProps.edgeCropEditing).toBe(false)

    // When: 用户直接操作 Reader 自带的底栏。
    fireEvent.click(rectTool)
    fireEvent.click(edgeCrop)

    // Then: 同一个 Reader viewer 收到更新后的工具与布局状态。
    await waitFor(() => {
      expect(capturedViewerProps.selectedTool).toBe('rect-selection')
      expect(capturedViewerProps.touchPanMode).toBe('two-finger')
      expect(capturedViewerProps.edgeCropEditing).toBe(true)
    })

    // When: 切换到 Text 模式。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))

    // Then: Reader 改用 Text viewer，并自动退出仅属于 Layout 的裁边模式。
    // 在 Text 模式下，这些按钮被隐藏而不是禁用。
    await waitFor(() => {
      expect(
        screen.getByTestId('intermediate-document-text-viewer')
      ).toBeInTheDocument()
      expect(screen.queryByTestId('tool-bottom-bar-edge-crop')).toBeNull()
      expect(screen.queryByTestId('tool-bottom-bar-touch-pan-mode')).toBeNull()
      expect(screen.queryByTestId('tool-bottom-bar-ocr')).toBeNull()
    })
  })

  it('switches touch panning to two fingers when rectangle selection activates', async () => {
    // Given: the built-in toolbar starts with text selection and single-finger panning.
    const onSelectedToolChange = vi.fn()
    const onTouchPanModeChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        onSelectedToolChange={onSelectedToolChange}
        onTouchPanModeChange={onTouchPanModeChange}
      />
    )

    // When: the rectangle-selection tool is activated.
    fireEvent.click(screen.getByTestId('tool-bottom-bar-rect-selection'))

    // Then: the viewer and public callbacks receive the paired interaction state.
    await waitFor(() => {
      expect(capturedViewerProps.selectedTool).toBe('rect-selection')
      expect(capturedViewerProps.touchPanMode).toBe('two-finger')
    })
    expect(onSelectedToolChange).toHaveBeenCalledWith('rect-selection')
    expect(onTouchPanModeChange).toHaveBeenCalledWith('two-finger')
  })

  it('shows font scaling in Text mode and EPUB Layout mode only', () => {
    // Given: a non-EPUB document is rendered in Layout mode with font scaling enabled.
    const document = makeDocument({ pages: [makePage(1)] })
    const { rerender } = render(
      <Reader document={document} renderMode='layout' fontScale={1.5} />
    )

    // Then: fixed Layout content does not expose the font-size control.
    expect(screen.queryByTestId('tool-bottom-bar-font-scale')).toBeNull()

    // When: the same Layout document is identified as EPUB.
    rerender(
      <Reader document={document} renderMode='layout' fontScale={1.5} isEpub />
    )

    // Then: EPUB keeps its reflowable font-size control in Layout mode.
    expect(screen.getByTestId('tool-bottom-bar-font-scale')).toBeInTheDocument()

    // When: a non-EPUB document uses Text mode.
    rerender(<Reader document={document} renderMode='text' fontScale={1.5} />)

    // Then: Text mode still exposes font scaling for supported text documents.
    expect(screen.getByTestId('tool-bottom-bar-font-scale')).toBeInTheDocument()
  })

  it('keeps the default OCR toggle off until the user enables it', async () => {
    // Given: 宿主没有传入 OCR 配置，Reader 使用默认的内部开关状态。
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    const ocrToggle = screen.getByTestId('tool-bottom-bar-ocr')
    expect(ocrToggle).toHaveAttribute('aria-pressed', 'false')
    expect(capturedViewerProps.ocr).toBe(false)

    // When: 用户开启底栏 OCR。
    fireEvent.click(ocrToggle)

    // Then: 开关与布局 viewer 同步进入开启状态。
    await waitFor(() => {
      expect(ocrToggle).toHaveAttribute('aria-pressed', 'true')
      expect(capturedViewerProps.ocr).toBe(true)
    })
  })

  it('reports controlled OCR changes without mutating the host value', () => {
    // Given: 宿主显式控制 OCR，当前值为关闭。
    const onOcrChange = vi.fn()
    const document = makeDocument({ pages: [makePage(1)] })
    const { rerender } = render(
      <Reader document={document} ocr={false} onOcrChange={onOcrChange} />
    )
    const ocrToggle = screen.getByTestId('tool-bottom-bar-ocr')

    // When: 用户点击受控开关。
    fireEvent.click(ocrToggle)

    // Then: Reader 报告下一状态，但在宿主回传前仍保持关闭。
    expect(onOcrChange).toHaveBeenCalledWith(true)
    expect(ocrToggle).toHaveAttribute('aria-pressed', 'false')
    expect(capturedViewerProps.ocr).toBe(false)

    // When: 宿主回传新的受控状态。
    rerender(<Reader document={document} ocr onOcrChange={onOcrChange} />)

    // Then: 底栏与 viewer 一起反映宿主值。
    expect(ocrToggle).toHaveAttribute('aria-pressed', 'true')
    expect(capturedViewerProps.ocr).toBe(true)
  })

  it('lets controlled hosts receive default bottom bar changes', () => {
    // Given: 宿主控制 Reader 底栏对应的公开状态。
    const onRenderModeChange = vi.fn()
    const onFontScaleChange = vi.fn()
    const onTouchPanModeChange = vi.fn()
    const onEdgeCropEditingChange = vi.fn()
    const onSelectedToolChange = vi.fn()
    const onDrawingStrokeColorChange = vi.fn()
    const onHighlightColorChange = vi.fn()

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        isEpub
        renderMode='layout'
        fontScale={1.5}
        touchPanMode='single-finger'
        edgeCropEditing={false}
        selectedTool='text-selection'
        drawingStrokeColor='#7d9ec0'
        onRenderModeChange={onRenderModeChange}
        onFontScaleChange={onFontScaleChange}
        onTouchPanModeChange={onTouchPanModeChange}
        onEdgeCropEditingChange={onEdgeCropEditingChange}
        onSelectedToolChange={onSelectedToolChange}
        onDrawingStrokeColorChange={onDrawingStrokeColorChange}
        onHighlightColorChange={onHighlightColorChange}
      />
    )

    // When: 用户逐项操作默认底栏。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-touch-pan-mode'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-edge-crop'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-drawing'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-color-green'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-font-scale'))
    fireEvent.click(screen.getByRole('menuitem', { name: '特小' }))

    // Then: 受控宿主收到完整的下一状态，不依赖 Demo 私有实现。
    expect(onRenderModeChange).toHaveBeenCalledWith('text')
    expect(onTouchPanModeChange).toHaveBeenCalledWith('two-finger')
    expect(onEdgeCropEditingChange).toHaveBeenCalledWith(true)
    expect(onSelectedToolChange).toHaveBeenCalledWith('drawing')
    expect(onDrawingStrokeColorChange).toHaveBeenCalledWith('#8eba8e')
    expect(onHighlightColorChange).toHaveBeenCalledWith(
      'rgba(142, 186, 142, 0.35)'
    )
    expect(onFontScaleChange).toHaveBeenCalledWith(0.5)
  })

  it('updates both uncontrolled drawing and highlight colors from the default bottom bar', async () => {
    // Given: 宿主不控制工具颜色，Reader 使用原有描边默认值。
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    expect(capturedViewerProps.drawingStrokeColor).toBe('#2563eb')

    // When: 用户选择绿色工具颜色。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-color-green'))

    // Then: 绘图与高亮颜色都由 Reader 内部同步更新。
    await waitFor(() => {
      expect(capturedViewerProps.drawingStrokeColor).toBe('#8eba8e')
      expect(capturedViewerProps.highlightColor).toBe(
        'rgba(142, 186, 142, 0.35)'
      )
    })
  })

  it('changes only the highlight color from the Text mode bottom bar', async () => {
    // Given: Text Mode 使用默认底栏，绘图颜色由宿主监听。
    const onDrawingStrokeColorChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        renderMode='text'
        onDrawingStrokeColorChange={onDrawingStrokeColorChange}
      />
    )

    // When: 用户选择绿色。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-color-green'))

    // Then: Text viewer 的高亮颜色更新，绘图描边保持不变。
    await waitFor(() => {
      expect(capturedTextViewerProps.highlightColor).toBe(
        'rgba(142, 186, 142, 0.35)'
      )
    })
    expect(onDrawingStrokeColorChange).not.toHaveBeenCalled()
  })

  it('writes hidden pages through ReaderData from the crop overlay', async () => {
    // Given: ReaderData 由宿主持久化，裁切模式正在编辑第一页。
    const onDataChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        data={{ hiddenPages: [] }}
        onDataChange={onDataChange}
        edgeCropEditing
      />
    )

    // When: 用户点击隐藏当前页。
    fireEvent.click(await screen.findByTestId('edge-crop-hide-page'))

    // Then: Reader 通过统一数据入口追加当前页，不改动其他数据。
    expect(onDataChange).toHaveBeenCalledWith({ hiddenPages: [1] })
  })

  it('uses the colors prop as the default bottom bar color list', () => {
    // Given: 宿主提供与默认颜色完全不同的公共颜色列表。
    const onDrawingStrokeColorChange = vi.fn()
    const onHighlightColorChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        colors={[{ name: 'brand', color: '#123456' }]}
        onDrawingStrokeColorChange={onDrawingStrokeColorChange}
        onHighlightColorChange={onHighlightColorChange}
      />
    )

    // When: 用户选择自定义颜色。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-color-brand'))

    // Then: 底栏只展示公共列表，并同步绘图与高亮颜色。
    expect(screen.queryByTestId('tool-bottom-bar-color-green')).toBeNull()
    expect(onDrawingStrokeColorChange).toHaveBeenCalledWith('#123456')
    expect(onHighlightColorChange).toHaveBeenCalledWith(
      'rgba(18, 52, 86, 0.35)'
    )
  })

  it('allows the default bottom bar to be replaced or disabled', () => {
    // Given / When: 一个 Reader 提供自定义底栏，另一个显式传入 null。
    const { rerender } = render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        bottomBar={<div data-testid='custom-bottom-bar'>Custom controls</div>}
      />
    )

    // Then: 自定义节点替代默认底栏。
    expect(screen.getByTestId('custom-bottom-bar')).toBeInTheDocument()
    expect(screen.queryByTestId('tool-bottom-bar')).not.toBeInTheDocument()

    rerender(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        bottomBar={null}
      />
    )

    // Then: null 明确关闭底栏。
    expect(screen.queryByTestId('custom-bottom-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tool-bottom-bar')).not.toBeInTheDocument()
  })

  it('provides toolbar semantics and restores menu focus on Escape', async () => {
    // Given: 窄屏 Reader 使用折叠工具菜单。
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 375
    })
    fireEvent(window, new Event('resize'))
    const user = userEvent.setup()

    try {
      render(
        <Reader
          document={makeDocument({ pages: [makePage(1)] })}
          fontScale={1.5}
        />
      )

      const toolbar = screen.getByRole('toolbar', { name: '工具栏' })
      const trigger = within(toolbar).getByRole('button', { name: '工具菜单' })

      // When: 用户打开工具菜单。
      await user.click(trigger)

      // Then: 触发器关联具名菜单，焦点进入第一个菜单项。
      const menuId = trigger.getAttribute('aria-controls')
      expect(menuId).toBeTruthy()
      expect(screen.getByRole('menu', { name: '选择工具' })).toHaveAttribute(
        'id',
        menuId
      )
      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: '文字工具' })).toHaveFocus()
      })

      // When: 用户按 Escape 关闭菜单。
      await user.keyboard('{Escape}')

      // Then: 菜单关闭，焦点回到原触发按钮。
      expect(
        screen.queryByRole('menu', { name: '选择工具' })
      ).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()

      // When: 用户在关闭后首次重新打开菜单。
      await user.click(trigger)

      // Then: 第一次重新激活不会被 React 合成事件生命周期吞掉。
      expect(screen.getByRole('menu', { name: '选择工具' })).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalWidth
      })
      fireEvent(window, new Event('resize'))
    }
  })

  it('isolates menu ids and outside-click regions across Reader instances', () => {
    // Given: 同一页面同时渲染两个窄屏 Reader。
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 375
    })
    fireEvent(window, new Event('resize'))

    try {
      render(
        <>
          <Reader
            document={makeDocument({ pages: [makePage(1)] })}
            isEpub
            fontScale={1.5}
          />
          <Reader
            document={makeDocument({ pages: [makePage(2)] })}
            isEpub
            fontScale={1.5}
          />
        </>
      )

      const toolTriggers = screen.getAllByRole('button', { name: '工具菜单' })
      const fontTriggers = screen.getAllByTestId('tool-bottom-bar-font-scale')

      // Then: 每个 Reader 的触发器都关联自己的唯一菜单 id。
      expect(toolTriggers[0]?.getAttribute('aria-controls')).not.toBe(
        toolTriggers[1]?.getAttribute('aria-controls')
      )
      expect(fontTriggers[0]?.getAttribute('aria-controls')).not.toBe(
        fontTriggers[1]?.getAttribute('aria-controls')
      )

      // When: 两个工具菜单都打开，并在第二个菜单内部按下指针。
      fireEvent.click(toolTriggers[0] as HTMLElement)
      fireEvent.click(toolTriggers[1] as HTMLElement)
      const toolMenus = screen.getAllByRole('menu', { name: '选择工具' })
      fireEvent.pointerDown(
        within(toolMenus[1] as HTMLElement).getByRole('menuitem', {
          name: '文字工具'
        })
      )

      // Then: 第二个 Reader 不会把自己菜单内的操作误判为外部点击。
      expect(screen.getByRole('menu', { name: '选择工具' })).toHaveAttribute(
        'id',
        toolTriggers[1]?.getAttribute('aria-controls')
      )
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalWidth
      })
      fireEvent(window, new Event('resize'))
    }
  })

  it('shows the document title fallback when pages are empty', () => {
    render(<Reader document={makeDocument({ pages: [] })} />)

    expect(screen.getByTestId('reader-content')).toHaveTextContent(
      'Hamster Reader Title'
    )
    expect(
      screen.queryByTestId('intermediate-document-viewer')
    ).not.toBeInTheDocument()
  })

  it('keeps the full layout viewer when drawing mode is enabled', async () => {
    const pagePaintings: Record<string, DrawingValue> = {
      'page-1': {
        strokes: [
          {
            id: 'stroke-1',
            tool: 'pen',
            strokeColor: '#2563eb',
            strokeWidth: 3,
            points: [
              { x: 10, y: 12 },
              { x: 40, y: 44 }
            ]
          }
        ]
      }
    }
    render(
      <Reader
        document={makeDocument({
          pages: [
            {
              ...makePage(1),
              texts: [makeText('legacy-text-1', 'Legacy page content')]
            }
          ]
        })}
        selectedTool='drawing'
        pagePaintings={pagePaintings}
        pageRange={{ start: 1, end: 1 }}
        scale={2}
      />
    )

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-1')).toHaveAttribute(
      'data-tool',
      'drawing'
    )
    expect(
      await screen.findByTestId('reader-painting-page-1')
    ).toBeInTheDocument()
    expect(capturedViewerProps.pageRange).toEqual({ start: 1, end: 1 })
    expect(capturedViewerProps.scale).toBe(2)
    expect(screen.getByTestId('reader-page-drawing-layer-page-1')).toHaveStyle({
      width: '200%',
      height: '200%',
      transform: 'scale(0.5)'
    })
    expect(
      screen.getByTestId('reader-painting-page-1').querySelector('path')
    ).toHaveAttribute('d', 'M 20 24 L 80 88')
  })

  it('lets selection modes receive pointer input through the drawing layer', async () => {
    const { rerender } = render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='text-selection'
      />
    )

    expect(
      screen.queryByTestId('reader-page-drawing-layer-page-1')
    ).not.toBeInTheDocument()

    rerender(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
      />
    )

    expect(
      await screen.findByTestId('reader-page-drawing-layer-page-1')
    ).toHaveStyle({ pointerEvents: 'auto' })
  })

  it('bounds persisted drawing data before rendering viewer pages', async () => {
    const oversizedDrawing: DrawingValue = {
      strokes: Array.from({ length: 501 }, (_, index) => ({
        id: `stroke-${index}`,
        tool: 'pen',
        points: [{ x: index, y: index }]
      }))
    }

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
        pagePaintings={{ 'page-1': oversizedDrawing }}
      />
    )

    expect(await screen.findByTestId('reader-painting-page-1')).toHaveAttribute(
      'data-stroke-count',
      '500'
    )
  })

  it('ignores malformed persisted drawing entries without crashing', async () => {
    const malformedDrawing = JSON.parse(
      '{"strokes":[null,{"id":"broken","points":null}]}'
    ) as DrawingValue

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        selectedTool='drawing'
        pagePaintings={{ 'page-1': malformedDrawing }}
      />
    )

    expect(await screen.findByTestId('reader-painting-page-1')).toHaveAttribute(
      'data-stroke-count',
      '0'
    )
  })

  it('bounds persisted drawing dash arrays before rendering', () => {
    // Given: one otherwise-valid stroke contains an attacker-controlled style array.
    const drawing: DrawingValue = {
      strokes: [
        {
          id: 'oversized-dash-array',
          tool: 'pen',
          points: [{ x: 10, y: 20 }],
          dashArray: Array.from({ length: 10_000 }, (_, index) => index + 1)
        }
      ]
    }

    // When: persisted page data crosses the drawing boundary.
    const sanitized = sanitizeDrawingValue(drawing)

    // Then: only a small, fixed prefix is retained for rendering.
    expect(sanitized.strokes[0]?.dashArray).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1)
    )
  })

  it('renders current serialized page content with container-scaled text geometry', () => {
    render(
      <Page
        page={{
          ...makePage(1),
          content: [makeText('content-text-1', 'Current page content')],
          texts: undefined
        }}
        selectedTool='text-selection'
      />
    )

    const text = screen.getByTestId('reader-page-text-content-text-1')
    expect(text).toHaveTextContent('Current page content')
    expect(text.getAttribute('style')).toContain('font-size: 12%')
    expect(text.getAttribute('style')).toContain(
      'line-height: 133.33333333333331%'
    )
    expect(screen.getByText('Content').nextElementSibling).toHaveTextContent(
      '1'
    )
  })

  it('renders useFlowLayout page in document flow without positioning', () => {
    render(
      <Page
        page={{
          ...makePage(1),
          useFlowLayout: true,
          content: [
            { ...makeText('flow-text-1', '第一行'), isEOL: true },
            { ...makeText('flow-text-2', '第二行'), isEOL: true }
          ],
          texts: undefined
        }}
        selectedTool='text-selection'
      />
    )

    // 文档流模式：surface 不再按 width/height 固定纵横比
    const surface = screen.getByTestId('reader-page-surface-page-1')
    expect(surface.className).toContain('hamster-reader__page-surface--flow')
    expect(surface.getAttribute('style') ?? '').not.toContain('aspect-ratio')

    // 文本条目不做绝对定位，fontSize 按 A4 宽度（595）缩放：12/595*100
    const firstLine = screen.getByTestId('reader-page-text-flow-text-1')
    expect(firstLine.className).toContain('hamster-reader__text-item--flow')
    const firstLineStyle = firstLine.getAttribute('style') ?? ''
    expect(firstLineStyle).toContain('font-size: 2.0168067226890756%')
    expect(firstLineStyle).not.toContain('left:')
    expect(firstLineStyle).not.toContain('top:')
    expect(firstLineStyle).not.toContain('transform:')

    // isEOL 条目后紧跟 <br> 换行
    const textLayer = screen.getByTestId('reader-page-text-layer-page-1')
    expect(textLayer.className).toContain('hamster-reader__text-layer--flow')
    expect(textLayer.querySelectorAll('br')).toHaveLength(2)
    expect(firstLine.nextElementSibling?.tagName).toBe('BR')

    // 页面元信息不再展示固定 height
    expect(screen.getByText('Size').nextElementSibling).toHaveTextContent(
      '595 × auto'
    )
  })

  it('preserves rapid uncontrolled painting updates across pages', () => {
    const onPagePaintingsChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1), makePage(2)] })}
        selectedTool='drawing'
        onPagePaintingsChange={onPagePaintingsChange}
      />
    )

    const updatePainting = capturedViewerProps.onPagePaintingChange
    if (typeof updatePainting !== 'function') {
      throw new Error('Expected viewer painting update callback')
    }

    const pageOneValue: DrawingValue = { strokes: [] }
    const pageTwoValue: DrawingValue = { strokes: [] }
    act(() => {
      updatePainting('page-1', pageOneValue)
      updatePainting('page-2', pageTwoValue)
    })

    expect(onPagePaintingsChange).toHaveBeenLastCalledWith({
      'page-1': pageOneValue,
      'page-2': pageTwoValue
    })
  })
})

describe('Reader renderMode', () => {
  it('default renderMode renders the layout viewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(
      screen.queryByTestId('intermediate-document-text-viewer')
    ).not.toBeInTheDocument()
  })

  it('explicit renderMode="layout" renders the layout viewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} renderMode='layout' />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(
      screen.queryByTestId('intermediate-document-text-viewer')
    ).not.toBeInTheDocument()
  })

  it('renders native layout zoom controls when VirtualPaper is disabled', () => {
    // Given: Layout mode explicitly opts out of VirtualPaper.
    const doc = makeDocument({ pages: [makePage(1)] })

    // When: Reader renders its built-in viewport and toolbar.
    render(<Reader document={doc} useVirtualPaper={false} />)

    // Then: the native viewport replaces VirtualPaper and exposes fit-width zoom.
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('native-layout-viewport')).toBeInTheDocument()
    expect(capturedViewerProps.useVirtualPaper).toBe(false)
    expect(capturedViewerProps.scale).toBeUndefined()
    expect(capturedViewerProps.defaultScale).toBeUndefined()
    const zoomTrigger = screen.getByTestId('tool-bottom-bar-layout-zoom')
    expect(zoomTrigger).toHaveTextContent('%')

    fireEvent.click(zoomTrigger)
    const zoomMenu = screen.getByRole('menu', { name: '缩放菜单' })
    expect(
      within(zoomMenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent?.trim())
    ).toEqual(['25%', '50%', '75%', '100%', '150%', '200%', '300%', '适配宽度'])
    expect(
      within(zoomMenu).getByRole('menuitem', { name: '适配宽度' })
    ).toHaveAttribute('aria-pressed', 'true')

    // When: the reader selects a fixed zoom preset.
    fireEvent.click(within(zoomMenu).getByRole('menuitem', { name: '150%' }))

    // Then: the trigger and viewer both receive the selected scale.
    expect(zoomTrigger).toHaveTextContent('150%')
    expect(capturedViewerProps.nativeLayoutZoom).toBe(1.5)
  })

  it('keeps VirtualPaper and hides native zoom controls by default', () => {
    // Given / When: no VirtualPaper preference is supplied.
    render(<Reader document={makeDocument({ pages: [makePage(1)] })} />)

    // Then: the public default remains backward compatible.
    expect(screen.getByTestId('virtual-paper-wrapper')).toBeInTheDocument()
    expect(screen.queryByTestId('native-layout-viewport')).toBeNull()
    expect(screen.queryByTestId('tool-bottom-bar-layout-zoom')).toBeNull()
    expect(capturedViewerProps.useVirtualPaper).toBe(true)
  })

  it('renderMode text renders the separate text viewer without VirtualPaper', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} renderMode='text' />)

    expect(
      screen.getByTestId('intermediate-document-text-viewer')
    ).toBeInTheDocument()
    // 文本模式必须不渲染 VirtualPaper wrapper
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
    // 文本模式也不应渲染 layout 模式的 viewer 根节点
    expect(
      screen.queryByTestId('intermediate-document-viewer')
    ).not.toBeInTheDocument()
  })

  it('renderMode text forwards only text-mode props without runtime errors', () => {
    const onTextSelectionChange = vi.fn()
    const onTextSelectionEnd = vi.fn()
    const onSelectText = vi.fn()
    const onTiming = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })

    render(
      <Reader
        document={doc}
        renderMode='text'
        pageRange={{ start: 1, end: 1 }}
        maxLoadedPages={5}
        initialLoadedPages={2}
        pageLoadConcurrency={4}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
        onTextSelectionChange={onTextSelectionChange}
        onTextSelectionEnd={onTextSelectionEnd}
        onSelectText={onSelectText}
        onIntermediateDocumentRenderTiming={onTiming}
      />
    )

    const textViewer = screen.getByTestId('intermediate-document-text-viewer')
    expect(textViewer).toBeInTheDocument()
    expect(textViewer).toHaveAttribute('data-title', 'Hamster Reader Title')
    // 文本模式同样挂在 reader-content 内
    expect(screen.getByTestId('reader-content')).toContainElement(textViewer)
  })

  it('renderMode text forwards canonical range props without VirtualPaper', () => {
    const ranges = [makeReaderRange('text-highlight', 'Text mode range')]
    const defaultRanges: ReaderSelectionRange[] = []
    const selectionRef = createRef<ReaderSelectionRef>()
    const selectionPopover = <div>Custom text selection popover</div>
    const highlightPopover = vi.fn((highlight: ReaderSelectionRange) => (
      <div>{highlight.id}</div>
    ))
    const onHighlight = vi.fn()
    const onDragHighlight = vi.fn()
    const onUpdateRange = vi.fn()
    const onSelectRange = vi.fn()
    const onSelectionStart = vi.fn()
    const onSelectionEnd = vi.fn()
    const onScaleChange = vi.fn()
    const onCreateRect = vi.fn()
    const onSelectRect = vi.fn()
    const onUpdateRect = vi.fn()
    const onPagePaintingChange = vi.fn()
    const onPageBrowserClose = vi.fn()
    const rects = [makeReaderRect('text-mode-rect')]
    const pagePaintings: Record<string, DrawingValue> = {
      'page-1': { strokes: [] }
    }
    const doc = makeDocument({ pages: [makePage(1)] })

    render(
      <Reader
        document={doc}
        renderMode='text'
        ranges={ranges}
        defaultRanges={defaultRanges}
        selectedRangeId='text-highlight'
        defaultSelectedRangeId='default-text-highlight'
        onHighlight={onHighlight}
        onDragHighlight={onDragHighlight}
        onUpdateRange={onUpdateRange}
        onSelectRange={onSelectRange}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        highlightColor='#ffcc00'
        selectionColor='#0066ff'
        showSelectionMagnifier={true}
        selectionPopover={selectionPopover}
        highlightPopover={highlightPopover}
        autoHighlight={true}
        selectionRef={selectionRef}
        overlayRectType='percent'
        scale={2}
        defaultScale={1.5}
        onScaleChange={onScaleChange}
        minScale={0.25}
        maxScale={4}
        tool='rect'
        selectedTool='rect-selection'
        rects={rects}
        selectedRectId='text-mode-rect'
        onCreateRect={onCreateRect}
        onSelectRect={onSelectRect}
        onUpdateRect={onUpdateRect}
        showPageBrowser={true}
        onPageBrowserClose={onPageBrowserClose}
        themeColor='#123456'
        paintingTool='pen'
        drawingStrokeColor='#654321'
        pagePaintings={pagePaintings}
        onPagePaintingChange={onPagePaintingChange}
      />
    )

    expect(capturedTextViewerProps.ranges).toBe(ranges)
    expect(capturedTextViewerProps.defaultRanges).toBe(defaultRanges)
    expect(capturedTextViewerProps.selectedRangeId).toBe('text-highlight')
    expect(capturedTextViewerProps.defaultSelectedRangeId).toBe(
      'default-text-highlight'
    )
    expect(capturedTextViewerProps.onHighlight).toBe(onHighlight)
    expect(capturedTextViewerProps.onDragHighlight).toBe(onDragHighlight)
    const capturedOnUpdateRange = capturedTextViewerProps.onUpdateRange
    if (typeof capturedOnUpdateRange !== 'function') {
      throw new TypeError('Expected text viewer onUpdateRange callback')
    }
    capturedOnUpdateRange(ranges[0])
    expect(onUpdateRange).toHaveBeenCalledWith(ranges[0])
    expect(capturedTextViewerProps.onSelectRange).toBe(onSelectRange)
    expect(capturedTextViewerProps.onSelectionStart).toBe(onSelectionStart)
    expect(capturedTextViewerProps.onSelectionEnd).toBe(onSelectionEnd)
    expect(capturedTextViewerProps.highlightColor).toBe('#ffcc00')
    expect(capturedTextViewerProps.selectionColor).toBe('#0066ff')
    expect(capturedTextViewerProps.showSelectionMagnifier).toBe(true)
    expect(capturedTextViewerProps.selectionPopover).toBe(selectionPopover)
    expect(capturedTextViewerProps.highlightPopover).toBe(highlightPopover)
    expect(capturedTextViewerProps.autoHighlight).toBe(true)
    expect(capturedTextViewerProps.selectionRef).toBe(selectionRef)
    expect(capturedTextViewerProps.overlayRectType).toBe('percent')
    expect(capturedTextViewerProps).not.toHaveProperty('scale')
    expect(capturedTextViewerProps).not.toHaveProperty('defaultScale')
    expect(capturedTextViewerProps).not.toHaveProperty('onScaleChange')
    expect(capturedTextViewerProps).not.toHaveProperty('minScale')
    expect(capturedTextViewerProps).not.toHaveProperty('maxScale')
    expect(capturedTextViewerProps).not.toHaveProperty('tool')
    expect(capturedTextViewerProps).not.toHaveProperty('selectedTool')
    expect(capturedTextViewerProps).not.toHaveProperty('rects')
    expect(capturedTextViewerProps).not.toHaveProperty('selectedRectId')
    expect(capturedTextViewerProps).not.toHaveProperty('onCreateRect')
    expect(capturedTextViewerProps).not.toHaveProperty('onSelectRect')
    expect(capturedTextViewerProps).not.toHaveProperty('onUpdateRect')
    expect(capturedTextViewerProps.showPageBrowser).toBe(true)
    expect(capturedTextViewerProps.onPageBrowserClose).toBe(onPageBrowserClose)
    expect(capturedTextViewerProps.themeColor).toBe('#123456')
    expect(capturedTextViewerProps).not.toHaveProperty('paintingTool')
    expect(capturedTextViewerProps).not.toHaveProperty('drawingStrokeColor')
    expect(capturedTextViewerProps).not.toHaveProperty('pagePaintings')
    expect(capturedTextViewerProps).not.toHaveProperty('onPagePaintingChange')
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
  })

  it('renderMode text prefers canonical ranges from ReaderData', () => {
    const flatRange = makeReaderRange('flat-highlight', 'flat')
    const dataRange = makeReaderRange('data-highlight', 'data')
    const doc = makeDocument({ pages: [makePage(1)] })

    render(
      <Reader
        document={doc}
        renderMode='text'
        data={{ ranges: [dataRange] }}
        ranges={[flatRange]}
      />
    )

    expect(capturedTextViewerProps.ranges).toEqual([dataRange])
  })

  it('renderMode text restores and debounces reading progress through ReaderData', () => {
    // Given: Reader receives a persisted Text page together with other canonical data.
    const onDataChange = vi.fn()
    const anchor = {
      pageNumber: 3,
      textId: 'page-3-paragraph',
      text: 'Page three paragraph',
      offset: 12
    }
    const data = {
      hiddenPages: [2],
      textReadingProgress: { currentPageNumber: 3, anchor }
    } as const
    const doc = makeDocument({ pages: [makePage(1), makePage(2), makePage(3)] })
    render(
      <Reader
        document={doc}
        renderMode='text'
        data={data}
        onDataChange={onDataChange}
      />
    )

    // When: Text Mode reports that the reader reached a new page.
    expect(capturedTextViewerProps.textReadingProgress).toBe(
      data.textReadingProgress
    )
    const onProgressChange = capturedTextViewerProps.onTextReadingProgressChange
    if (typeof onProgressChange !== 'function') {
      throw new TypeError('Expected Text reading progress callback')
    }
    const nextAnchor = {
      pageNumber: 1,
      textId: 'page-1-paragraph',
      text: 'Page one paragraph',
      offset: 4
    }
    vi.useFakeTimers()
    try {
      onProgressChange({ currentPageNumber: 2 })
      act(() => vi.advanceTimersByTime(99))
      expect(onDataChange).not.toHaveBeenCalled()

      onProgressChange({ currentPageNumber: 1, anchor: nextAnchor })
      act(() => vi.advanceTimersByTime(99))
      expect(onDataChange).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))

      // Then: Reader 仅合并静止前的最后位置，且不丢失其他持久化字段。
      expect(onDataChange).toHaveBeenCalledTimes(1)
      expect(onDataChange).toHaveBeenCalledWith({
        hiddenPages: [2],
        textReadingProgress: { currentPageNumber: 1, anchor: nextAnchor }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('native layout debounces frequent completed-scroll progress reports for 100ms', () => {
    // Given: 原生版面缩放由 ReaderData 控制，并保留其他文档数据。
    const onDataChange = vi.fn()
    const progress = {
      pageNumber: 2,
      verticalPercentage: 37.5
    } as const
    const data = { hiddenPages: [3], layoutReadingProgress: progress } as const
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(
      <Reader
        document={doc}
        useVirtualPaper={false}
        data={data}
        onDataChange={onDataChange}
      />
    )

    // When: 连续两次滚动结束报告不同位置，间隔不足 100ms。
    expect(capturedViewerProps.layoutReadingProgress).toBe(progress)
    const onProgressChange = capturedViewerProps.onLayoutReadingProgressChange
    if (typeof onProgressChange !== 'function') {
      throw new TypeError('Expected native layout reading progress callback')
    }
    const nextProgress = {
      pageNumber: 1,
      textId: 'page-1-paragraph',
      text: 'Page one paragraph',
      offset: 4
    } as const
    vi.useFakeTimers()
    try {
      onProgressChange({ pageNumber: 1, verticalPercentage: 25 })
      act(() => vi.advanceTimersByTime(99))
      expect(onDataChange).not.toHaveBeenCalled()

      onProgressChange(nextProgress)
      act(() => vi.advanceTimersByTime(99))
      expect(onDataChange).not.toHaveBeenCalled()
      act(() => vi.advanceTimersByTime(1))

      // Then: Reader 仅发布静止前的最后一个精确位置，且不丢失其他字段。
      expect(onDataChange).toHaveBeenCalledTimes(1)
      expect(onDataChange).toHaveBeenCalledWith({
        hiddenPages: [3],
        layoutReadingProgress: nextProgress
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('native layout progress flush preserves data received during debounce', () => {
    // Given: 一次原生版面进度已排队，但父级随后传入了更新后的书签数据。
    const onDataChange = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    const view = render(
      <Reader
        document={doc}
        useVirtualPaper={false}
        data={{ hiddenPages: [2] }}
        onDataChange={onDataChange}
      />
    )
    const onProgressChange = capturedViewerProps.onLayoutReadingProgressChange
    if (typeof onProgressChange !== 'function') {
      throw new TypeError('Expected native layout reading progress callback')
    }
    const nextProgress = {
      pageNumber: 1,
      verticalPercentage: 42
    } as const
    const addedBookmark = {
      pageNumber: 1,
      textId: 'new-bookmark',
      text: 'New bookmark',
      offset: 2
    } as const

    vi.useFakeTimers()
    try {
      // When: 进度排队后，受控 ReaderData 在 100ms 窗口内更新。
      onProgressChange(nextProgress)
      view.rerender(
        <Reader
          document={doc}
          useVirtualPaper={false}
          data={{ hiddenPages: [3], bookmarks: [addedBookmark] }}
          onDataChange={onDataChange}
        />
      )
      act(() => vi.advanceTimersByTime(100))

      // Then: flush 将进度合并到同一文档的最新数据，而不是回放旧快照。
      expect(onDataChange).toHaveBeenCalledTimes(1)
      expect(onDataChange).toHaveBeenCalledWith({
        hiddenPages: [3],
        bookmarks: [addedBookmark],
        layoutReadingProgress: nextProgress
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('native layout saves every second when completed-scroll reports stay frequent', () => {
    // Given: Reader 已挂载，滚动结束报告持续变化且始终没有 100ms 静止期。
    const onDataChange = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(
      <Reader
        document={doc}
        useVirtualPaper={false}
        data={{ hiddenPages: [3] }}
        onDataChange={onDataChange}
      />
    )
    const onProgressChange = capturedViewerProps.onLayoutReadingProgressChange
    if (typeof onProgressChange !== 'function') {
      throw new TypeError('Expected native layout reading progress callback')
    }

    vi.useFakeTimers()
    try {
      // When: 每 50ms 上报一次，连续跨过两个 1 秒保存周期。
      for (let index = 1; index <= 40; index += 1) {
        onProgressChange({
          pageNumber: 1,
          verticalPercentage: index
        })
        act(() => vi.advanceTimersByTime(50))

        if (index === 19) expect(onDataChange).not.toHaveBeenCalled()
        if (index === 20) {
          expect(onDataChange).toHaveBeenNthCalledWith(1, {
            hiddenPages: [3],
            layoutReadingProgress: {
              pageNumber: 1,
              verticalPercentage: 20
            }
          })
        }
      }

      // Then: 连续变化不会饿死保存，每秒都保存该时刻的最新位置。
      expect(onDataChange).toHaveBeenCalledTimes(2)
      expect(onDataChange).toHaveBeenNthCalledWith(2, {
        hiddenPages: [3],
        layoutReadingProgress: {
          pageNumber: 1,
          verticalPercentage: 40
        }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands the Layout visual top anchor to Text Mode when switching', async () => {
    // Given: Layout 当前视觉第一行与 Text 之前持久化的位置不同。
    const layoutAnchor = {
      pageNumber: 2,
      textId: 'page-2-visual-top',
      text: 'Current visual top line',
      offset: 24
    }
    const staleTextAnchor = {
      pageNumber: 1,
      textId: 'page-1-stale',
      text: 'Previously persisted line',
      offset: 3
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(
      <Reader
        document={doc}
        data={{
          textReadingProgress: {
            currentPageNumber: 1,
            anchor: staleTextAnchor
          }
        }}
      />
    )
    const onLayoutTextAnchorChange = capturedViewerProps.onTextAnchorChange
    if (typeof onLayoutTextAnchorChange !== 'function') {
      throw new TypeError('Expected Layout text anchor callback')
    }
    act(() => onLayoutTextAnchorChange(layoutAnchor))

    // When: 用户从 Layout 切换到 Text Mode。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))

    // Then: Text 的既有恢复链路收到当前视觉第一行，而不是旧持久化位置。
    await waitFor(() => {
      expect(capturedTextViewerProps.textReadingProgress).toEqual({
        currentPageNumber: 2,
        anchor: layoutAnchor
      })
    })
  })

  it('captures the latest Layout anchor synchronously when switching before scroll reporting', async () => {
    // Given: 滚动后的异步上报尚未执行，Reader 仍保存着旧锚点。
    const staleAnchor = {
      pageNumber: 1,
      textId: 'page-1-before-scroll-report',
      text: 'Position before the pending scroll frame',
      offset: 2
    }
    const latestAnchor = {
      pageNumber: 2,
      textId: 'page-2-current-visual-top',
      text: 'Current visual top before mode switch',
      offset: 28
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(<Reader document={doc} />)
    const onLayoutTextAnchorChange = capturedViewerProps.onTextAnchorChange
    if (typeof onLayoutTextAnchorChange !== 'function') {
      throw new TypeError('Expected Layout text anchor callback')
    }
    act(() => onLayoutTextAnchorChange(staleAnchor))

    const readingPositionRef = capturedViewerProps.readingPositionRef
    if (typeof readingPositionRef !== 'function') {
      throw new TypeError('Expected Layout reading position ref')
    }
    // When: 用户在滚动 rAF 上报前立即切换到 Text Mode。
    act(() => {
      readingPositionRef({
        captureTextAnchor: () => latestAnchor
      })
      fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    })

    // Then: 切换主动读取保存格式一致的实时锚点，而不是沿用旧回调值。
    await waitFor(() => {
      expect(capturedTextViewerProps.textReadingProgress).toEqual({
        currentPageNumber: 2,
        anchor: latestAnchor
      })
    })
  })

  it('hands the Text visual top anchor to Layout Mode when switching', async () => {
    // Given: Reader 先进入 Text Mode，且 Layout 保存着旧 transform 与旧锚点。
    const staleLayoutAnchor = {
      pageNumber: 1,
      textId: 'page-1-stale-layout',
      text: 'Previously persisted layout line',
      offset: 5
    }
    const textAnchor = {
      pageNumber: 2,
      textId: 'page-2-visual-top',
      text: 'Current text visual top line',
      offset: 30
    }
    const virtualPaper = {
      x: 120,
      y: 360,
      scale: 1.5,
      anchor: staleLayoutAnchor
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(<Reader document={doc} data={{ virtualPaper }} />)
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    await waitFor(() => {
      expect(
        screen.getByTestId('intermediate-document-text-viewer')
      ).toBeInTheDocument()
    })
    const onTextAnchorChange = capturedTextViewerProps.onTextAnchorChange
    if (typeof onTextAnchorChange !== 'function') {
      throw new TypeError('Expected Text Mode anchor callback')
    }
    act(() => onTextAnchorChange(textAnchor))

    // When: 用户从 Text 切回 Layout Mode。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))

    // Then: Layout 保留缩放信息，但以 Text 的视觉第一行作为恢复锚点。
    await waitFor(() => {
      expect(capturedViewerProps.defaultVirtualPaperTransform).toEqual({
        ...virtualPaper,
        anchor: textAnchor
      })
    })
  })

  it('captures the latest Text anchor synchronously when switching before scroll reporting', async () => {
    // Given: Text 滚动后的异步上报尚未执行，Reader 仍保存着旧锚点。
    const staleAnchor = {
      pageNumber: 1,
      textId: 'page-1-before-text-scroll-report',
      text: 'Text position before the pending scroll frame',
      offset: 4
    }
    const latestAnchor = {
      pageNumber: 2,
      textId: 'page-2-current-text-visual-top',
      text: 'Current Text visual top before mode switch',
      offset: 32
    }
    const virtualPaper = { x: 80, y: 240, scale: 1.25 }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(<Reader document={doc} data={{ virtualPaper }} />)
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    await waitFor(() => {
      expect(
        screen.getByTestId('intermediate-document-text-viewer')
      ).toBeInTheDocument()
    })
    const onTextAnchorChange = capturedTextViewerProps.onTextAnchorChange
    if (typeof onTextAnchorChange !== 'function') {
      throw new TypeError('Expected Text Mode anchor callback')
    }
    act(() => onTextAnchorChange(staleAnchor))
    const readingPositionRef = capturedTextViewerProps.readingPositionRef
    if (typeof readingPositionRef !== 'function') {
      throw new TypeError('Expected Text reading position ref')
    }

    // When: 用户在滚动 rAF 上报前立即切回 Layout Mode。
    act(() => {
      readingPositionRef({
        captureTextAnchor: () => latestAnchor
      })
      fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    })

    // Then: Layout 保留 transform，同时使用 Text 当前视觉顶部的规范锚点。
    await waitFor(() => {
      expect(capturedViewerProps.defaultVirtualPaperTransform).toEqual({
        ...virtualPaper,
        anchor: latestAnchor
      })
    })
  })

  it('captures controlled Text position during unmount and restores native Layout', async () => {
    // Given: 外部控制 Text Mode，滚动回调尚未上报当前可见锚点。
    const staleAnchor = {
      pageNumber: 1,
      textId: 'page-1-controlled-stale',
      text: 'Controlled stale text position',
      offset: 6
    }
    const latestAnchor = {
      pageNumber: 2,
      textId: 'page-2-controlled-current',
      text: 'Controlled current visual top',
      offset: 36
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    const { rerender } = render(
      <Reader document={doc} renderMode='text' useVirtualPaper={false} />
    )
    const onTextAnchorChange = capturedTextViewerProps.onTextAnchorChange
    const readingPositionRef = capturedTextViewerProps.readingPositionRef
    if (typeof onTextAnchorChange !== 'function') {
      throw new TypeError('Expected Text Mode anchor callback')
    }
    if (typeof readingPositionRef !== 'function') {
      throw new TypeError('Expected Text reading position ref')
    }
    act(() => {
      onTextAnchorChange(staleAnchor)
      readingPositionRef({ captureTextAnchor: () => latestAnchor })
    })

    // When: 宿主直接切换受控模式，旧 Text viewer 在提交阶段卸载。
    rerender(
      <Reader document={doc} renderMode='layout' useVirtualPaper={false} />
    )

    // Then: native Layout 消费卸载前同步捕获的规范锚点。
    await waitFor(() => {
      expect(capturedViewerProps.layoutReadingProgress).toEqual(latestAnchor)
    })
  })

  it('uses externally navigated Text progress for a controlled mode switch', async () => {
    // Given: Text Mode 先上报旧锚点，随后宿主把阅读位置导航到另一个锚点。
    const oldAnchor = {
      pageNumber: 1,
      textId: 'page-1-old-text-position',
      text: 'Old text position',
      offset: 4
    }
    const navigatedAnchor = {
      pageNumber: 2,
      textId: 'page-2-external-navigation',
      text: 'Externally navigated position',
      offset: 18
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    const { rerender } = render(
      <Reader
        document={doc}
        renderMode='text'
        data={{
          textReadingProgress: { currentPageNumber: 1, anchor: oldAnchor }
        }}
      />
    )
    const onTextAnchorChange = capturedTextViewerProps.onTextAnchorChange
    if (typeof onTextAnchorChange !== 'function') {
      throw new TypeError('Expected Text Mode anchor callback')
    }
    act(() => onTextAnchorChange(oldAnchor))
    rerender(
      <Reader
        document={doc}
        renderMode='text'
        data={{
          textReadingProgress: {
            currentPageNumber: 2,
            anchor: navigatedAnchor
          }
        }}
      />
    )

    // When: 宿主直接把受控模式切换为 Layout。
    rerender(
      <Reader
        document={doc}
        renderMode='layout'
        data={{
          textReadingProgress: {
            currentPageNumber: 2,
            anchor: navigatedAnchor
          }
        }}
      />
    )

    // Then: Layout 使用宿主的新位置，而不是 Viewer 之前上报的旧锚点。
    await waitFor(() => {
      expect(capturedViewerProps.defaultVirtualPaperTransform).toMatchObject({
        anchor: navigatedAnchor
      })
    })
  })

  it('does not revive an invalidated Text handoff when persisted progress returns to its old key', async () => {
    // Given: Layout 切换到 Text 时，临时交接覆盖了 Text 原先的持久化位置。
    const layoutAnchor = {
      pageNumber: 2,
      textId: 'page-2-layout-handoff',
      text: 'Layout handoff position',
      offset: 24
    }
    const oldPersistedAnchor = {
      pageNumber: 1,
      textId: 'page-1-old-persisted',
      text: 'Old persisted text position',
      offset: 3
    }
    const externalAnchor = {
      pageNumber: 2,
      textId: 'page-2-external-text-position',
      text: 'External text position',
      offset: 40
    }
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    const { rerender } = render(
      <Reader
        document={doc}
        data={{
          textReadingProgress: {
            currentPageNumber: 1,
            anchor: oldPersistedAnchor
          }
        }}
      />
    )
    const onLayoutTextAnchorChange = capturedViewerProps.onTextAnchorChange
    if (typeof onLayoutTextAnchorChange !== 'function') {
      throw new TypeError('Expected Layout text anchor callback')
    }
    act(() => onLayoutTextAnchorChange(layoutAnchor))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))
    await waitFor(() => {
      expect(capturedTextViewerProps.textReadingProgress).toMatchObject({
        anchor: layoutAnchor
      })
    })

    // When: 宿主先导航到新位置，再合法地返回原持久化 key。
    rerender(
      <Reader
        document={doc}
        data={{
          textReadingProgress: {
            currentPageNumber: 2,
            anchor: externalAnchor
          }
        }}
      />
    )
    await waitFor(() => {
      expect(capturedTextViewerProps.textReadingProgress).toMatchObject({
        anchor: externalAnchor
      })
    })
    rerender(
      <Reader
        document={doc}
        data={{
          textReadingProgress: {
            currentPageNumber: 1,
            anchor: oldPersistedAnchor
          }
        }}
      />
    )

    // Then: 已失效的 Layout 交接不会复活并覆盖宿主位置。
    await waitFor(() => {
      expect(capturedTextViewerProps.textReadingProgress).toMatchObject({
        anchor: oldPersistedAnchor
      })
    })
  })

  it('toggles precise text bookmarks through ReaderData', () => {
    // Given: ReaderData already contains one precise text bookmark.
    const bookmark: ReaderBookmark = {
      pageNumber: 1,
      textId: 'page-1-paragraph',
      text: 'Saved paragraph',
      offset: 8
    }
    const onDataChange = vi.fn()
    const data = { hiddenPages: [2], bookmarks: [bookmark] } as const
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(
      <Reader
        document={doc}
        renderMode='text'
        data={data}
        onDataChange={onDataChange}
      />
    )

    // When: the text viewer toggles the same anchor.
    const onToggleBookmark = capturedTextViewerProps.onToggleBookmark
    if (typeof onToggleBookmark !== 'function') {
      throw new TypeError('Expected precise bookmark callback')
    }
    onToggleBookmark(bookmark)

    // Then: Reader removes only that anchor and preserves unrelated data.
    expect(capturedTextViewerProps.bookmarks).toBe(data.bookmarks)
    expect(onDataChange).toHaveBeenCalledWith({
      hiddenPages: [2],
      bookmarks: []
    })
  })

  it('toggles a textless page-position bookmark through ReaderData', () => {
    // Given: ReaderData has no bookmarks and layout mode exposes its toggle callback.
    const bookmark: ReaderBookmark = {
      pageNumber: 2,
      verticalPercentage: 41
    }
    const onDataChange = vi.fn()
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    render(
      <Reader
        document={doc}
        data={{ bookmarks: [] }}
        onDataChange={onDataChange}
      />
    )

    // When: the layout viewer toggles a textless page position.
    const onToggleBookmark = capturedViewerProps.onToggleBookmark
    if (typeof onToggleBookmark !== 'function') {
      throw new TypeError('Expected precise bookmark callback')
    }
    onToggleBookmark(bookmark)

    // Then: Reader persists the page number and vertical percentage unchanged.
    expect(onDataChange).toHaveBeenCalledWith({ bookmarks: [bookmark] })
  })

  it('renderMode text provides the default selection confirmation popover', () => {
    // Given: 文本模式没有传入自定义 selection popover。
    const { document } = makeLazyDocument(1)
    render(<Reader document={document} renderMode='text' />)

    // When: Reader 创建默认 selection popover。
    render(capturedTextViewerProps.selectionPopover as React.ReactElement)

    // Then: 用户能够看到确认高亮和颜色设置入口。
    expect(screen.getByRole('button', { name: '高亮' })).toBeInTheDocument()
    expect(screen.getByLabelText('Highlight color')).toBeInTheDocument()
  })

  it('renderMode text renders for a runtime (lazy) document', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} renderMode='text' />)

    expect(
      screen.getByTestId('intermediate-document-text-viewer')
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('virtual-paper-wrapper')
    ).not.toBeInTheDocument()
  })

  it('compile-time: renderMode satisfies ReaderProps as ReaderRenderMode', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      renderMode: 'text' as ReaderRenderMode
    }
    expect(props.renderMode).toBe('text')
  })
})

describe('Reader file upload', () => {
  it('shows upload zone when no document is provided', () => {
    render(<Reader document={null} />)

    const uploadZone = screen.getByTestId('upload-zone')
    const fileInput = screen.getByTestId('file-input')

    expect(uploadZone).toBeInTheDocument()
    expect(uploadZone).toHaveTextContent('Click or drag document to upload')
    expect(uploadZone).toHaveTextContent(
      'Supports PDF, TXT, DOCX, Markdown, and image files'
    )
    expect(fileInput.getAttribute('accept')).toBe(SUPPORTED_UPLOAD_ACCEPT)
  })

  it('does not show upload zone when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const uploadZone = screen.queryByTestId('upload-zone')

    expect(uploadZone).not.toBeInTheDocument()
  })

  it('triggers onFileUpload callback when file is selected', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    expect(onFileUpload).toHaveBeenCalledWith(mockFile)
  })

  it('displays file info after upload', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024 * 100)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
    expect(fileInfo).toHaveTextContent('test.pdf')
    expect(fileInfo).toHaveTextContent('100.0 KB')
  })

  it('displays file name and size correctly for small files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('small.pdf', 500)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('500 B')
  })

  it('displays file name and size correctly for large files', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('large.pdf', 2 * 1024 * 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('2.0 MB')
  })

  it('has upload another button after file is uploaded', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeInTheDocument()
    expect(uploadAnotherBtn).toHaveTextContent('Upload Another')
  })

  it('clicking upload another button works without errors', async () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 1024)

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const uploadAnotherBtn = screen.getByTestId('upload-another-btn')
    expect(uploadAnotherBtn).toBeEnabled()

    await userEvent.click(uploadAnotherBtn)

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toBeInTheDocument()
  })

  it('shows unknown type for files without a MIME type', () => {
    const onFileUpload = vi.fn()
    render(<Reader document={null} onFileUpload={onFileUpload} />)

    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('notype-file', 1024, '')

    fireEvent.change(fileInput, { target: { files: [mockFile] } })

    const fileInfo = screen.getByTestId('file-info')
    expect(fileInfo).toHaveTextContent('unknown type')
    expect(fileInfo).not.toHaveTextContent('application/pdf')
  })

  it('exports SUPPORTED_UPLOAD_COPY with expected value', () => {
    expect(SUPPORTED_UPLOAD_COPY).toBe('PDF, TXT, DOCX, Markdown, and image')
  })

  it('hides file info when document is provided', () => {
    render(<Reader document={makeDocument()} />)

    const fileInfo = screen.queryByTestId('file-info')

    expect(fileInfo).not.toBeInTheDocument()
  })
})

describe('Reader prop forwarding', () => {
  beforeEach(() => {
    capturedViewerProps = {}
    clearSelectionProps()
  })

  it('renders IntermediateDocumentViewer when ocr prop is passed', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} ocr />)
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('forwards extraOCR to the layout viewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const extraOCR = vi.fn()

    render(<Reader document={doc} extraOCR={extraOCR} />)

    expect(capturedViewerProps.extraOCR).toBe(extraOCR)
  })

  it('renders IntermediateDocumentViewer when onTextSelectionEnd is passed', () => {
    const onTextSelectionEnd = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} onTextSelectionEnd={onTextSelectionEnd} />)
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('renders IntermediateDocumentViewer when onTextSelectionChange is passed', () => {
    const onTextSelectionChange = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(
      <Reader document={doc} onTextSelectionChange={onTextSelectionChange} />
    )
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('forwards onTextSelectionEnd so viewer calls it on mouseup', async () => {
    const onTextSelectionEnd = vi.fn()
    const { document } = makeLazyDocument(1)
    render(
      <Reader document={document} onTextSelectionEnd={onTextSelectionEnd} />
    )

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement

    const selection = {
      isCollapsed: false,
      anchorNode: textSpan,
      focusNode: textSpan,
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => node === textSpan
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(onTextSelectionEnd).toHaveBeenCalledTimes(1)
    const [text, detail] = onTextSelectionEnd.mock.calls[0]
    expect(text.id).toBe('text-1')
    expect(detail.selectedText).toBe('Page 1 text')
  })

  it('forwards onSelectText so viewer calls it on mouseup', async () => {
    const onSelectText = vi.fn()
    const { document } = makeLazyDocument(1)
    render(<Reader document={document} onSelectText={onSelectText} />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement
    const textNode = textSpan.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected rendered text span to contain a text node')
    }
    const range = globalThis.document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 11)

    const selection = {
      isCollapsed: false,
      anchorNode: textNode,
      anchorOffset: 0,
      focusNode: textNode,
      focusOffset: 11,
      rangeCount: 1,
      getRangeAt: (index: number) => {
        if (index !== 0) {
          throw new Error('Selection mock only contains one range')
        }
        return range
      },
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => range.intersectsNode(node)
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    viewerRoot.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(onSelectText).toHaveBeenCalledTimes(1)
    const [nativeSelection, segments, extractedText] =
      onSelectText.mock.calls[0]
    expect(nativeSelection).toBe(selection)
    expect(extractedText).toBe('Page 1 text')
    expect(extractedText).toBe(
      segments
        .map((segment: { selectedText: string }) => segment.selectedText)
        .join('')
    )
    expect(segments[0]).toMatchObject({
      id: 'text-1',
      selectedText: 'Page 1 text',
      startCharIndex: 0,
      endCharIndex: 11
    })
  })

  it('forwards onTextSelectionChange so viewer calls it on selection', async () => {
    const onTextSelectionChange = vi.fn()
    const { document } = makeLazyDocument(1)
    render(
      <Reader
        document={document}
        onTextSelectionChange={onTextSelectionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    const viewerRoot = screen.getByTestId('intermediate-document-viewer')
    const textSpan = viewerRoot.querySelector(
      '[data-text-id="text-1"]'
    ) as HTMLElement

    const selection = {
      isCollapsed: false,
      anchorNode: textSpan,
      focusNode: textSpan,
      toString: () => 'Page 1 text',
      containsNode: (node: Node) => node === textSpan
    } as unknown as Selection

    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    globalThis.document.dispatchEvent(new Event('selectionchange'))

    expect(onTextSelectionChange).toHaveBeenCalledTimes(1)
    const [text, detail] = onTextSelectionChange.mock.calls[0]
    expect(text.id).toBe('text-1')
    expect(detail.selectedText).toBe('Page 1 text')
  })

  it('forwards ocr prop so viewer attempts OCR on visible pages with thumbnails', async () => {
    const { ImageParser } = await import('@hamster-note/image-parser')
    const encodeSpy = vi.mocked(ImageParser.encode)
    encodeSpy.mockClear()

    const { document } = makeLazyDocument(1)
    const pageWithThumbnail = {
      getContent: vi.fn(async () => [makeText('text-1', 'Page 1 text')]),
      thumbnail: 'data:image/png;base64,abc123'
    }
    vi.mocked(document.getPageByPageNumber).mockResolvedValue(
      pageWithThumbnail as unknown as Awaited<
        ReturnType<typeof document.getPageByPageNumber>
      >
    )

    render(<Reader document={document} ocr />)

    await waitFor(() => {
      expect(screen.getByText('Page 1 text')).toBeInTheDocument()
    })

    intersectionObserverMock.trigger(screen.getByTestId('intermediate-page-1'))

    await waitFor(() => {
      expect(encodeSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('forwards pageRange to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(5)

    render(<Reader document={document} pageRange={{ start: 2, end: 4 }} />)

    // Pages outside range should not exist
    expect(screen.queryByTestId('intermediate-page-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('intermediate-page-5')).not.toBeInTheDocument()

    // Pages within range should exist
    expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-4')).toBeInTheDocument()
  })

  it('renders all pages when pageRange is not provided', () => {
    const { document } = makeLazyDocument(3)

    render(<Reader document={document} />)

    expect(screen.getByTestId('intermediate-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('intermediate-page-3')).toBeInTheDocument()
  })

  it('forwards interactionMode="stylus" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} interactionMode='stylus' />)
    expect(capturedViewerProps.interactionMode).toBe('stylus')
  })

  it('forwards touchPanMode="two-finger" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} touchPanMode='two-finger' />)
    expect(capturedViewerProps.touchPanMode).toBe('two-finger')
  })

  it('defaults interactionMode to undefined when not provided (viewer defaults to "default")', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} />)
    expect(capturedViewerProps.interactionMode).toBeUndefined()
  })

  it('forwards overlayRectType="percent" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} {...{ overlayRectType: 'percent' }} />)
    expect(capturedViewerProps.overlayRectType).toBe('percent')
  })

  it('forwards overlayRectType="px" to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    render(<Reader document={doc} {...{ overlayRectType: 'px' }} />)
    expect(capturedViewerProps.overlayRectType).toBe('px')
  })

  it('forwards Reader selection, scale, and lazy props to IntermediateDocumentViewer unchanged', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const ranges: ReaderSelectionRange[] = [
      {
        id: 'forwarded-range',
        text: 'Forwarded range',
        start: { selectionId: 'page-1', offset: 0 },
        end: { selectionId: 'page-1', offset: 11 },
        createdAt: 10,
        overlayRectType: 'percent',
        rectsBySelectionId: {
          'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
        }
      }
    ]

    render(
      <Reader
        document={doc}
        selectionRef={selectionRef}
        ranges={ranges}
        selectedRangeId='forwarded-range'
        overlayRectType='percent'
        initialLoadedPages={2}
        pageLoadConcurrency={4}
        pageLoadEnterDelayMs={250}
        pageUnloadDelayMs={3000}
        showSelectionMagnifier={true}
        onScaleChange={onScaleChange}
      />
    )

    expect(capturedViewerProps.selectionRef).toBe(selectionRef)
    expect(capturedViewerProps.ranges).toBe(ranges)
    expect(capturedViewerProps.selectedRangeId).toBe('forwarded-range')
    expect(capturedViewerProps.overlayRectType).toBe('percent')
    expect(capturedViewerProps.initialLoadedPages).toBe(2)
    expect(capturedViewerProps.pageLoadConcurrency).toBe(4)
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBe(250)
    expect(capturedViewerProps.pageUnloadDelayMs).toBe(3000)
    expect(capturedViewerProps.showSelectionMagnifier).toBe(true)
    expect(capturedViewerProps.onScaleChange).toBe(onScaleChange)
  })

  it('prefers unified data fields over legacy flat props', () => {
    // Given: unified data and legacy flat props intentionally contain different values.
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })
    const dataRange = makeReaderRange('data-range', 'Data range')
    const legacyRange = makeReaderRange('legacy-range', 'Legacy range')
    const dataRect: ReaderSelectionRectangle = {
      id: 'data-rect',
      createdAt: 1,
      overlayRectType: 'percent',
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      selectionId: 'page-1',
      rect: { x: 10, y: 20, width: 20, height: 20 }
    }
    const dataPaintings: Record<string, DrawingValue> = {
      'page-1': { strokes: [] }
    }
    const edgeCrop = {
      all: { top: 0.1, right: 0.2, bottom: 0.3, left: 0.05 },
      pages: { 'page-2': { left: 0.25 } }
    }
    const virtualPaper = { x: 24, y: -36, scale: 1.5 }
    const bookmarks: readonly ReaderBookmark[] = [
      {
        pageNumber: 2,
        textId: 'data-bookmark',
        text: 'Data bookmark',
        offset: 14
      }
    ]

    // When: Reader receives the new unified data prop.
    render(
      <Reader
        document={doc}
        data={{
          edgeCrop,
          hiddenPages: [2, 'page-3'],
          ranges: [dataRange],
          rects: [dataRect],
          pagePaintings: dataPaintings,
          virtualPaper,
          bookmarks,
          bookmarkedPageNumbers: [2]
        }}
        ranges={[legacyRange]}
        rects={[]}
        pagePaintings={{}}
        scale={3}
        bookmarkedPageNumbers={[1]}
      />
    )

    // Then: every migrated field forwarded to the layout viewer comes from data.
    expect(capturedViewerProps.ranges).toEqual([dataRange])
    expect(capturedViewerProps.rects).toEqual([dataRect])
    expect(capturedViewerProps.pagePaintings).toBe(dataPaintings)
    expect(capturedViewerProps.bookmarkedPageNumbers).toEqual([2])
    expect(capturedViewerProps.bookmarks).toBe(bookmarks)
    expect(capturedViewerProps.hiddenPages).toEqual([2, 'page-3'])
    expect(capturedViewerProps.edgeCrop).toBe(edgeCrop)
    expect(capturedViewerProps.defaultVirtualPaperTransform).toBe(virtualPaper)
    expect(capturedViewerProps.scale).toBeUndefined()
  })

  it('keeps legacy-only bookmark hosts on the page bookmark contract', () => {
    // Given: a host controls only deprecated page-number bookmarks.
    const doc = makeDocument({ pages: [makePage(1)] })
    const onTogglePageBookmark = vi.fn()

    // When: Reader forwards bookmark capabilities to the layout viewer.
    render(
      <Reader
        document={doc}
        bookmarkedPageNumbers={[1]}
        onTogglePageBookmark={onTogglePageBookmark}
      />
    )

    // Then: Reader must not synthesize a precise bookmark capability.
    expect(capturedViewerProps.bookmarkedPageNumbers).toEqual([1])
    expect(capturedViewerProps.onTogglePageBookmark).toBe(onTogglePageBookmark)
    expect(capturedViewerProps.bookmarks).toBeUndefined()
    expect(capturedViewerProps.onToggleBookmark).toBeUndefined()
  })

  it('enables precise bookmarks for unified ReaderData hosts', () => {
    // Given: the unified host persists data without legacy bookmark props.
    const doc = makeDocument({ pages: [makePage(1)] })
    const onDataChange = vi.fn()

    // When: Reader receives the unified data change channel.
    render(<Reader document={doc} data={{}} onDataChange={onDataChange} />)

    // Then: the viewer receives the precise toggle capability used by ReaderData.
    expect(capturedViewerProps.bookmarks).toBeUndefined()
    expect(capturedViewerProps.onToggleBookmark).toEqual(expect.any(Function))
  })

  it('prefers persisted render mode and selected tool from ReaderData', () => {
    // Given: 持久化 data 与旧版扁平 props 提供不同值。
    const doc = makeDocument({ pages: [makePage(1)] })

    // When: Reader 解析统一数据入口。
    render(
      <Reader
        document={doc}
        data={{ renderMode: 'layout', selectedTool: 'rect-selection' }}
        renderMode='text'
        selectedTool='text-selection'
      />
    )

    // Then: data 按统一入口约定覆盖旧版 props。
    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(capturedViewerProps.selectedTool).toBe('rect-selection')
  })

  it('publishes render mode and selected tool changes through ReaderData', () => {
    // Given: 宿主通过统一数据入口控制模式和工具，并保留其他持久化字段。
    const doc = makeDocument({ pages: [makePage(1)] })
    const onDataChange = vi.fn()
    const data = {
      hiddenPages: [2],
      renderMode: 'layout',
      selectedTool: 'text-selection'
    } as const
    render(<Reader document={doc} data={data} onDataChange={onDataChange} />)

    // When: 用户分别切换页面工具与渲染模式。
    fireEvent.click(screen.getByTestId('tool-bottom-bar-rect-selection'))
    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))

    // Then: 每次变化都通过 onDataChange 发布完整的新 ReaderData。
    expect(onDataChange).toHaveBeenNthCalledWith(1, {
      ...data,
      selectedTool: 'rect-selection'
    })
    expect(onDataChange).toHaveBeenNthCalledWith(2, {
      ...data,
      renderMode: 'text'
    })
  })

  it('keeps precise bookmark data read-only without a precise write channel', () => {
    // Given: a host supplies precise bookmark data but only a legacy page toggle.
    const doc = makeDocument({ pages: [makePage(1)] })
    const bookmarks: readonly ReaderBookmark[] = [
      {
        pageNumber: 1,
        textId: 'read-only-bookmark',
        text: 'Read-only bookmark',
        offset: 0
      }
    ]

    // When: Reader forwards the mixed bookmark contract.
    render(
      <Reader
        document={doc}
        bookmarks={bookmarks}
        onTogglePageBookmark={vi.fn()}
      />
    )

    // Then: precise data remains visible without advertising a no-op precise toggle.
    expect(capturedViewerProps.bookmarks).toBe(bookmarks)
    expect(capturedViewerProps.onToggleBookmark).toBeUndefined()
  })

  it('forwards unified hidden pages to text mode', () => {
    // Given: text mode uses the same unified document data as layout mode.
    const doc = makeDocument({ pages: [makePage(1), makePage(2)] })

    // When: page 2 is hidden through Reader data.
    render(
      <Reader document={doc} renderMode='text' data={{ hiddenPages: [2] }} />
    )

    // Then: the text viewer receives the same hidden-page contract.
    expect(capturedTextViewerProps.hiddenPages).toEqual([2])
  })

  it('exposes scrollToRange on the forwarded Reader ref without firing onScaleChange', async () => {
    // Given: Reader owns the public ref and a controlled selected range on page 3.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const range: ReaderSelectionRange = {
      id: 'reader-jump-page-3',
      text: 'Reader jump target',
      start: { selectionId: 'page-3', offset: 0 },
      end: { selectionId: 'page-3', offset: 11 },
      createdAt: 30,
      overlayRectType: 'percent',
      rectsBySelectionId: {
        'page-3': [{ x: 10, y: 20, width: 20, height: 20 }]
      }
    }
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        ranges={[range]}
        selectedRangeId='reader-jump-page-3'
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={2}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 50,
      height: 100
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    expect(publicRef).toEqual({
      highlight: expect.any(Function),
      confirm: expect.any(Function),
      confirmRect: expect.any(Function),
      clear: expect.any(Function),
      scrollToRange: expect.any(Function),
      scrollToRect: expect.any(Function),
      undo: expect.any(Function),
      redo: expect.any(Function),
      canUndo: expect.any(Function),
      canRedo: expect.any(Function),
      getAnnotationHistoryState: expect.any(Function),
      scrollToPosition: expect.any(Function)
    })

    // When: callers jump through Reader's public selectionRef.
    act(() => {
      publicRef.scrollToRange('reader-jump-page-3')
    })

    // Then: VirtualPaper translation changes, scale stays controlled, and no scale callback fires.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(-15px, -704px, 0) scale(2)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()

    // And: selected-range ownership stays with selectedRangeId and the range's start page.
    await screen.findByText('Page 3 text')
    await waitFor(() => {
      expect(
        getAllSelectionProps().some((props) =>
          props.selectionId?.endsWith(':page-3')
        )
      ).toBe(true)
    })
    const pageThreeSelectionProps = getAllSelectionProps().find((props) =>
      props.selectionId?.endsWith(':page-3')
    )
    expect(pageThreeSelectionProps?.linkedData?.selectedRangeId).toBe(
      'reader-jump-page-3'
    )
    expect(
      pageThreeSelectionProps?.linkedData?.items.find(
        (item) => item.id === 'reader-jump-page-3'
      )?.start.selectionId
    ).toBe(pageThreeSelectionProps?.selectionId)
  })

  it('exposes scrollToPosition on the forwarded Reader ref without firing onScaleChange', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={1.5}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 200,
      height: 300
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.scrollToPosition({ x: 120, y: 240 })
    })

    // scrollToPosition treats x/y as content-space scroll offsets.
    // With scale=1.5 and a 200x300 wrapper, the x offset is centered
    // because scaled content width (150px) fits; y is clamped to -360px
    // because scaled content height (723px) is taller than the wrapper.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(25px, -360px, 0) scale(1.5)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()
  })

  it('exposes scrollToRect on the forwarded Reader ref without firing onScaleChange', async () => {
    // Given: Reader owns the public ref and a controlled rect on page 3.
    const selectionRef = createRef<ReaderSelectionRef>()
    const onScaleChange = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        rects={[
          {
            id: 'reader-rect-page-3',
            createdAt: 40,
            overlayRectType: 'percent',
            start: { x: 10, y: 20 },
            end: { x: 30, y: 40 },
            selectionId: 'page-3',
            rect: { x: 10, y: 20, width: 20, height: 20 }
          }
        ]}
        selectedRectId='reader-rect-page-3'
        selectionRef={selectionRef}
        initialLoadedPages={1}
        scale={2}
        onScaleChange={onScaleChange}
      />
    )
    await screen.findByText('Page 1 text')
    mockElementRect(screen.getByTestId('virtual-paper-wrapper'), {
      left: 0,
      top: 0,
      width: 50,
      height: 100
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.scrollToRect('reader-rect-page-3')
    })

    // Then: VirtualPaper translates to center page 3's rect, scale stays controlled.
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      transform: 'translate3d(-15px, -704px, 0) scale(2)'
    })
    expect(onScaleChange).not.toHaveBeenCalled()

    await screen.findByText('Page 3 text')
  })

  it('maps public rect selection ids to runtime ids for Selection and back to public ids on create', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onCreateRect = vi.fn()
    const { document } = makeLazyDocument(3)

    render(
      <Reader
        document={document}
        rects={[
          {
            id: 'reader-rect-page-1',
            createdAt: 40,
            overlayRectType: 'percent',
            start: { x: 10, y: 20 },
            end: { x: 30, y: 40 },
            selectionId: 'page-1',
            rect: { x: 10, y: 20, width: 20, height: 20 }
          }
        ]}
        selectionRef={selectionRef}
        tool='rect'
        onCreateRect={onCreateRect}
        initialLoadedPages={1}
      />
    )

    await screen.findByText('Page 1 text')
    let pageOneSelectionProps = getAllSelectionProps().find((props) =>
      props.selectionId?.endsWith(':page-1')
    )
    await waitFor(() => {
      pageOneSelectionProps = getAllSelectionProps().find((props) =>
        props.selectionId?.endsWith(':page-1')
      )
      expect(pageOneSelectionProps?.rects).toEqual([
        expect.objectContaining({
          selectionId: pageOneSelectionProps?.selectionId
        })
      ])
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    act(() => {
      publicRef.confirmRect()
    })

    expect(onCreateRect).toHaveBeenCalledWith(
      expect.objectContaining({ selectionId: 'page-1' })
    )
  })

  it('forwards autoHighlight, highlightPopover, and highlight comments to IntermediateDocumentViewer', () => {
    const doc = makeDocument({ pages: [makePage(1)] })
    const popover = <div>Test Popover</div>
    const onCommentHighlight = vi.fn(
      async (highlight: ReaderSelectionRange) => highlight
    )
    render(
      <Reader
        document={doc}
        autoHighlight={true}
        highlightPopover={popover}
        onCommentHighlight={onCommentHighlight}
      />
    )
    expect(capturedViewerProps.autoHighlight).toBe(true)
    expect(capturedViewerProps.highlightPopover).toBe(popover)
    expect(capturedViewerProps.onCommentHighlight).toBe(onCommentHighlight)
  })

  it('renders an existing highlight popover from the original range reference', async () => {
    // Given: the selected highlight has its own color, which differs from the
    // current global color used for newly-created highlights.
    const range: ReaderSelectionRange = {
      id: 'colored-highlight',
      text: 'Colored highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 10,
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
      },
      markerStyle: { backgroundColor: '#ff3366' }
    }
    const highlightPopover = vi.fn((highlight: ReaderSelectionRange) => (
      <input
        aria-label='Existing highlight color'
        value={String(highlight.markerStyle?.backgroundColor ?? '#ffee00')}
        readOnly
      />
    ))

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        ranges={[range]}
        selectedRangeId={range.id}
        highlightColor='#ffee00'
        highlightPopover={highlightPopover}
      />
    )

    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()

    // When: Selection mounts the existing-highlight popover.
    render(selectionProps?.popover)

    // Then: the render function receives the exact public range object and can
    // prioritize that highlight's persisted color over the global picker color.
    expect(highlightPopover).toHaveBeenCalledWith(range)
    expect(screen.getByLabelText('Existing highlight color')).toHaveValue(
      '#ff3366'
    )
  })

  it('renders a delete action for the selected rectangle', async () => {
    // Given: an existing rectangle is selected through the public Reader API.
    const user = userEvent.setup()
    const rect = makeReaderRect('selected-rect')
    const onRemoveRect = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        rects={[rect]}
        selectedRectId={rect.id}
        onRemoveRect={onRemoveRect}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)

    // When: the user clicks the selected rectangle's delete action.
    const deleteButton = within(popoverView.container).getByRole('button', {
      name: '删除'
    })
    await user.click(deleteButton)

    // Then: Reader removes the rectangle ID, not a text range ID.
    expect(onRemoveRect).toHaveBeenCalledWith(rect.id)
  })

  it('updates the selected rectangle color from the default popover', async () => {
    // Given: a selected rectangle has its own persisted marker color and opacity.
    const rect: ReaderSelectionRectangle = {
      ...makeReaderRect('colored-rect'),
      markerStyle: { backgroundColor: '#ff3366', opacity: 0.5 }
    }
    const onUpdateRect = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        rects={[rect]}
        selectedRectId={rect.id}
        onUpdateRect={onUpdateRect}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)
    const colorInput = within(popoverView.container).getByLabelText(
      'Highlight color'
    )
    expect(colorInput).toHaveValue('#ff3366')

    // When: the user changes the rectangle color.
    fireEvent.change(colorInput, { target: { value: '#00aa88' } })

    // Then: Reader updates only the color and preserves the remaining marker style.
    expect(onUpdateRect).toHaveBeenCalledWith({
      ...rect,
      markerStyle: { backgroundColor: '#00aa88', opacity: 0.5 }
    })
  })

  it('opens comments from the default rectangle popover', async () => {
    // Given: a selected rectangle and a host-controlled comment flow.
    const user = userEvent.setup()
    const rect = makeReaderRect('commented-rect')
    const onCommentRect = vi.fn(
      async (rectangle: ReaderSelectionRectangle) => rectangle
    )
    const onSelectRect = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        rects={[rect]}
        selectedRectId={rect.id}
        onCommentRect={onCommentRect}
        onSelectRect={onSelectRect}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)

    // When: the user clicks the rectangle comment action.
    await user.click(
      within(popoverView.container).getByRole('button', { name: '评论' })
    )

    // Then: the original rectangle is passed to the host and selection clears.
    expect(onCommentRect).toHaveBeenCalledWith(rect)
    await waitFor(() => expect(onSelectRect).toHaveBeenCalledWith(null))
  })

  it('closes an existing highlight popover after its comment promise resolves', async () => {
    // Given: a selected public highlight and a host-controlled comment flow.
    const user = userEvent.setup()
    const range: ReaderSelectionRange = {
      id: 'commented-highlight',
      text: 'Commented highlight',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 11,
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
      }
    }
    let finishComment: ((highlight: ReaderSelectionRange) => void) | undefined
    const onCommentHighlight = vi.fn(
      (_highlight: ReaderSelectionRange) =>
        new Promise<ReaderSelectionRange>((resolve) => {
          finishComment = resolve
        })
    )
    const onSelectRange = vi.fn()

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        ranges={[range]}
        selectedRangeId={range.id}
        highlightPopover={<span>Highlight actions</span>}
        onCommentHighlight={onCommentHighlight}
        onSelectRange={onSelectRange}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)

    // When: the user starts commenting, the original range reference is passed
    // to the host and the popover stays open while the promise is pending.
    const commentButton = screen.getByRole('button', { name: '评论' })
    await user.click(commentButton)
    expect(onCommentHighlight).toHaveBeenCalledWith(range)
    const [pendingSelectionProps] = getAllSelectionProps()
    popoverView.rerender(pendingSelectionProps?.popover)
    expect(screen.getByRole('button', { name: '评论' })).toBeDisabled()
    expect(onSelectRange).not.toHaveBeenCalled()

    // Then: resolving with that same reference marks commenting as finished and
    // clears the selected range, which closes the existing-highlight popover.
    await act(async () => {
      finishComment?.(range)
      await Promise.resolve()
    })
    expect(onSelectRange).toHaveBeenCalledWith(null)
  })

  it('renders a comment button inside the default highlight popover', async () => {
    // Given: a selected public highlight and the default popover renderer.
    const user = userEvent.setup()
    const range: ReaderSelectionRange = {
      id: 'default-highlight-comment',
      text: 'Default highlight comment',
      start: { selectionId: 'page-1', offset: 0 },
      end: { selectionId: 'page-1', offset: 8 },
      createdAt: 12,
      rectsBySelectionId: {
        'page-1': [{ x: 10, y: 20, width: 30, height: 10 }]
      }
    }
    const onCommentHighlight = vi.fn(
      async (highlight: ReaderSelectionRange) => highlight
    )
    const onSelectRange = vi.fn()

    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        ranges={[range]}
        selectedRangeId={range.id}
        onCommentHighlight={onCommentHighlight}
        onSelectRange={onSelectRange}
      />
    )
    await waitFor(() => expect(getAllSelectionProps()).toHaveLength(1))
    const [selectionProps] = getAllSelectionProps()
    const popoverView = render(selectionProps?.popover)

    // Then: the default popover uses the same toolbar container as the active
    // selection popover and contains a comment button inside it.
    const toolbar = popoverView.container.querySelector(
      '.hamster-reader-popover'
    )
    expect(toolbar).toBeInTheDocument()
    const commentButton = within(toolbar as HTMLElement).getByRole('button', {
      name: '评论'
    })
    expect(commentButton).toBeInTheDocument()

    // When: the user clicks the comment button.
    await user.click(commentButton)
    expect(onCommentHighlight).toHaveBeenCalledWith(range)
    await waitFor(() => expect(onSelectRange).toHaveBeenCalledWith(null))
  })

  it('compile-time: overlayRectType satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      overlayRectType: 'percent'
    }
    expect(props.overlayRectType).toBe('percent')
  })

  it('keeps the legacy default rectangle popover delete contract', async () => {
    const user = userEvent.setup()
    const onRemoveRect = vi.fn()
    const props: DefaultRectanglePopoverProps = {
      selectedRectId: 'legacy-rect',
      onRemoveRect
    }

    render(<DefaultRectanglePopover {...props} />)
    await user.click(screen.getByRole('button', { name: '删除' }))

    expect(onRemoveRect).toHaveBeenCalledWith('legacy-rect')
    expect(screen.queryByLabelText('Highlight color')).not.toBeInTheDocument()
  })

  it('compile-time: onCommentRect satisfies ReaderInteractiveProps', () => {
    const props: ReaderInteractiveProps = {
      onCommentRect: async (rectangle) => rectangle
    }
    expect(props.onCommentRect).toBeTypeOf('function')
  })

  it('compile-time: interactionMode satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      interactionMode: 'stylus' as ReaderInteractionMode
    }
    expect(props.interactionMode).toBe('stylus')
  })

  it('compile-time: touchPanMode satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      touchPanMode: 'two-finger' as ReaderTouchPanMode
    }
    expect(props.touchPanMode).toBe('two-finger')
  })

  it('forwards onIntermediateDocumentRenderTiming to IntermediateDocumentViewer', () => {
    const onIntermediateDocumentRenderTiming = vi.fn()
    const doc = makeDocument({ pages: [makePage(1)] })
    render(
      <Reader
        document={doc}
        onIntermediateDocumentRenderTiming={onIntermediateDocumentRenderTiming}
      />
    )
    expect(capturedViewerProps.onIntermediateDocumentRenderTiming).toBe(
      onIntermediateDocumentRenderTiming
    )
  })

  it('compile-time: onIntermediateDocumentRenderTiming satisfies ReaderProps', () => {
    const props: ReaderProps = {
      document: makeDocument({ pages: [makePage(1)] }),
      onIntermediateDocumentRenderTiming: (entry) => {
        expect(entry.durationMs).toBeGreaterThanOrEqual(0)
      }
    }
    expect(props.onIntermediateDocumentRenderTiming).toBeTypeOf('function')
  })

  it('normalizes and forwards annotationHistory options to IntermediateDocumentViewer', () => {
    const onAnnotationHistoryChange = vi.fn()
    render(
      <Reader
        document={makeDocument({ pages: [makePage(1)] })}
        annotationHistory={{ resetKey: 'doc-1' }}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )

    expect(capturedViewerProps.annotationHistory).toEqual({
      enabled: true,
      resetKey: 'doc-1'
    })
    expect(capturedViewerProps.onAnnotationHistoryChange).toBe(
      onAnnotationHistoryChange
    )
  })
})

describe('Reader annotation history', () => {
  beforeEach(() => {
    clearSelectionProps()
  })

  it('undoes controlled ranges and rects by proposing the previous full snapshot', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const initialRect = makeReaderRect('rect-1')
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState([initialRange])
      const [controlledRects, setControlledRects] = useState([initialRect])
      const [selectedRangeId, setSelectedRangeId] = useState<string | null>(
        initialRange.id
      )
      const [selectedRectId, setSelectedRectId] = useState<string | null>(
        initialRect.id
      )

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          rects={controlledRects}
          selectedRangeId={selectedRangeId}
          selectedRectId={selectedRectId}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
            setControlledRects(next.rects)
            setSelectedRangeId(next.selectedRangeId)
            setSelectedRectId(next.selectedRectId)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const updatedRange = makeRuntimeRange(
      runtimeSelectionId,
      initialRange.id,
      'After'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [updatedRange],
        selectedRangeId: initialRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ text: 'After' })]
        }),
        expect.objectContaining({ source: 'update-range' })
      )
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      {
        ranges: [initialRange],
        rects: [initialRect],
        selectedRangeId: initialRange.id,
        selectedRectId: initialRect.id
      },
      expect.objectContaining({ source: 'undo' })
    )
  })

  it('returns false for controlled undo and redo without onAnnotationHistoryChange', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        ranges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, initialRange.id, 'After')],
        selectedRangeId: initialRange.id
      })
    })

    expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('Before')
    expect(screen.getByTestId('tool-bottom-bar-undo')).toBeDisabled()
    expect(screen.getByTestId('tool-bottom-bar-redo')).toBeDisabled()
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(false)
      expect(requireReaderSelectionRef(selectionRef).redo()).toBe(false)
    })
    expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('Before')
  })

  it('disables layout history commands while Reader is in text mode', async () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} annotationHistory />)
    await screen.findByText('Page 1 text')

    const updateHistoryStatus =
      capturedViewerProps.onAnnotationHistoryStatusChange
    if (typeof updateHistoryStatus !== 'function') {
      throw new Error('Expected internal annotation history status callback')
    }

    act(() => {
      updateHistoryStatus({
        enabled: true,
        canUndo: true,
        canRedo: true,
        pastCount: 1,
        futureCount: 1
      })
    })
    expect(screen.getByTestId('tool-bottom-bar-undo')).toBeEnabled()
    expect(screen.getByTestId('tool-bottom-bar-redo')).toBeEnabled()

    fireEvent.click(screen.getByTestId('tool-bottom-bar-render-mode'))

    await waitFor(() => {
      expect(screen.getByTestId('tool-bottom-bar-undo')).toBeDisabled()
      expect(screen.getByTestId('tool-bottom-bar-redo')).toBeDisabled()
    })
  })

  it('does not call single-item mutation callbacks during undo or redo replay', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onCreateRect = vi.fn()
    const onUpdateRect = vi.fn()
    const onSelect = vi.fn()
    const onUpdateRange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRects, setControlledRects] = useState<
        ReaderSelectionRectangle[]
      >([])

      return (
        <Reader
          document={document}
          rects={controlledRects}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRects(next.rects)
          }}
          onCreateRect={onCreateRect}
          onUpdateRect={onUpdateRect}
          onSelect={onSelect}
          onUpdateRange={onUpdateRange}
          tool='rect'
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateSelectionConfirmRect(runtimeSelectionId)
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ id: 'rect-highlight-id' })]
        }),
        expect.objectContaining({ source: 'create-rect' })
      )
    })
    expect(onCreateRect).toHaveBeenCalledTimes(1)

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).redo()).toBe(true)
    })

    expect(onCreateRect).toHaveBeenCalledTimes(1)
    expect(onUpdateRect).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onUpdateRange).not.toHaveBeenCalled()
  })

  it('calls onAnnotationHistoryChange for direct annotation mutations', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState<
        ReaderSelectionRange[]
      >([])
      const [controlledRects, setControlledRects] = useState<
        ReaderSelectionRectangle[]
      >([])
      const [selectedRangeId, setSelectedRangeId] = useState<string | null>(
        null
      )
      const [selectedRectId, setSelectedRectId] = useState<string | null>(null)

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          rects={controlledRects}
          selectedRangeId={selectedRangeId}
          selectedRectId={selectedRectId}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
            setControlledRects(next.rects)
            setSelectedRangeId(next.selectedRangeId)
            setSelectedRectId(next.selectedRectId)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const createdRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'Before'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [createdRange],
        selectedRangeId: createdRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ id: createdRange.id })]
        }),
        expect.objectContaining({ source: 'select' })
      )
    })

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, createdRange.id, 'After')],
        selectedRangeId: createdRange.id
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ranges: [expect.objectContaining({ text: 'After' })]
        }),
        expect.objectContaining({ source: 'update-range' })
      )
    })

    act(() => {
      getSelectionPropsById(runtimeSelectionId)?.onCreateRect?.({
        ...makeReaderRect('rect-1'),
        selectionId: runtimeSelectionId
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ id: 'rect-1' })]
        }),
        expect.objectContaining({ source: 'create-rect' })
      )
    })

    act(() => {
      getSelectionPropsById(runtimeSelectionId)?.onUpdateRect?.({
        ...makeReaderRect('rect-1'),
        end: { x: 80, y: 90 },
        rect: { x: 10, y: 20, width: 70, height: 70 },
        selectionId: runtimeSelectionId
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rects: [expect.objectContaining({ end: { x: 80, y: 90 } })]
        }),
        expect.objectContaining({ source: 'update-rect' })
      )
    })

    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: vi.fn()
    } as unknown as Selection)

    act(() => {
      requireReaderSelectionRef(selectionRef).clear()
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        { ranges: [], rects: [], selectedRangeId: null, selectedRectId: null },
        expect.objectContaining({ source: 'clear' })
      )
    })
  })

  it('does not create a checkpoint for selection-only clicks', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedSelectRange(runtimeSelectionId, initialRange.id)
    })

    expect(onAnnotationHistoryChange).not.toHaveBeenCalled()
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)
    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(false)
    })
  })

  it('creates one highlight checkpoint when a new range surfaces through select and highlight callbacks', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onSelect = vi.fn()
    const onHighlight = vi.fn()
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
        onSelect={onSelect}
        onHighlight={onHighlight}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const createdRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'Created'
    )

    act(() => {
      requireReaderSelectionRef(selectionRef).highlight()
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [createdRange],
        selectedRangeId: createdRange.id
      })
      simulateLinkedSelect(runtimeSelectionId, createdRange)
    })

    expect(onAnnotationHistoryChange).toHaveBeenCalledTimes(1)
    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ranges: [expect.objectContaining({ id: createdRange.id })]
      }),
      expect.objectContaining({ source: 'highlight' })
    )
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(
      requireReaderSelectionRef(selectionRef).getAnnotationHistoryState()
    ).toEqual(expect.objectContaining({ canUndo: true, pastCount: 1 }))
  })

  it('excludes pagePaintings from history entries and undo replay', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const onPagePaintingsChange = vi.fn()
    const pagePaintings: Record<string, DrawingValue> = {
      'page-1': { strokes: [] }
    }
    const nextPaintings: Record<string, DrawingValue> = {
      'page-1': {
        strokes: [
          {
            id: 'stroke-1',
            tool: 'pen',
            points: [{ x: 1, y: 2 }]
          }
        ]
      }
    }
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        pagePaintings={pagePaintings}
        onPagePaintingsChange={onPagePaintingsChange}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const updatePainting = capturedViewerProps.onPagePaintingChange
    if (typeof updatePainting !== 'function') {
      throw new Error('Expected viewer painting update callback')
    }

    act(() => {
      updatePainting('page-1', nextPaintings['page-1'])
    })

    expect(onPagePaintingsChange).toHaveBeenCalledTimes(1)
    expect(onPagePaintingsChange).toHaveBeenLastCalledWith(nextPaintings)
    expect(onAnnotationHistoryChange).not.toHaveBeenCalled()
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)

    const runtimeSelectionId = requireRuntimeSelectionId()
    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'Paint safe')],
        selectedRangeId: 'range-1'
      })
    })
    await waitFor(() => {
      expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ pagePaintings: expect.anything() }),
        expect.objectContaining({ source: 'select' })
      )
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onPagePaintingsChange).toHaveBeenCalledTimes(1)
    expect(capturedViewerProps.pagePaintings).toBe(pagePaintings)
  })

  it('undoes and redoes an uncontrolled text range mutation through selectionRef', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const updatedRange = makeRuntimeRange(
      runtimeSelectionId,
      'range-1',
      'After'
    )

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [updatedRange],
        selectedRangeId: 'range-1'
      })
    })

    const publicRef = requireReaderSelectionRef(selectionRef)
    expect(publicRef.canUndo()).toBe(true)

    act(() => {
      expect(publicRef.undo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe(
        'Before'
      )
    })

    act(() => {
      expect(publicRef.redo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('After')
    })
  })

  it('emits the previous snapshot when controlled text history is undone', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const onAnnotationHistoryChange = vi.fn()
    const { document } = makeLazyDocument(1)

    function ControlledReader() {
      const [controlledRanges, setControlledRanges] = useState([initialRange])

      return (
        <Reader
          document={document}
          ranges={controlledRanges}
          annotationHistory
          selectionRef={selectionRef}
          onAnnotationHistoryChange={(next, detail) => {
            onAnnotationHistoryChange(next, detail)
            setControlledRanges(next.ranges)
          }}
        />
      )
    }

    render(<ControlledReader />)
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: 'range-1'
      })
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe('After')
    })

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })

    expect(onAnnotationHistoryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ ranges: [initialRange] }),
      expect.objectContaining({ source: 'undo' })
    )
  })

  it('syncs selection-only changes without adding an undo checkpoint', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const onAnnotationHistoryChange = vi.fn()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory
        selectionRef={selectionRef}
        onAnnotationHistoryChange={onAnnotationHistoryChange}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: null
      })
    })
    const mutationCallCount = onAnnotationHistoryChange.mock.calls.length

    act(() => {
      simulateLinkedSelectRange(runtimeSelectionId, 'range-1')
    })

    expect(onAnnotationHistoryChange).toHaveBeenCalledTimes(mutationCallCount)

    act(() => {
      expect(requireReaderSelectionRef(selectionRef).undo()).toBe(true)
    })
    await waitFor(() => {
      expect(requireLinkedData(runtimeSelectionId).items[0]?.text).toBe(
        'Before'
      )
    })
  })

  it('returns false when redo would apply unsupported uncontrolled rectangle history', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        annotationHistory
        selectionRef={selectionRef}
        tool='rect'
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()
    const publicRef = requireReaderSelectionRef(selectionRef)

    act(() => {
      simulateSelectionConfirmRect(runtimeSelectionId)
    })
    act(() => {
      expect(publicRef.undo()).toBe(true)
    })
    act(() => {
      expect(publicRef.redo()).toBe(false)
    })
  })

  it('clears undo and redo stacks when resetKey changes', async () => {
    const selectionRef = createRef<ReaderSelectionRef>()
    const initialRange = makeReaderRange('range-1', 'Before')
    const { document } = makeLazyDocument(1)
    const { rerender } = render(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory={{ enabled: true, resetKey: 1 }}
        selectionRef={selectionRef}
      />
    )
    await screen.findByText('Page 1 text')
    const runtimeSelectionId = requireRuntimeSelectionId()

    act(() => {
      simulateLinkedDataChange(runtimeSelectionId, {
        ...requireLinkedData(runtimeSelectionId),
        items: [makeRuntimeRange(runtimeSelectionId, 'range-1', 'After')],
        selectedRangeId: 'range-1'
      })
    })
    expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(true)

    rerender(
      <Reader
        document={document}
        defaultRanges={[initialRange]}
        annotationHistory={{ enabled: true, resetKey: 2 }}
        selectionRef={selectionRef}
      />
    )

    await waitFor(() => {
      expect(requireReaderSelectionRef(selectionRef).canUndo()).toBe(false)
      expect(requireReaderSelectionRef(selectionRef).canRedo()).toBe(false)
    })
  })
})

describe('Reader zoom props', () => {
  beforeEach(() => {
    capturedViewerProps = {}
  })

  it('compile-time: zoom props satisfy ReaderProps', () => {
    const props = {
      scale: 2,
      defaultScale: 1.5,
      onScaleChange: (
        _scale: number,
        detail: {
          source: 'wheel' | 'pinch'
          focalPoint?: { x: number; y: number }
        }
      ) => detail.source,
      minScale: 0.25,
      maxScale: 4,
      maxLoadedPages: 7
    } satisfies ReaderProps

    expect(props.scale).toBe(2)
    expect(props.maxLoadedPages).toBe(7)
  })

  it('renders with all zoom and lazy-release props without errors', () => {
    const onScaleChange = vi.fn()
    render(
      <Reader
        scale={2}
        defaultScale={1.5}
        onScaleChange={onScaleChange}
        minScale={0.25}
        maxScale={4}
        maxLoadedPages={7}
        document={makeDocument({ pages: [makePage(1)] })}
      />
    )

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
    expect(capturedViewerProps.scale).toBe(2)
    expect(capturedViewerProps.defaultScale).toBe(1.5)
    expect(capturedViewerProps.onScaleChange).toBe(onScaleChange)
    expect(capturedViewerProps.minScale).toBe(0.25)
    expect(capturedViewerProps.maxScale).toBe(4)
    expect(capturedViewerProps.maxLoadedPages).toBe(7)
  })

  it('renders IntermediateDocumentViewer by default', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    expect(
      screen.getByTestId('intermediate-document-viewer')
    ).toBeInTheDocument()
  })

  it('forwards intermediate-document lazy props with defaults to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    expect(capturedViewerProps.initialLoadedPages).toBeUndefined()
    expect(capturedViewerProps.pageLoadConcurrency).toBeUndefined()
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBeUndefined()
    expect(capturedViewerProps.pagePreloadRadius).toBeUndefined()
    expect(capturedViewerProps.pageUnloadDelayMs).toBeUndefined()
  })

  it('forwards explicit intermediate-document lazy props to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        initialLoadedPages={2}
        pageLoadConcurrency={5}
        pageLoadEnterDelayMs={250}
        pagePreloadRadius={4}
        pageUnloadDelayMs={3000}
      />
    )

    expect(capturedViewerProps.initialLoadedPages).toBe(2)
    expect(capturedViewerProps.pageLoadConcurrency).toBe(5)
    expect(capturedViewerProps.pageLoadEnterDelayMs).toBe(250)
    expect(capturedViewerProps.pagePreloadRadius).toBe(4)
    expect(capturedViewerProps.pageUnloadDelayMs).toBe(3000)
  })

  it('configures VirtualPaper for reading mode without contain mode', () => {
    const { document } = makeLazyDocument(1)

    render(<Reader document={document} />)

    const wrapper = screen.getByTestId('virtual-paper-wrapper')
    expect(wrapper).toHaveAttribute('data-reader-mode', 'true')
    expect(wrapper).toHaveAttribute('data-contain-mode', 'false')
    expect(Number(wrapper.getAttribute('data-content-width'))).toBeGreaterThan(
      0
    )
    expect(Number(wrapper.getAttribute('data-content-height'))).toBeGreaterThan(
      0
    )
  })

  it('forwards horizontal and independent vertical margins to IntermediateDocumentViewer', () => {
    const { document } = makeLazyDocument(1)

    render(
      <Reader
        document={document}
        containMarginX={24}
        containMarginTop={32}
        containMarginBottom={64}
      />
    )

    expect(capturedViewerProps.containMarginX).toBe(24)
    expect(capturedViewerProps.containMarginTop).toBe(32)
    expect(capturedViewerProps.containMarginBottom).toBe(64)
    expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
      paddingTop: '32px',
      paddingBottom: '64px'
    })
  })

  it('adds the measured default bottom bar inset to Text Mode content', async () => {
    // Given: the host provides only its 10px safe area and Reader renders its default toolbar.
    const { document } = makeLazyDocument(1)
    render(
      <Reader document={document} renderMode='text' containMarginBottom={10} />
    )
    const root = screen.getByTestId('reader-root')
    const bottomBar = screen.getByTestId('tool-bottom-bar')

    // When: layout resolves a 54px toolbar positioned 16px above Reader's bottom edge.
    mockElementSize(bottomBar, { width: 320, height: 54, top: 530 })
    mockElementSize(root, { width: 800, height: 600 })

    // Then: Reader owns the 70px obstruction and adds it to the host safe area.
    await waitFor(() => {
      expect(capturedTextViewerProps.containMarginBottom).toBe(80)
      expect(
        screen.getByTestId('intermediate-document-text-viewer')
      ).toHaveStyle({ paddingBottom: '80px' })
    })
  })

  it('preserves the legacy vertical margin while adding the default bottom bar inset', async () => {
    // Given: a legacy Layout Mode consumer provides one symmetric vertical margin.
    const { document } = makeLazyDocument(1)
    render(<Reader document={document} containMarginY={10} />)
    const root = screen.getByTestId('reader-root')
    const bottomBar = screen.getByTestId('tool-bottom-bar')

    // When: Reader measures a 70px obstruction from its built-in toolbar.
    mockElementSize(bottomBar, { width: 320, height: 54, top: 530 })
    mockElementSize(root, { width: 800, height: 600 })

    // Then: the legacy top remains 10px and only the bottom grows to 80px.
    await waitFor(() => {
      expect(capturedViewerProps.containMarginTop).toBe(10)
      expect(capturedViewerProps.containMarginBottom).toBe(80)
      expect(capturedViewerProps.containMarginY).toBeUndefined()
      expect(screen.getByTestId('virtual-paper-container')).toHaveStyle({
        paddingTop: '10px',
        paddingBottom: '80px'
      })
    })
  })

  it('does not add a toolbar inset when the bottom bar is disabled', () => {
    // Given: the host disables Reader's bottom bar and provides a 10px safe area.
    const { document } = makeLazyDocument(1)

    // When: Text Mode renders without an owned toolbar.
    render(
      <Reader
        document={document}
        renderMode='text'
        containMarginBottom={10}
        bottomBar={null}
      />
    )

    // Then: the public margin remains exactly the host-provided safe area.
    expect(capturedTextViewerProps.containMarginBottom).toBe(10)
    expect(screen.getByTestId('intermediate-document-text-viewer')).toHaveStyle(
      { paddingBottom: '10px' }
    )
  })

  it('leaves custom bottom bar obstruction under host control', () => {
    // Given: the host supplies a custom floating bar and its own 10px safe area.
    const { document } = makeLazyDocument(1)
    render(
      <Reader
        document={document}
        renderMode='text'
        containMarginBottom={10}
        bottomBar={<div data-testid='custom-bottom-bar'>Custom bar</div>}
      />
    )

    // When: the custom bar has a visible geometry that Reader does not own.
    mockElementSize(screen.getByTestId('custom-bottom-bar'), {
      width: 320,
      height: 54,
      top: 530
    })

    // Then: Reader preserves the host margin without adding a guessed inset.
    expect(capturedTextViewerProps.containMarginBottom).toBe(10)
    expect(screen.getByTestId('intermediate-document-text-viewer')).toHaveStyle(
      { paddingBottom: '10px' }
    )
  })

  it('defaults the page browser to closed and forwards an explicit open state', () => {
    const { document } = makeLazyDocument(2)
    const { rerender } = render(<Reader document={document} />)

    expect(capturedViewerProps.showPageBrowser).toBeUndefined()

    rerender(<Reader document={document} showPageBrowser={true} />)

    expect(capturedViewerProps.showPageBrowser).toBe(true)
  })

  it('forwards controlled comment props to IntermediateDocumentViewer', () => {
    // Given：宿主以纯受控方式持有评论数据与统一变更回调。
    const { document } = makeLazyDocument(1)
    const comments: readonly ReaderComment[] = [
      {
        id: 'comment-1',
        highlightIds: ['range-1'],
        content: '第一条评论',
        createdAt: 1,
        parentId: null
      }
    ]
    const onCommentsChange =
      vi.fn<
        (
          nextComments: readonly ReaderComment[],
          detail: ReaderCommentChangeDetail
        ) => void
      >()

    // When：Reader 渲染布局 viewer。
    render(
      <Reader
        document={document}
        comments={comments}
        onCommentsChange={onCommentsChange}
      />
    )

    // Then：Reader 只透传受控评论 props，本身不修改评论数据。
    expect(capturedViewerProps.comments).toBe(comments)
    expect(capturedViewerProps.onCommentsChange).toBe(onCommentsChange)
    expect(onCommentsChange).not.toHaveBeenCalled()
  })
})
