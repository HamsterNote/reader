/**
 * 本地类型 shim，覆盖 @hamster-note/virtual-paper@0.1.0-beta.1 空白的
 * dist/index.d.ts。声明完全基于该版本源码导出的公开 API。
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

declare module '@hamster-note/virtual-paper' {
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

  export enum VirtualPaperRenderMode {
    Transform = 'Transform',
    Scroll = 'Scroll'
  }

  /**
   * 变换状态。x/y 是容器在 wrapper 内的位移（像素），scale 是缩放比例。
   */
  export type VirtualPaperTransform = {
    x: number
    y: number
    scale: number
  }

  /**
   * onTransformChange / onTransformChangeEnd 回调携带的元数据。
   */
  export type VirtualPaperTransformMeta = {
    source: VirtualPaperInteractionMode | 'initialPlacement'
    inputType: 'pointer' | 'wheel' | 'programmatic'
    phase: 'start' | 'change' | 'end'
    active?: boolean
    focalPoint?: { x: number; y: number }
  }

  /**
   * Scroll 模式下用于撑开容器的内容尺寸。
   */
  export type VirtualPaperContentSize = {
    width: number
    height: number
  }

  export type VirtualPaperElementProps = HTMLAttributes<HTMLDivElement> &
    Partial<Record<`data-${string}`, string | number | boolean | undefined>>

  export type VirtualPaperProps = {
    children?: ReactNode
    /**
     * 启用的交互模式。默认等价于 DEFAULT_ENABLED_INTERACTIONS。
     */
    enabledInteractions?: VirtualPaperInteractionMode[]
    /**
     * 非受控模式下首次挂载时如何放置容器。
     */
    initialPlacement?: VirtualPaperInitialPlacement
    /**
     * Transform 模式通过 CSS transform 移动容器；Scroll 模式通过 overflow 滚动实现。
     */
    renderMode?: VirtualPaperRenderMode
    /**
     * Scroll 模式下用于计算容器大小的内容尺寸。
     */
    contentSize?: VirtualPaperContentSize
    /**
     * 受控变换值。提供后组件内部不再维护 transform 状态。
     */
    transform?: VirtualPaperTransform
    /**
     * 非受控初始变换值。仅在首次挂载时生效。
     */
    defaultTransform?: VirtualPaperTransform
    /**
     * 最小缩放比例。默认 0.25。
     */
    minScale?: number
    /**
     * 最大缩放比例。默认 4。
     */
    maxScale?: number
    /**
     * 每次 transform 变化时触发（包含 phase 为 change 的连续事件）。
     */
    onTransformChange?: (
      transform: VirtualPaperTransform,
      meta: VirtualPaperTransformMeta
    ) => void
    /**
     * 手势结束时触发（phase 为 end）。
     */
    onTransformChangeEnd?: (
      transform: VirtualPaperTransform,
      meta: VirtualPaperTransformMeta
    ) => void
    /**
     * wrapper（外层滚动/捕获手势）元素的 className。
     */
    className?: string
    /**
     * wrapper 元素的内联样式。
     */
    style?: CSSProperties
    /**
     * container（内层被 transform）元素的 className。
     */
    containerClassName?: string
    /**
     * container 元素的内联样式。
     */
    containerStyle?: CSSProperties
    /**
     * 透传给 wrapper div 的额外 HTML 属性。
     */
    wrapperProps?: VirtualPaperElementProps
    /**
     * 透传给 container div 的额外 HTML 属性。
     */
    containerProps?: VirtualPaperElementProps
  }

  export const DEFAULT_ENABLED_INTERACTIONS: VirtualPaperInteractionMode[]

  /**
   * VirtualPaper 组件：封装 translate/scale/drag/zoom 交互的容器。
   */
  export function VirtualPaper(props: VirtualPaperProps): JSX.Element
}
