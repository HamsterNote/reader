/** 读取设备上的 OCR 种子 JSON（仅 __DEV__ 调试入口；与 ocrSeed 的纯解析分离）。 */
import * as FileSystem from 'expo-file-system/legacy'

import { parseOcrSeed, type OcrSeed } from './ocrSeed'

function toFileUri(pathOrUri: string): string {
  const value = pathOrUri.trim()
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
  if (!value.startsWith('/')) {
    throw new Error(`OCR 种子需要绝对路径：${pathOrUri}`)
  }
  return `file://${value}`
}

export async function readOcrSeed(pathOrUri: string): Promise<OcrSeed> {
  const uri = toFileUri(pathOrUri)
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists || info.isDirectory) {
    throw new Error(`OCR 种子不存在：${pathOrUri}`)
  }
  const raw = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`OCR 种子不是合法 JSON：${pathOrUri}`)
  }
  const seed = parseOcrSeed(parsed)
  if (!seed) throw new Error(`OCR 种子结构无效：${pathOrUri}`)
  return seed
}
