import { requireNativeView, requireOptionalNativeModule } from 'expo'
import type { ComponentType } from 'react'
import type { ViewProps } from 'react-native'
import type { PdfCommand, PdfEvent } from '../../../src/nativePdf/contracts'
import type { nativeSelectionConfiguration } from '../../../src/nativePdf/selection'
export const readerPdfModule = requireOptionalNativeModule<{
  capabilities: () => {
    nativeLayout: boolean
    thumbnails: boolean
    textGeometry: boolean
    pageImage: boolean
  }
}>('ReaderPdf')
export type ReaderPdfViewProps = ViewProps & {
  command: PdfCommand | null
  configuration: typeof nativeSelectionConfiguration
  onPdfEvent: (event: { nativeEvent: PdfEvent }) => void
}
export const ReaderPdfView = readerPdfModule
  ? (requireNativeView('ReaderPdf') as ComponentType<ReaderPdfViewProps>)
  : null
