import { PdfParser } from '@hamster-note/pdf-parser'
import type { ReaderSavedSelection } from '@hamster-note/reader'
import {
  IntermediateDocument,
  type IntermediateDocumentSerialized
} from '@hamster-note/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../demo/App'

// 选区评论流程集成测试
// 与 demo.test.tsx 共用 mock 模式：mock PdfParser.encode 与 Reader 组件，
// 让 demo 在 jsdom 中跑「保存选区 → 激活 → 评论」交互闭环。

vi.mock('@hamster-note/pdf-parser', () => ({
  PdfParser: { encode: vi.fn() }
}))

const mockReaderProps: unknown[] = []

vi.mock('@hamster-note/reader', async (importOriginal) => {
  // 部分 mock：保留库内纯函数（buildSavedSelection 等），仅替换 Reader 组件
  const actual = await importOriginal<typeof import('@hamster-note/reader')>()
  return {
    ...actual,
    Reader: (props: {
      document?: IntermediateDocument | IntermediateDocumentSerialized | null
      emptyText?: string
      onFileUpload?: (file: File) => void
      savedSelections?: ReaderSavedSelection[]
      onSavedSelectionEdit?: (
        id: string,
        nextSelection: ReaderSavedSelection
      ) => void
      activeSavedSelectionId?: string | null
      onActiveSavedSelectionChange?: (id: string | null) => void
    }) => {
      mockReaderProps.push(props)
      return (
        <div data-testid='mock-reader'>
          {props.document ? props.document.title : props.emptyText}
          {props.onFileUpload && (
            <input
              data-testid='file-input'
              type='file'
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) {
                  props.onFileUpload?.(file)
                }
              }}
            />
          )}
          {/* 渲染 saved overlay 占位 path：demo 浮动按钮通过 selector 找 anchor */}
          {props.savedSelections && props.savedSelections.length > 0 ? (
            <svg
              data-testid='mock-saved-selection-overlay'
              style={{ position: 'absolute', inset: 0 }}
            >
              <title>mock saved selection overlay</title>
              {props.savedSelections.map((selection) => (
                <path
                  key={selection.id}
                  data-saved-selection-id={selection.id}
                  data-testid={`mock-saved-path-${selection.id}`}
                  d='M0,0 L10,0 L10,10 L0,10 Z'
                />
              ))}
            </svg>
          ) : null}
        </div>
      )
    }
  }
})

function makeRuntimeDocument(title: string) {
  return IntermediateDocument.parse({
    id: title.toLowerCase().replaceAll(' ', '-'),
    title,
    pages: []
  })
}

function makeFile(name: string) {
  const file = new File(['pdf'], name, { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: 3 })
  return file
}

function upload(file: File) {
  fireEvent.change(screen.getByTestId('file-input'), {
    target: { files: [file] }
  })
}

function getLatestParsedReaderProps() {
  for (let index = mockReaderProps.length - 1; index >= 0; index -= 1) {
    const props = mockReaderProps[index]
    if (
      props &&
      typeof props === 'object' &&
      'document' in props &&
      (props as { document?: unknown }).document
    ) {
      return props as {
        savedSelections?: ReaderSavedSelection[]
        onActiveSavedSelectionChange?: (id: string | null) => void
      }
    }
  }
  return undefined
}

const STORAGE_KEY = 'hamster-reader-saved-selections'

/** 构造合法的保存选区 fixture */
function makeValidSavedSelection(
  id: string,
  text = 'Hello World'
): ReaderSavedSelection {
  return {
    version: 1,
    id,
    text,
    start: { pageNumber: 1, charIndex: 0 },
    end: { pageNumber: 1, charIndex: text.length },
    segments: [
      {
        pageNumber: 1,
        startCharIndex: 0,
        endCharIndex: text.length,
        selectedText: text
      }
    ],
    visual: [
      {
        pageNumber: 1,
        pageSize: { width: 612, height: 792 },
        rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
      }
    ]
  }
}

