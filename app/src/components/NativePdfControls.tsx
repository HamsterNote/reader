import { Image, Pressable, Text, View } from 'react-native'
import type { PdfTool } from '../../../src/nativePdf/contracts'
import type { NativePageEditUndo } from '../../../src/nativePdf/pageEdit'
import {
  NATIVE_INK_COLORS,
  NATIVE_INK_WIDTHS
} from '../../../src/nativePdf/strokes'

type NativePdfControlsProps = {
  status: string
  rangesOpen: boolean
  setRangesOpen: (value: boolean | ((current: boolean) => boolean)) => void
  outlineOpen: boolean
  setOutlineOpen: (value: boolean | ((current: boolean) => boolean)) => void
  page: number
  pageCount: number
  ocrEnabled: boolean
  ocrDisabled: boolean
  toggleOcr: () => void
  beginPageEdit: () => void
  tool: PdfTool
  selectTool: (tool: PdfTool) => void
  undoNativeDrawing: () => void
  redoNativeDrawing: () => void
  clearCurrentPageInk: () => void
  ink: { color: string; width: number }
  selectInk: (next: { color?: string; width?: number }) => void
  hiddenPagesUndo: NativePageEditUndo | null
  undoPageEdit: () => void
  allowedPages: number[]
  enqueue: (body: Record<string, unknown>) => void
  ranges: { id: string; text: string }[]
  post: (body: Record<string, unknown>) => unknown
  outline: { title: string; pageNumber: number }[]
  saveError: string | null
  retryFailedSave: () => void
  preview: string | null
  setPreview: (value: string | null) => void
}

type NativePdfAuxiliaryPanelsProps = Pick<
  NativePdfControlsProps,
  | 'rangesOpen'
  | 'setRangesOpen'
  | 'outlineOpen'
  | 'setOutlineOpen'
  | 'ranges'
  | 'post'
  | 'outline'
  | 'enqueue'
  | 'saveError'
  | 'retryFailedSave'
  | 'preview'
  | 'setPreview'
>

