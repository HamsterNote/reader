import type {
  LayeredEditorTool,
  LayeredToolsSnapshot
} from '@hamster-note/painting/core'

export function createPaintingSettings(
  activeTool: LayeredEditorTool = 'freehand',
  color = '#2563eb'
): LayeredToolsSnapshot {
  return {
    activeTool,
    settings: {
      freehand: {
        color,
        nominalSize: 3,
        opacity: 1,
        pressureMode: 'auto',
        presetRevision: 0
      },
      shape: { color, width: 3, opacity: 1 }
    }
  }
}

/** The reader toolbar color controls both brushes; saved objects are never restyled. */
export function withPaintingColor(
  tools: LayeredToolsSnapshot,
  color: string,
  activeTool = tools.activeTool
): LayeredToolsSnapshot {
  return {
    activeTool,
    settings: {
      freehand: { ...tools.settings.freehand, color },
      shape: { ...tools.settings.shape, color }
    }
  }
}
