import {
  createEditor,
  createPageGeometry,
  PageDrawingSurface,
  readLayeredDocument,
  serializeLayeredDocument,
  type EditorDocument,
  type LayeredEditorController,
  type PageGeometry
} from '@hamster-note/painting/layered'
import type { LayeredToolsSnapshot } from '@hamster-note/painting/core'
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { DrawingDocumentContext } from '../painting/DrawingDocumentContext'

export type PageDrawingLayerProps = {
  readonly enabled: boolean
  readonly pageId: string
  readonly settings: LayeredToolsSnapshot
  readonly value?: EditorDocument
  readonly onChange?: (document: EditorDocument) => void
  readonly geometry?: PageGeometry | null
  readonly pageSize?: { readonly width: number; readonly height: number }
}

const EMPTY_DOCUMENT: EditorDocument = {
  schemaVersion: 3,
  documentRevision: 0,
  objects: []
}
const IDENTITY = [1, 0, 0, 1, 0, 0] as const

export function hasDrawingObjects(value: EditorDocument | undefined): boolean {
  if (value === undefined) return false
  const result = readLayeredDocument(value)
  return !result.ok || result.value.objects.length > 0
}

function documentKey(document: EditorDocument): string {
  const result = serializeLayeredDocument(document)
  if (!result.ok)
    throw new Error(`Invalid painting document: ${result.error.path}`)
  return result.value
}

type PageSession = {
  documentIdentity: unknown
  pageId: string
  input: EditorDocument | undefined
  controller: LayeredEditorController | null
}

/** New document integration only. Persistence migration belongs to the storage entry point. */
export function PageDrawingLayer({
  enabled,
  pageId,
  settings,
  value,
  onChange,
  geometry,
  pageSize
}: PageDrawingLayerProps) {
  const documentIdentity = useContext(DrawingDocumentContext)
  const root = useRef<HTMLDivElement>(null)
  const latestChange = useRef(onChange)
  latestChange.current = onChange
  const parsed = useMemo(
    () => readLayeredDocument(value ?? EMPTY_DOCUMENT),
    [value]
  )
  const session = useRef<PageSession | null>(null)
  const current = session.current
  const changedInput = current && current.input !== value
  const changedDocument =
    changedInput &&
    (!parsed.ok ||
      !current.controller ||
      documentKey(parsed.value) !==
        documentKey(current.controller.getSnapshot('document')))
  if (
    !current ||
    current.documentIdentity !== documentIdentity ||
    current.pageId !== pageId ||
    changedDocument
  ) {
    session.current = {
      documentIdentity,
      pageId,
      input: value,
      controller: parsed.ok ? createEditor(parsed.value) : null
    }
  }
  session.current!.input = value
  const controller = session.current!.controller
  const [layout, setLayout] = useState({ width: 0, height: 0 })

  // Generic document pages pass their base dimensions. PDF callers pass library geometry directly.
  useEffect(() => {
    if (geometry !== undefined || !root.current) return
    const node = root.current
    const update = () => {
      const computed = node.ownerDocument.defaultView!.getComputedStyle(node)
      const width =
        (computed.width.endsWith('px') ? parseFloat(computed.width) : 0) ||
        node.clientWidth ||
        pageSize?.width ||
        0
      const height =
        (computed.height.endsWith('px') ? parseFloat(computed.height) : 0) ||
        node.clientHeight ||
        pageSize?.height ||
        0
      setLayout((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [geometry, pageSize?.width, pageSize?.height])

  const pageGeometry = useMemo(() => {
    if (geometry !== undefined) return geometry
    if (!pageSize || layout.width <= 0 || layout.height <= 0) return null
    return createPageGeometry({
      width: pageSize.width,
      height: pageSize.height,
      referenceTransform: IDENTITY,
      viewportTransform: [
        layout.width / pageSize.width,
        0,
        0,
        layout.height / pageSize.height,
        0,
        0
      ]
    })
  }, [geometry, pageSize?.width, pageSize?.height, layout.width, layout.height])

  useLayoutEffect(() => {
    if (!controller) return
    controller.setFreehandSettings(settings.settings.freehand)
    controller.setShapeSettings(settings.settings.shape)
    controller.setTool(settings.activeTool)
  }, [controller, settings])

  useEffect(() => {
    if (!controller) return
    return controller.subscribe('document', () => {
      if (session.current?.controller !== controller) return
      latestChange.current?.(controller.getSnapshot('document'))
    })
  }, [controller])

  return (
    <div
      ref={root}
      className='hamster-reader__drawing-layer'
      data-testid={`reader-page-drawing-layer-${pageId}`}
      style={{ pointerEvents: enabled && parsed.ok ? 'auto' : 'none' }}
    >
      {!parsed.ok ? (
        <span role='alert'>绘图数据无法恢复：{parsed.error.path}</span>
      ) : null}
      {controller && pageGeometry ? (
        <PageDrawingSurface
          pageId={pageId}
          controller={controller}
          geometry={pageGeometry}
          enabled={enabled}
        />
      ) : null}
    </div>
  )
}
