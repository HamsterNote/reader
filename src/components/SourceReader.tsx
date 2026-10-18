import type { IntermediateDocumentSerialized } from '@hamster-note/types'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import {
  isPdfSource,
  LocalSourceError,
  parseLocalEpub,
  readLocalSource
} from '../pdf/localSource'
import type { PdfSource } from '../pdf-contracts'
import { LegacyReader, type ReaderProps } from './Reader'

const PdfReader = lazy(() => import('../pdf/PdfReader'))

type OpenedSource = {
  readonly source: PdfSource
  readonly bytes?: Uint8Array
  readonly document?: IntermediateDocumentSerialized
  readonly error?: string
}

export function SourceReader(props: ReaderProps & { source: PdfSource }) {
  const [opened, setOpened] = useState<OpenedSource | null>(null)
  const callback = useRef(props.onStateChange)
  callback.current = props.onStateChange
  useEffect(() => {
    let current = true
    const abort = new AbortController()
    const source = props.source
    let owned: Uint8Array | undefined
    setOpened(null)
    callback.current?.({ status: 'loading' })
    const open = async () => {
      try {
        owned = await readLocalSource(source, abort.signal)
        if (!current) {
          owned.fill(0)
          return
        }
        if (isPdfSource(owned)) {
          setOpened({ source, bytes: owned })
          return
        }
        const document = await parseLocalEpub(owned)
        if (!current) return
        setOpened({ source, document })
        callback.current?.({ status: 'ready' })
      } catch (error) {
        if (!current) return
        const failure =
          error instanceof LocalSourceError
            ? error
            : new LocalSourceError('invalid', 'INVALID_DOCUMENT')
        setOpened({ source, error: failure.message })
        callback.current?.({
          status: 'error',
          error: {
            category: failure.category,
            code: failure.code,
            message: failure.message
          }
        })
      }
    }
    open().catch(() => undefined)
    return () => {
      current = false
      abort.abort()
      owned?.fill(0)
    }
  }, [props.source])
  if (!opened || opened.source !== props.source) {
    return <div className={props.className} aria-busy='true' />
  }
  if (opened.error) return <div role='alert'>{opened.error}</div>
  if (opened.document) {
    return (
      <LegacyReader
        {...props}
        source={undefined}
        document={opened.document}
        isEpub
      />
    )
  }
  return (
    <Suspense fallback={<div aria-busy='true' />}>
      <PdfReader
        source={opened.bytes!}
        className={props.className}
        assetBaseUrl={props.pdfAssetBaseUrl}
        onStateChange={props.onStateChange}
        onPageChange={props.onPdfPageChange}
      />
    </Suspense>
  )
}
