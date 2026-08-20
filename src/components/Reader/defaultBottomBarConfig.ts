import type { IconName } from '@hamster-note/components'

import type { ReaderFontScale } from '../../types/fontScale'
import type { ReaderLineHeight } from '../../types/lineHeight'
import type { ReaderLayoutZoom } from '../IntermediateDocumentViewer/nativeLayoutZoom'
import type {
  ReaderColorOption,
  ReaderPageTool
} from '../../types/readerOptions'

export type { ReaderLayoutZoom } from '../IntermediateDocumentViewer/nativeLayoutZoom'

export const DEFAULT_BOTTOM_BAR_TOOLS: readonly {
  readonly tool: ReaderPageTool
  readonly icon: IconName
  readonly label: string
}[] = [
  { tool: 'text-selection', icon: 'type', label: '文字' },
  { tool: 'rect-selection', icon: 'rectangle', label: '矩形' },
  { tool: 'drawing', icon: 'pen', label: '绘图' }
]

export const DEFAULT_BOTTOM_BAR_COLORS: readonly ReaderColorOption[] = [
  { name: 'blue', color: '#7d9ec0' },
  { name: 'green', color: '#8eba8e' },
  { name: 'sand', color: '#d1b88a' },
  { name: 'rose', color: '#cf9cab' },
  { name: 'lavender', color: '#a99fc4' },
  { name: 'black', color: '#2a2a2a' }
]

export const DEFAULT_FONT_SCALE_OPTIONS: readonly {
  readonly label: '特小' | '小' | '中' | '大' | '特大'
  readonly scale: ReaderFontScale
}[] = [
  { label: '特小', scale: 0.5 },
  { label: '小', scale: 0.75 },
  { label: '中', scale: 1 },
  { label: '大', scale: 1.5 },
  { label: '特大', scale: 2 }
]

export const DEFAULT_LINE_HEIGHT_OPTIONS: readonly ReaderLineHeight[] = [
  1, 1.2, 1.5, 1.8, 2
]

export const DEFAULT_LAYOUT_ZOOM_OPTIONS: readonly {
  readonly label: string
  readonly zoom: ReaderLayoutZoom
}[] = [
  { label: '25%', zoom: 0.25 },
  { label: '50%', zoom: 0.5 },
  { label: '75%', zoom: 0.75 },
  { label: '100%', zoom: 1 },
  { label: '150%', zoom: 1.5 },
  { label: '200%', zoom: 2 },
  { label: '300%', zoom: 3 },
  { label: '适配宽度', zoom: 'fit-width' }
]

export function getFontScaleLabel(fontScale: ReaderFontScale): string {
  return (
    DEFAULT_FONT_SCALE_OPTIONS.find((option) => option.scale === fontScale)
      ?.label ?? '大'
  )
}

export function getTranslucentColor(hex: string): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return hex
  const value = match[1]
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, 0.35)`
}