/** 上传文件 + 加载已存选区 + 激活指定 id */
async function setupActiveSelection(savedSelectionId: string) {
  const selection = makeValidSavedSelection(
    savedSelectionId,
    'Selected text for commenting'
  )
  localStorage.setItem(STORAGE_KEY, JSON.stringify([selection]))
  vi.mocked(PdfParser.encode).mockResolvedValue(
    makeRuntimeDocument('Comment Document')
  )
  render(<App />)
  upload(makeFile('comment.pdf'))
  expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

  fireEvent.click(screen.getByTestId('load-selections-button'))

  const onActiveSavedSelectionChange =
    getLatestParsedReaderProps()?.onActiveSavedSelectionChange
  expect(onActiveSavedSelectionChange).toBeDefined()
  act(() => {
    onActiveSavedSelectionChange?.(savedSelectionId)
  })

  return selection
}

describe('demo selection comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReaderProps.length = 0
    localStorage.clear()

    // jsdom 的 SVGElement.getBoundingClientRect 默认返回全 0；
    // 但 demo 浮动按钮位置计算会过滤掉 width/height 为 0 的 path。
    // 这里给所有匹配 [data-saved-selection-id] 的元素临时返回有意义的 rect，
    // 让 useLayoutEffect 能解析出 anchor 并渲染浮动按钮。
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (
        this instanceof Element &&
        this.hasAttribute('data-saved-selection-id')
      ) {
        return {
          x: 100,
          y: 200,
          left: 100,
          top: 200,
          right: 200,
          bottom: 220,
          width: 100,
          height: 20,
          toJSON() {
            return {}
          }
        } as DOMRect
      }
      return originalGetBoundingClientRect.call(this)
    }
  })

  it('S2: hides floating button when no overlay is active', async () => {
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('No Active Doc')
    )
    render(<App />)
    upload(makeFile('no-active.pdf'))
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

    expect(
      screen.queryByTestId('comment-floating-button')
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('comment-dialog')).not.toBeInTheDocument()
  })

  it('S1: opens dialog and persists a new comment to localStorage', async () => {
    await setupActiveSelection('comment-target-1')

    const floatingButton = await screen.findByTestId('comment-floating-button')
    expect(floatingButton).toBeInTheDocument()

    fireEvent.click(floatingButton)
    expect(screen.getByTestId('comment-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('comment-empty')).toBeInTheDocument()

    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'first comment text' } })

    const sendButton = screen.getByTestId('comment-send-button')
    expect(sendButton).toBeEnabled()
    fireEvent.click(sendButton)

    const items = await screen.findAllByTestId('comment-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('first comment text')

    // 校验持久化
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    ) as ReaderSavedSelection[]
    expect(stored).toHaveLength(1)
    expect(stored[0]?.comments).toHaveLength(1)
    expect(stored[0]?.comments?.[0]?.text).toBe('first comment text')
    expect(typeof stored[0]?.comments?.[0]?.id).toBe('string')
    expect(typeof stored[0]?.comments?.[0]?.createdAt).toBe('number')

    // 草稿被清空
    expect(input.value).toBe('')
  })

  it('S3: send button is disabled for empty / whitespace-only drafts', async () => {
    await setupActiveSelection('comment-target-2')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))

    const sendButton = screen.getByTestId(
      'comment-send-button'
    ) as HTMLButtonElement
    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement

    // 初始空 -> 禁用
    expect(sendButton).toBeDisabled()

    // 仅空白 -> 仍禁用
    fireEvent.change(input, { target: { value: '   \n\t  ' } })
    expect(sendButton).toBeDisabled()

    // 有效内容 -> 启用
    fireEvent.change(input, { target: { value: 'ok' } })
    expect(sendButton).toBeEnabled()
  })

  it('Enter key sends the comment when not composing and Shift not held', async () => {
    await setupActiveSelection('comment-target-3')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))

    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'enter-send' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const items = await screen.findAllByTestId('comment-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('enter-send')
    expect(input.value).toBe('')
  })

  it('Shift+Enter does NOT send the comment', async () => {
    await setupActiveSelection('comment-target-4')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))

    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'line1' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(screen.queryAllByTestId('comment-item')).toHaveLength(0)
    expect(input.value).toBe('line1')
  })

  it('Esc key closes the comment dialog', async () => {
    await setupActiveSelection('comment-target-5')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))
    expect(screen.getByTestId('comment-dialog')).toBeInTheDocument()

    const input = screen.getByTestId('comment-input')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByTestId('comment-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('comment-floating-button')).toBeInTheDocument()
  })

  it('backdrop click closes the comment dialog', async () => {
    await setupActiveSelection('comment-target-6')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))
    expect(screen.getByTestId('comment-dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('comment-dialog-backdrop'))
    expect(screen.queryByTestId('comment-dialog')).not.toBeInTheDocument()
  })

  it('close button closes dialog without sending unsaved draft', async () => {
    await setupActiveSelection('comment-target-7')
    fireEvent.click(await screen.findByTestId('comment-floating-button'))

    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'unsaved draft' } })
    fireEvent.click(screen.getByTestId('comment-dialog-close'))

    expect(screen.queryByTestId('comment-dialog')).not.toBeInTheDocument()

    // 关闭按钮不应触发持久化
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    ) as ReaderSavedSelection[]
    expect(stored[0]?.comments ?? []).toHaveLength(0)
  })

  it('S5: switching active overlay shows the corresponding comments only', async () => {
    // 准备两个选区，第一个携带历史评论
    const first: ReaderSavedSelection = {
      ...makeValidSavedSelection('switch-id-1', 'First selection'),
      comments: [
        { id: 'c-1', text: 'Comment on first', createdAt: 1700000000000 }
      ]
    }
    const second = makeValidSavedSelection('switch-id-2', 'Second selection')

    localStorage.setItem(STORAGE_KEY, JSON.stringify([first, second]))
    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Switch Document')
    )
    render(<App />)
    upload(makeFile('switch.pdf'))
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('load-selections-button'))

    const onActiveSavedSelectionChange =
      getLatestParsedReaderProps()?.onActiveSavedSelectionChange

    // 激活第一个 -> 显示历史评论
    act(() => {
      onActiveSavedSelectionChange?.('switch-id-1')
    })
    fireEvent.click(await screen.findByTestId('comment-floating-button'))
    let items = screen.getAllByTestId('comment-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Comment on first')

    fireEvent.click(screen.getByTestId('comment-dialog-close'))

    // 切换到第二个 -> 显示空状态
    act(() => {
      onActiveSavedSelectionChange?.('switch-id-2')
    })
    fireEvent.click(await screen.findByTestId('comment-floating-button'))
    expect(screen.getByTestId('comment-empty')).toBeInTheDocument()
    items = screen.queryAllByTestId('comment-item')
    expect(items).toHaveLength(0)
  })

  it('S4 regression: legacy stored selection (no comments) loads + edits without losing fields', async () => {
    // 历史数据无 comments 字段 -> 仍可加载、添加评论且原字段不丢失
    const original = makeValidSavedSelection('legacy-id', 'Legacy text')
    localStorage.setItem(STORAGE_KEY, JSON.stringify([original]))

    vi.mocked(PdfParser.encode).mockResolvedValue(
      makeRuntimeDocument('Legacy Document')
    )
    render(<App />)
    upload(makeFile('legacy.pdf'))
    expect(await screen.findByText('Parsed Document')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('load-selections-button'))
    const onActiveSavedSelectionChange =
      getLatestParsedReaderProps()?.onActiveSavedSelectionChange
    act(() => {
      onActiveSavedSelectionChange?.('legacy-id')
    })

    fireEvent.click(await screen.findByTestId('comment-floating-button'))
    const input = screen.getByTestId('comment-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'first comment' } })
    fireEvent.click(screen.getByTestId('comment-send-button'))

    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    ) as ReaderSavedSelection[]
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe('legacy-id')
    expect(stored[0]?.text).toBe('Legacy text')
    expect(stored[0]?.version).toBe(1)
    expect(stored[0]?.start).toEqual(original.start)
    expect(stored[0]?.end).toEqual(original.end)
    expect(stored[0]?.segments).toEqual(original.segments)
    expect(stored[0]?.visual).toEqual(original.visual)
    expect(stored[0]?.comments).toHaveLength(1)
    expect(stored[0]?.comments?.[0]?.text).toBe('first comment')
  })
})
