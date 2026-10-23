/** Original bytes stay outside persisted ReaderData. Memoize this object per file. */
export type ReaderEngineSource = {
  readonly format: 'epub' | 'pdf'
  readonly data: Uint8Array
  readonly workerSrc?: string
  readonly documentOptions?: Readonly<Record<string, unknown>>
}
