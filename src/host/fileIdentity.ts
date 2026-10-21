// 文档身份与格式判定。文件 ID 由元数据 + 内容摘要生成，不把用户文件名直接拼进
// 缓存路径；调用方注入摘要函数（原生用 expo-crypto），便于测试。

export type HostDocumentFormat = 'epub' | 'pdf'

export type FileIdentityInput = {
  readonly fileName: string
  readonly size: number
  readonly modifiedAt: number
  /**
   * 文件内容的十六进制摘要（算法不限，由调用方原生流式计算）。
   * 仅元数据无法区分两个同名同尺寸同时间的不同文件：它们会得到相同 ID、
   * 共用缓存与标注数据；内容摘要让身份真正绑定到文件内容。
   */
  readonly contentDigest: string
}

const FILE_ID_PATTERN = /^f_[a-z0-9]{32}$/

export function detectDocumentFormat(
  fileName: string,
  mimeType?: string | null
): HostDocumentFormat | null {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.epub')) return 'epub'
  if (lowerName.endsWith('.pdf')) return 'pdf'
  if (mimeType === 'application/epub+zip') return 'epub'
  if (mimeType === 'application/pdf') return 'pdf'
  return null
}

export function assertSafeFileId(fileId: string): string {
  if (!FILE_ID_PATTERN.test(fileId)) {
    throw new Error(`非法文件 ID：${fileId}`)
  }
  return fileId
}

/**
 * 稳定文件 ID：同一文件（名称 + 大小 + 修改时间 + 内容摘要均相同）在重启后
 * 得到相同 ID，从而恢复同一份标注数据；内容不同的同名文件必然得到不同 ID，
 * 不会共用缓存副本与阅读数据。
 */
export async function createDocumentFileId(
  input: FileIdentityInput,
  digest: (value: string) => Promise<string>
): Promise<string> {
  // 选择器给出的大小只用于身份计算；NaN/Infinity 会让 ID 不稳定。
  if (!Number.isFinite(input.size)) {
    throw new Error('文件大小无效')
  }
  if (!/^[a-f0-9]+$/i.test(input.contentDigest)) {
    throw new Error('文件内容摘要无效')
  }
  const identity = [
    input.fileName.normalize('NFC'),
    String(input.size),
    String(Math.trunc(input.modifiedAt)),
    input.contentDigest.toLowerCase()
  ].join(String.fromCharCode(0))
  const hash = (await digest(identity)).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('摘要函数必须返回 64 位十六进制 SHA-256')
  }
  return `f_${hash.slice(0, 32)}`
}
