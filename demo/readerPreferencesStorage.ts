import type {
  ReaderFontScale,
  ReaderPageTool,
  ReaderRenderMode
} from '@hamster-note/reader'

export type ReaderPreferences = {
  readonly renderMode: ReaderRenderMode
  readonly selectedTool: ReaderPageTool
  readonly textFontScale: ReaderFontScale
  readonly layoutFontScale: ReaderFontScale
  readonly highlightColor: string
}

type StoredReaderPreferences = ReaderPreferences & {
  readonly version: 2
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

function isReaderFontScale(value: unknown): value is ReaderFontScale {
  return (
    value === 0.5 ||
    value === 0.75 ||
    value === 1 ||
    value === 1.5 ||
    value === 2
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
      (parsed.version !== 1 && parsed.version !== 2) ||
      !('renderMode' in parsed) ||
      !isReaderRenderMode(parsed.renderMode) ||
      !('selectedTool' in parsed) ||
      !isReaderPageTool(parsed.selectedTool)
    ) {
      return fallback
    }

    if (parsed.version === 1) {
      return {
        ...fallback,
        renderMode: parsed.renderMode,
        selectedTool: parsed.selectedTool
      }
    }
    if (
      !('textFontScale' in parsed) ||
      !isReaderFontScale(parsed.textFontScale) ||
      !('layoutFontScale' in parsed) ||
      !isReaderFontScale(parsed.layoutFontScale) ||
      !('highlightColor' in parsed) ||
      typeof parsed.highlightColor !== 'string' ||
      parsed.highlightColor.trim() === ''
    ) {
      return fallback
    }

    return {
      renderMode: parsed.renderMode,
      selectedTool: parsed.selectedTool,
      textFontScale: parsed.textFontScale,
      layoutFontScale: parsed.layoutFontScale,
      highlightColor: parsed.highlightColor
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
    version: 2,
    ...preferences
  }
  return JSON.stringify(storedPreferences)
}
