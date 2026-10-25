// 最小类型声明：overlayer.js 的静态绘制工厂（vendored，见 MANIFEST.md）。

export interface OverlayerRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export declare class Overlayer {
  static highlight(
    rects: OverlayerRect[],
    options?: { color?: string }
  ): SVGElement
  static underline(
    rects: OverlayerRect[],
    options?: { color?: string }
  ): SVGElement
  static outline(
    rects: OverlayerRect[],
    options?: { color?: string; width?: number; radius?: number }
  ): SVGElement
  add(
    key: string,
    range: Range | (() => Range),
    draw: (rects: OverlayerRect[], options?: unknown) => SVGElement,
    options?: unknown
  ): void
  remove(key: string): void
  redraw(): void
  hitTest(point: { x: number; y: number }): [] | [string, Range]
}
