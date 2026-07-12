import type { DrawingValue } from '@hamster-note/painting'
import { Reader, type ReaderPageTool } from '@hamster-note/reader'
import type { SelectionRange, SelectionRect } from '@hamster-note/selection'
import {
  type IntermediateDocumentSerialized,
  type IntermediateTextSerialized,
  TextDir
} from '@hamster-note/types'
import { useState } from 'react'

import '@hamster-note/reader/style.css'
import '@hamster-note/selection/style.css'

function assertNever(value: never): never {
  throw new Error(`Unexpected demo tool: ${value}`)
}

function makeText(
  id: string,
  content: string,
  x: number,
  y: number,
  width: number
): IntermediateTextSerialized {
  return {
    id,
    content,
    fontSize: 30,
    fontFamily: 'Georgia',
    fontWeight: 500,
    italic: false,
    color: '#0f172a',
    width,
    height: 42,
    lineHeight: 42,
    x,
    y,
    ascent: 30,
    descent: 12,
    dir: TextDir.LTR,
    rotate: 0,
    skew: 0,
    isEOL: true
  }
}

const demoDocument: IntermediateDocumentSerialized = {
  id: 'demo-document',
  title: 'Demo Document Title',
  pages: [
    {
      id: 'page-1',
      number: 1,
      width: 1080,
      height: 1528,
      texts: [
        makeText(
          'page-1-line-1',
          'HamsterNote lets you switch between text selection, rectangle selection, and freehand drawing.',
          96,
          120,
          860
        ),
        makeText(
          'page-1-line-2',
          'Use the text tool to highlight words, then switch to the rectangle tool to mark an area.',
          96,
          190,
          830
        ),
        makeText(
          'page-1-line-3',
          'Finally, switch to drawing and sketch directly on top of the page surface.',
          96,
          260,
          760
        )
      ],
      thumbnail: undefined
    },
    {
      id: 'page-2',
      number: 2,
      width: 1080,
      height: 1528,
      texts: [
        makeText(
          'page-2-line-1',
          'The page keeps each tool separated so selection and drawing do not fight for the same interaction layer.',
          96,
          120,
          890
        ),
        makeText(
          'page-2-line-2',
          'This demo also exposes all captured data below so integrators can inspect and persist it.',
          96,
          190,
          840
        )
      ],
      thumbnail: undefined
    }
  ]
}

function getToolLabel(tool: ReaderPageTool): string {
  switch (tool) {
    case 'text-selection':
      return '文本选择'
    case 'rect-selection':
      return '矩形选择'
    case 'drawing':
      return '绘图'
    default:
      return assertNever(tool)
  }
}

export function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [selectedTool, setSelectedTool] =
    useState<ReaderPageTool>('text-selection')
  const [pagePaintings, setPagePaintings] = useState<Record<string, DrawingValue>>(
    {}
  )
  const [pageTextSelections, setPageTextSelections] = useState<
    Record<string, readonly SelectionRange[]>
  >({})
  const [pageRectSelections, setPageRectSelections] = useState<
    Record<string, readonly SelectionRect[]>
  >({})

  const handleFileUpload = (file: File) => {
    setUploadedFile(file)
    console.log('File uploaded:', file.name, file.size, file.type)
  }

  return (
    <main data-testid='reader-demo-root' style={{ padding: '24px' }}>
      <h1>Hamster Reader Demo</h1>
      <section
        style={{
          marginBottom: '24px',
          padding: '16px',
          border: '1px solid #dbe4f0',
          borderRadius: '12px',
          background: '#f8fafc'
        }}
      >
        <h2>Three Tool Demo</h2>
        <p>
          当前工具：<strong>{getToolLabel(selectedTool)}</strong>
        </p>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          <button
            type='button'
            onClick={() => setSelectedTool('text-selection')}
          >
            文本选择
          </button>
          <button
            type='button'
            onClick={() => setSelectedTool('rect-selection')}
          >
            矩形选择
          </button>
          <button type='button' onClick={() => setSelectedTool('drawing')}>
            绘图
          </button>
        </div>
        <p style={{ margin: 0, color: '#475569' }}>
          文本选择用于高亮文字，矩形选择用于框选区域，绘图用于自由绘制和双指缩放平移。
        </p>
      </section>
      <section style={{ marginBottom: '24px' }}>
        <h2>With Document</h2>
        <Reader
          document={demoDocument}
          selectedTool={selectedTool}
          pagePaintings={pagePaintings}
          pageTextSelections={pageTextSelections}
          pageRectSelections={pageRectSelections}
          onPagePaintingsChange={setPagePaintings}
          onPageTextSelectionsChange={(pageId, nextSelections, nextPageSelections) => {
            setPageTextSelections(nextPageSelections)
            console.log('text selections', pageId, nextSelections)
          }}
          onPageRectSelectionsChange={(pageId, nextSelections, nextPageSelections) => {
            setPageRectSelections(nextPageSelections)
            console.log('rect selections', pageId, nextSelections)
          }}
        />
      </section>
      <section style={{ marginBottom: '24px' }}>
        <h2>Upload Zone (no document)</h2>
        <Reader
          onFileUpload={handleFileUpload}
          emptyText='No document loaded'
        />
      </section>
      {uploadedFile && (
        <section>
          <h2>Last Uploaded File</h2>
          <p>Name: {uploadedFile.name}</p>
          <p>Size: {uploadedFile.size} bytes</p>
          <p>Type: {uploadedFile.type}</p>
        </section>
      )}
      <section
        style={{
          marginTop: '24px',
          padding: '16px',
          borderRadius: '12px',
          background: '#0f172a',
          color: '#e2e8f0'
        }}
      >
        <h2>Reader Data</h2>
        <pre
          data-testid='reader-data-output'
          style={{
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {JSON.stringify(
            {
              selectedTool,
              pageTextSelections,
              pageRectSelections,
              pagePaintings
            },
            null,
            2
          )}
        </pre>
      </section>
    </main>
  )
}
