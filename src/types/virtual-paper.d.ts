/**
 * 本地类型 shim，覆盖 @hamster-note/virtual-paper 空白的
 * dist/index.d.ts（仅 `export {}`）。声明基于该版本运行时
 * 实际导出的公开 API，随版本变化时需同步更新。
 *
 * 该版本（npm 0.1.0-beta.2）的运行时导出：
 * - DEFAULT_ENABLED_INTERACTIONS（常量）
 * - VirtualPaper（组件）
 * - VirtualPaperInitialPlacement（枚举）
 * - VirtualPaperInteractionMode（枚举）
 *
 * 已移除：VirtualPaperRenderMode 枚举与 renderMode prop。
 * 新增：readerMode / containMode / inertialScroll / edgeElasticScroll /
 *       readerModeZoomDebounceMs props。
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
  }

  /**
   * 用于撑开容器的内容尺寸（在 contain / reader 模式下参与布局计算）。
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
     * 非受控模式下首次挂载时如何放置容器。默认 Center。
     */
    initialPlacement?: VirtualPaperInitialPlacement
    /**
     * Reader 模式：启用针对阅读场景优化的手势行为（如滚轮缩放防抖）。
     */
    readerMode?: boolean
    /**
     * Contain 模式：将内容约束在容器可视区域内。
     */
    containMode?: boolean | 'contain' | 'cover' | 'stretch'
    /**
     * 惯性滚动：手势结束后保持减速滑动。
     */
    inertialScroll?: boolean
    /**
     * 边缘弹性滚动：到达边界后产生回弹效果。
     */
    edgeElasticScroll?: boolean
    /**
     * Reader 模式下滚轮缩放的防抖毫秒数。
     */
    readerModeZoomDebounceMs?: number
    /**
     * 内容尺寸，参与 contain / reader 模式的布局计算。
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
