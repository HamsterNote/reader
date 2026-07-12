/**
 * VirtualPaper 的确定性测试替身。
 *
 * 复刻关键公开 API 与 DOM 结构：
 * - 渲染 data-testid="virtual-paper-wrapper" 与
 *   data-testid="virtual-paper-container"
 * - container 使用 `translate3d(...)` 形式的 transform
 * - 支持受控 `transform`、非受控 `defaultTransform` 与默认居中放置
 * - 将 `minScale`、`maxScale`、`enabledInteractions`、
 *   `containerProps` 透传给 DOM 用于断言
 * - 提供 `__triggerTransform` 与 `__triggerTransformEnd` 静态辅助方法，
 *   让测试可以模拟手势产生的 transform 变化
 */

import * as React from 'react'
const { useMemo, useRef, useState } = React

export enum VirtualPaperInteractionMode {
  MouseWheelZoom = 'MouseWheelZoom',
  MouseDragPan = 'MouseDragPan',
  TrackpadScrollPan = 'TrackpadScrollPan',
  MouseWheelCtrlZoom = 'MouseWheelCtrlZoom',
  TouchSingleFingerPan = 'TouchSingleFingerPan',
  TouchTwoFingerPan = 'TouchTwoFingerPan',
  TouchTwoFingerZoom = 'TouchTwoFingerZoom',
  PenPan = 'PenPan'
}

export enum VirtualPaperInitialPlacement {
  TopLeft = 'TopLeft',
  Center = 'Center'
}

export type VirtualPaperTransform = {
  x: number
  y: number
  scale: number
}

export type VirtualPaperTransformMeta = {
  source: VirtualPaperInteractionMode | 'initialPlacement'
  inputType: 'pointer' | 'wheel' | 'programmatic'
  phase: 'start' | 'change' | 'end'
}

export type VirtualPaperContentSize = {
  width: number
  height: number
}

