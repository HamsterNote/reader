/**
 * HAM-278 设备取证用的确定性入口（仅 __DEV__）。
 *
 * 设备验收不能依赖 HID 点击：深链接 / 环境变量直接指定要打开的 PDF，
 * 路由解析结果和打开结果都输出结构化日志。release 构建不解析本模块，
 * 默认入口（书库 → 原生）语义不变。
 */

export type DebugEntrySource = 'deeplink' | 'env'
export type DebugLayout = 'single' | 'split'

export type DebugTarget =
  | { readonly kind: 'fileId'; readonly value: string }
  | { readonly kind: 'path'; readonly value: string }

export type DebugRoute = {
  readonly source: DebugEntrySource
  readonly target: DebugTarget
  readonly layout: DebugLayout
  /** 扫描版样本的 OCR 文字种子（设备绝对路径）；S12 专项用。 */
  readonly ocrSeed?: string
  /** 原始输入，用于日志回溯；不参与业务判断。 */
  readonly raw: string
}

export type DebugEnv = {
  readonly EXPO_PUBLIC_HAM278_ROUTE?: string
  readonly EXPO_PUBLIC_HAM278_OPEN_FILE_ID?: string
  readonly EXPO_PUBLIC_HAM278_OPEN_PDF?: string
  readonly EXPO_PUBLIC_HAM278_LAYOUT?: string
  readonly EXPO_PUBLIC_HAM278_OCR_SEED?: string
}

const DEBUG_URL_PREFIX = 'hamsterreader://'

function decode(value: string): string {
  const trimmed = value.trim()
  try {
    return decodeURIComponent(trimmed.replace(/\+/g, ' '))
  } catch {
    return trimmed
  }
}

/** 手工切分，避免回溯型正则；只关心 authority 与 query。 */
function splitDebugUrl(
  raw: string
): { authority: string; query: string } | null {
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith(DEBUG_URL_PREFIX)) return null
  const rest = trimmed.slice(DEBUG_URL_PREFIX.length)
  const hash = rest.indexOf('#')
  const body = hash === -1 ? rest : rest.slice(0, hash)
  const question = body.indexOf('?')
  const beforeQuery = question === -1 ? body : body.slice(0, question)
  const slash = beforeQuery.indexOf('/')
  const authority = (
    slash === -1 ? beforeQuery : beforeQuery.slice(0, slash)
  ).toLowerCase()
  return {
    authority,
    query: question === -1 ? '' : body.slice(question + 1)
  }
}

function queryParams(query: string): Map<string, string> {
  const params = new Map<string, string>()
  for (const pair of query.split('&')) {
    if (!pair) continue
    const separator = pair.indexOf('=')
    const key = decode(separator === -1 ? pair : pair.slice(0, separator))
    if (!key || params.has(key)) continue
    params.set(key, decode(separator === -1 ? '' : pair.slice(separator + 1)))
  }
  return params
}

function targetFrom(
  fileId: string | undefined,
  path: string | undefined
): DebugTarget | null {
  // fileId 指书库里已有记录；path 指设备上的文件。两者同时给出时优先 fileId，
  // 避免同一条链接里两个目标互相覆盖。
  if (fileId) return { kind: 'fileId', value: fileId }
  if (path) return { kind: 'path', value: path }
  return null
}

function layoutFrom(value: string | undefined): DebugLayout {
  return value?.trim().toLowerCase() === 'split' ? 'split' : 'single'
}

/**
 * `hamsterreader://debug/open?fileId=...&layout=split`
 * `hamsterreader://open?path=<percent-encoded file uri>`
 */
export function parseDebugUrl(
  raw: string,
  source: DebugEntrySource = 'deeplink'
): DebugRoute | null {
  const split = splitDebugUrl(raw)
  if (!split) return null
  if (split.authority !== 'debug' && split.authority !== 'open') return null
  const params = queryParams(split.query)
  const target = targetFrom(
    params.get('fileId')?.trim(),
    params.get('path')?.trim()
  )
  if (!target) return null
  const ocrSeed = params.get('seed')?.trim()
  return {
    source,
    target,
    layout: layoutFrom(params.get('layout')),
    ...(ocrSeed ? { ocrSeed } : {}),
    raw
  }
}

/**
 * 启动环境变量入口（Metro 启动前设置，Expo 在打包时内联 EXPO_PUBLIC_*）。
 * 优先级：完整链接 > fileId > 文件路径。
 */
export function debugRouteFromEnv(env: DebugEnv): DebugRoute | null {
  const link = env.EXPO_PUBLIC_HAM278_ROUTE?.trim()
  if (link) {
    const parsed = parseDebugUrl(link, 'env')
    if (parsed) return parsed
  }
  const fileId = env.EXPO_PUBLIC_HAM278_OPEN_FILE_ID?.trim()
  const path = env.EXPO_PUBLIC_HAM278_OPEN_PDF?.trim()
  const target = targetFrom(fileId, path)
  if (!target) return null
  const ocrSeed = env.EXPO_PUBLIC_HAM278_OCR_SEED?.trim()
  return {
    source: 'env',
    target,
    layout: layoutFrom(env.EXPO_PUBLIC_HAM278_LAYOUT),
    ...(ocrSeed ? { ocrSeed } : {}),
    raw: target.value
  }
}

/** 结构化日志载荷：只包含身份与目标，不展开记录内容。 */
export function debugRouteLog(route: DebugRoute): Record<string, unknown> {
  return {
    source: route.source,
    layout: route.layout,
    target: route.target.kind,
    ...(route.target.kind === 'fileId'
      ? { fileId: route.target.value }
      : { path: route.target.value }),
    ...(route.ocrSeed ? { ocrSeed: route.ocrSeed } : {})
  }
}
