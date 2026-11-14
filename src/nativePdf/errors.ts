export type NativePdfError = {
  readonly code: string
  readonly message?: string
}

/** Keep a confirmed native classification ahead of auxiliary WebView errors. */
export function shouldReplaceNativePdfError(
  existing: NativePdfError | null,
  _next: NativePdfError
): boolean {
  return existing === null
}

export function nativePdfErrorMessage(error: NativePdfError): string {
  if (error.code === 'PASSWORD_REQUIRED') return 'No password given'
  return error.message ?? error.code
}