export type VirtualPaperProps = {
  children?: React.ReactNode
  enabledInteractions?: VirtualPaperInteractionMode[]
  initialPlacement?: VirtualPaperInitialPlacement
  /** v0.1.0-beta.1+：阅读模式（连续滚动/单页） */
  readerMode?: boolean
  /** v0.1.0-beta.1+：容器模式，替代已移除的 renderMode */
  containMode?: 'contain' | 'cover' | 'stretch'
  /** v0.1.0-beta.1+：惯性滚动 */
  inertialScroll?: boolean
  /** v0.1.0-beta.1+：边缘弹性滚动 */
  edgeElasticScroll?: boolean
  /** v0.1.0-beta.1+：阅读模式缩放防抖时间（毫秒） */
  readerModeZoomDebounceMs?: number
  contentSize?: VirtualPaperContentSize
  transform?: VirtualPaperTransform
  defaultTransform?: VirtualPaperTransform
  minScale?: number
  maxScale?: number
  onTransformChange?: (
    transform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  onTransformChangeEnd?: (
    transform: VirtualPaperTransform,
    meta: VirtualPaperTransformMeta
  ) => void
  className?: string
  style?: React.CSSProperties
  containerClassName?: string
  containerStyle?: React.CSSProperties
  wrapperProps?: React.HTMLAttributes<HTMLDivElement>
  containerProps?: React.HTMLAttributes<HTMLDivElement>
}

export const DEFAULT_ENABLED_INTERACTIONS = [
  VirtualPaperInteractionMode.TrackpadScrollPan,
  VirtualPaperInteractionMode.MouseWheelCtrlZoom,
  VirtualPaperInteractionMode.TouchSingleFingerPan,
  VirtualPaperInteractionMode.TouchTwoFingerZoom
]

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const normalizeTransform = (
  value: VirtualPaperTransform | undefined,
  minScale: number,
  maxScale: number
): VirtualPaperTransform => {
  const fallback = { x: 0, y: 0, scale: 1 }
  const base = value ?? fallback
  return {
    x: Number.isFinite(base.x) ? base.x : fallback.x,
    y: Number.isFinite(base.y) ? base.y : fallback.y,
    scale: clamp(
      Number.isFinite(base.scale) && base.scale > 0
        ? base.scale
        : fallback.scale,
      minScale,
      maxScale
    )
  }
}

const registry = new WeakMap<
  HTMLDivElement,
  {
    props: VirtualPaperProps
    setTransform: (transform: VirtualPaperTransform) => void
  }
>()

function VirtualPaperComponent(props: VirtualPaperProps): React.JSX.Element {
  const {
    children,
    enabledInteractions = DEFAULT_ENABLED_INTERACTIONS,
    // eslint-disable-next-line sonarjs/no-unused-vars
    initialPlacement: _initialPlacement,
    contentSize,
    transform: controlledTransform,
    defaultTransform,
    minScale = 0.25,
    maxScale = 4,
    onTransformChange,
    className,
    style,
    containerClassName,
    containerStyle,
    wrapperProps,
    containerProps,
    containMode
  } = props

  const isControlled = controlledTransform !== undefined
  const [internalTransform, setInternalTransform] = useState(() =>
    normalizeTransform(
      defaultTransform ?? { x: 0, y: 0, scale: 1 },
      minScale,
      maxScale
    )
  )
  const transform = isControlled
    ? normalizeTransform(controlledTransform, minScale, maxScale)
    : internalTransform

  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 将当前实例注册到 DOM，便于测试辅助函数定位。
  const entry = useMemo(
    () => ({
      props,
      setTransform: (next: VirtualPaperTransform) => {
        if (!isControlled) {
          setInternalTransform(next)
        }
        onTransformChange?.(next, {
          source: VirtualPaperInteractionMode.TouchTwoFingerZoom,
          inputType: 'pointer',
          phase: 'change'
        })
      }
    }),
    [isControlled, onTransformChange, props]
  )

  if (wrapperRef.current) {
    registry.set(wrapperRef.current, entry)
  }
  if (containerRef.current) {
    registry.set(containerRef.current, entry)
  }

  const wrapperDataTestId =
    ((wrapperProps as Record<string, unknown> | undefined)?.['data-testid'] as
      | string
      | undefined) ?? 'virtual-paper-wrapper'
  const containerDataTestId =
    ((containerProps as Record<string, unknown> | undefined)?.[
      'data-testid'
    ] as string | undefined) ?? 'virtual-paper-container'

  const {
    className: wrapperClassFromProps,
    style: wrapperStyleFromProps,
    ...restWrapperProps
  } = wrapperProps ?? {}
  const {
    className: containerClassFromProps,
    style: containerStyleFromProps,
    ...restContainerProps
  } = containerProps ?? {}

  return (
    <div
      ref={wrapperRef}
      data-testid={wrapperDataTestId}
      className={['virtual-paper-wrapper', className, wrapperClassFromProps]
        .filter(Boolean)
        .join(' ')}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        ...style,
        ...wrapperStyleFromProps
      }}
      data-enabled-interactions={enabledInteractions.join(',')}
      data-min-scale={minScale}
      data-max-scale={maxScale}
      data-contain-mode={containMode}
      {...restWrapperProps}
    >
      <div
        ref={containerRef}
        data-testid={containerDataTestId}
        className={[
          'virtual-paper-container',
          containerClassName,
          containerClassFromProps
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          position: 'absolute',
          transformOrigin: '0 0',
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          ...containerStyle,
          ...containerStyleFromProps
        }}
        data-content-size-width={contentSize?.width}
        data-content-size-height={contentSize?.height}
        {...restContainerProps}
      >
        {children}
      </div>
    </div>
  )
}

function getEntry(element: HTMLElement) {
  let current: HTMLElement | null = element
  while (current) {
    const entry = registry.get(current as HTMLDivElement)
    if (entry) return entry
    current = current.parentElement
  }
  return null
}

/**
 * 测试辅助：从 container 或 wrapper DOM 元素触发 transform 变化。
 * 会同时更新内部状态并调用 onTransformChange。
 */
VirtualPaperComponent.__triggerTransform = (
  element: HTMLElement,
  transform: VirtualPaperTransform
) => {
  const entry = getEntry(element)
  entry?.setTransform(transform)
}

/**
 * 测试辅助：从 container 或 wrapper DOM 元素触发 transform 结束事件。
 */
VirtualPaperComponent.__triggerTransformEnd = (
  element: HTMLElement,
  transform: VirtualPaperTransform,
  source: VirtualPaperInteractionMode = VirtualPaperInteractionMode.TouchTwoFingerZoom
) => {
  const entry = getEntry(element)
  entry?.props.onTransformChangeEnd?.(transform, {
    source,
    inputType: 'pointer',
    phase: 'end'
  })
}

export const VirtualPaper = VirtualPaperComponent
