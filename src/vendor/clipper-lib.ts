import * as clipperModule from 'clipper-lib/clipper.js'

type ClipperGlobal = typeof globalThis & {
  ClipperLib?: unknown
}

type ClipperModule = typeof clipperModule & {
  default?: unknown
}

const clipperGlobal: ClipperGlobal = globalThis
const clipperDefault = (clipperModule as ClipperModule).default
const ClipperLib = clipperDefault ?? clipperGlobal.ClipperLib

if (ClipperLib === undefined) {
  throw new Error('clipper-lib failed to initialize ClipperLib')
}

export default ClipperLib
