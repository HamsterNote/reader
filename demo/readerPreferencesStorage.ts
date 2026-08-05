import type {
  ReaderPageTool,
  ReaderRenderMode
} from '@hamster-note/reader'

export type ReaderPreferences = {
  readonly renderMode: ReaderRenderMode
  readonly selectedTool: ReaderPageTool
}

type StoredReaderPreferences = ReaderPreferences & {
  readonly version: 1
}

function isReaderRenderMode(value: unknown): value is ReaderRenderMode {
  return value === 'layout' || value === 'text'
}

function isReaderPageTool(value: unknown): value is ReaderPageTool {
  return (
    value === 'text-selection' ||
    value === 'rect-selection' ||
    value === 'drawing'
  )
}

export function parseReaderPreferences(
  raw: string | null,
  fallback: ReaderPreferences
): ReaderPreferences {
  if (raw === null || raw.trim() === '') return fallback

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('renderMode' in parsed) ||
      !isReaderRenderMode(parsed.renderMode) ||
      !('selectedTool' in parsed) ||
      !isReaderPageTool(parsed.selectedTool)
    ) {
      return fallback
    }

    return {
      renderMode: parsed.renderMode,
      selectedTool: parsed.selectedTool
    }
  } catch (error) {
    if (error instanceof SyntaxError) return fallback
    throw error
  }
}

export function serializeReaderPreferences(
  preferences: ReaderPreferences
): string {
  const storedPreferences: StoredReaderPreferences = {
    version: 1,
    ...preferences
  }
  return JSON.stringify(storedPreferences)
}
