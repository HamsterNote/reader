import type { ToolbarFile } from '@hamster-note/painting/toolbar'
import type { ReaderProps } from '../components/Reader'
import type { ReaderFileAdapter } from './readerFileSession'
import type { ReaderEngineSource } from '../types/engineSource'

/** Register only the byte formats actually available in this instance. */
export function createReaderByteFileAdapter(options: {
  readonly format: ReaderEngineSource['format']
  readonly read: (file: ToolbarFile) => Promise<Uint8Array>
  readonly props: (file: ToolbarFile) => Promise<ReaderProps>
  readonly workerSrc?: string
  readonly documentOptions?: ReaderEngineSource['documentOptions']
}): ReaderFileAdapter {
  return {
    format: options.format,
    viewProps: options.props,
    load: async (file) => {
      const source: ReaderEngineSource = {
        format: options.format,
        data: await options.read(file),
        workerSrc: options.workerSrc,
        documentOptions: options.documentOptions
      }
      const { openReaderDocument } = await import('./openReaderDocument')
      const opened = await openReaderDocument(source, file.key)
      return {
        props: {
          document: opened.document,
          engineSource: source,
          useVirtualPaper: false,
          isPdf: options.format === 'pdf',
          isEpub: options.format === 'epub'
        },
        dispose: opened.dispose
      }
    }
  }
}