function NativePdfAuxiliaryPanels({
  rangesOpen,
  setRangesOpen,
  outlineOpen,
  setOutlineOpen,
  ranges,
  post,
  outline,
  enqueue,
  saveError,
  retryFailedSave,
  preview,
  setPreview
}: NativePdfAuxiliaryPanelsProps) {
  return (
    <>
      {rangesOpen ? (
        <View style={{ maxHeight: 180 }}>
          {ranges.map((range) => (
            <Pressable
              key={range.id}
              onPress={() => {
                post({ type: 'activate', rangeId: range.id })
                setRangesOpen(false)
              }}
            >
              <Text numberOfLines={1}>{range.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {outlineOpen ? (
        <View style={{ maxHeight: 180 }}>
          {outline.map((item, index) => (
            <Pressable
              key={index}
              onPress={() => {
                enqueue({ type: 'navigate', pageNumber: item.pageNumber })
                setOutlineOpen(false)
              }}
            >
              <Text>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {saveError ? (
        <Pressable onPress={retryFailedSave}>
          <Text role='alert'>{saveError}（点此重试）</Text>
        </Pressable>
      ) : null}
      {preview ? (
        <Pressable onPress={() => setPreview(null)}>
          <Image
            source={{ uri: preview }}
            style={{ width: 100, height: 140 }}
            resizeMode='contain'
          />
          <Text>关闭预览</Text>
        </Pressable>
      ) : null}
    </>
  )
}

export function NativePdfControls(props: NativePdfControlsProps) {
  const {
    status,
    setRangesOpen,
    setOutlineOpen,
    page,
    pageCount,
    ocrEnabled,
    ocrDisabled,
    toggleOcr,
    beginPageEdit,
    tool,
    selectTool,
    undoNativeDrawing,
    redoNativeDrawing,
    clearCurrentPageInk,
    ink,
    selectInk,
    hiddenPagesUndo,
    undoPageEdit,
    allowedPages,
    enqueue
  } = props
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <Text>{status}</Text>
        <Pressable onPress={() => setRangesOpen((value) => !value)}>
          <Text>高亮列表</Text>
        </Pressable>
        <Pressable onPress={() => setOutlineOpen((value) => !value)}>
          <Text>目录</Text>
        </Pressable>
        <Text>
          {page}/{pageCount}
        </Text>
        <Pressable
          accessibilityRole='button'
          accessibilityState={{ checked: ocrEnabled, disabled: ocrDisabled }}
          onPress={toggleOcr}
        >
          <Text>OCR {ocrEnabled ? '开' : '关'}</Text>
        </Pressable>
        <Pressable onPress={beginPageEdit}>
          <Text>裁切/隐藏页编辑</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={
            tool === 'rectangle' ? '关闭矩形工具' : '矩形标注'
          }
          accessibilityState={{ selected: tool === 'rectangle' }}
          onPress={() =>
            selectTool(tool === 'rectangle' ? 'none' : 'rectangle')
          }
        >
          <Text>矩形{tool === 'rectangle' ? '（开）' : ''}</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='撤销标注'
          onPress={undoNativeDrawing}
        >
          <Text>撤销标注</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={tool === 'draw' ? '关闭绘图工具' : '自由绘图'}
          accessibilityState={{ selected: tool === 'draw' }}
          onPress={() => selectTool(tool === 'draw' ? 'none' : 'draw')}
        >
          <Text>绘图{tool === 'draw' ? '（开）' : ''}</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='重做标注'
          onPress={redoNativeDrawing}
        >
          <Text>重做</Text>
        </Pressable>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='清空当前页笔迹'
          onPress={clearCurrentPageInk}
        >
          <Text>清空本页</Text>
        </Pressable>
        {NATIVE_INK_COLORS.map((color) => (
          <Pressable
            key={color}
            accessibilityRole='button'
            accessibilityLabel={`笔迹颜色 ${color}`}
            accessibilityState={{ selected: ink.color === color }}
            onPress={() => selectInk({ color })}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: color,
              borderWidth: ink.color === color ? 3 : 1,
              borderColor: ink.color === color ? '#1f2328' : '#d0d7de'
            }}
          />
        ))}
        {NATIVE_INK_WIDTHS.map((width) => (
          <Pressable
            key={width}
            accessibilityRole='button'
            accessibilityLabel={`笔迹线宽 ${width}`}
            accessibilityState={{ selected: ink.width === width }}
            onPress={() => selectInk({ width })}
          >
            <Text>{ink.width === width ? `●${width}` : `○${width}`}</Text>
          </Pressable>
        ))}
        {hiddenPagesUndo ? (
          <Pressable onPress={undoPageEdit}>
            <Text>撤销（5秒）</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() =>
            enqueue({
              type: 'navigate',
              pageNumber:
                allowedPages[Math.max(0, allowedPages.indexOf(page) - 1)] ??
                page
            })
          }
        >
          <Text>上一页</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            enqueue({
              type: 'navigate',
              pageNumber:
                allowedPages[
                  Math.min(
                    allowedPages.length - 1,
                    allowedPages.indexOf(page) + 1
                  )
                ] ?? page
            })
          }
        >
          <Text>下一页</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            enqueue({
              type: 'preview',
              pageNumber:
                allowedPages[
                  Math.min(
                    allowedPages.length - 1,
                    allowedPages.indexOf(page) + 1
                  )
                ] ?? page,
              width: 160
            })
          }
        >
          <Text>预览下一页</Text>
        </Pressable>
        <Pressable onPress={() => enqueue({ type: 'scale', value: 2 })}>
          <Text>200%</Text>
        </Pressable>
        <Pressable onPress={() => enqueue({ type: 'scale', value: 1 })}>
          <Text>100%</Text>
        </Pressable>
      </View>
      <NativePdfAuxiliaryPanels {...props} />
    </>
  )
}
