const diagnosticsGlobals = globalThis as typeof globalThis & {
  __DEV__?: boolean
  __READER_NATIVE_PDF_DIAGNOSTICS__?: boolean
}

export function logNativePdfDiagnostic(
  message: string,
  payload?: unknown
): void {
  if (
    diagnosticsGlobals.__DEV__ !== true &&
    diagnosticsGlobals.__READER_NATIVE_PDF_DIAGNOSTICS__ !== true
  )
    return
  console.info(message, payload)
}
