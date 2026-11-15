export type PdfMetadataExperimentConfig = {
  readonly enabled: boolean
  readonly metadataOnly: boolean
  readonly batchSize: 0 | 8 | 1
}

/** Build-time opt-in only; controls without the master switch are mistakes. */
export function parsePdfMetadataExperimentConfig(
  env: Readonly<Record<string, string | undefined>>
): PdfMetadataExperimentConfig {
  const enabled = env.VITE_READER_PDF_METADATA_DIAGNOSTICS ?? '0'
  const only = env.VITE_READER_PDF_METADATA_ONLY ?? '0'
  const batch = env.VITE_READER_PDF_METADATA_BATCH_SIZE ?? '0'
  if (
    !['0', '1'].includes(enabled) ||
    !['0', '1'].includes(only) ||
    !['0', '8', '1'].includes(batch)
  ) {
    throw new Error(
      'Invalid Web PDF metadata diagnostics env: DIAGNOSTICS/ONLY must be 0 or 1; BATCH_SIZE must be 0, 8 or 1'
    )
  }
  if (enabled !== '1' && (only !== '0' || batch !== '0')) {
    throw new Error(
      'Web PDF metadata controls require VITE_READER_PDF_METADATA_DIAGNOSTICS=1'
    )
  }
  return {
    enabled: enabled === '1',
    metadataOnly: only === '1',
    batchSize: Number(batch) as 0 | 8 | 1
  }
}
