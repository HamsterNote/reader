import { createRoot } from 'react-dom/client'
import {
  IntermediateText,
  TextDir,
  type IntermediateDocument
} from '@hamster-note/types'
import { Reader } from '../../src/components/Reader'
import '../../src/styles/index.scss'

const texts = Array.from(
  { length: 180 },
  (_, index) =>
    new IntermediateText({
      id: `txt-${index}`,
      content: `Original scrolling line ${index}`,
      fontSize: 12,
      fontFamily: 'serif',
      fontWeight: 400,
      italic: false,
      color: '#111',
      polygon: [
        [0, index * 20],
        [200, index * 20],
        [200, index * 20 + 20],
        [0, index * 20 + 20]
      ],
      lineHeight: 18,
      ascent: 12,
      descent: 3,
      dir: TextDir.LTR,
      skew: 0,
      isEOL: true
    })
)
const document = {
  id: 'txt-scroll',
  title: 'TXT scrolling',
  pageCount: 1,
  pageNumbers: [1],
  getPageSizeByPageNumber: () => ({ x: 600, y: 800 }),
  getPageByPageNumber: async () => ({ getContent: async () => texts })
} as unknown as IntermediateDocument
createRoot(window.document.getElementById('root')!).render(
  <div style={{ height: '100vh' }}>
    <Reader document={document} renderMode='text' />
  </div>
)
