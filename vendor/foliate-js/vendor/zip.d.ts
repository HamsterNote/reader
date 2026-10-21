// 最小类型声明：只覆盖 reader 用到的 zip.js 表面（vendored @zip.js/zip.js 2.8.22，
// 见 ../MANIFEST.md）。上游压缩构建不带类型。

export interface ZipConfiguration {
  useWebWorkers?: boolean
}

export declare function configure(options: ZipConfiguration): void

export declare class BlobReader {
  constructor(blob: Blob)
}

export declare class TextWriter {
  constructor()
}

export declare class BlobWriter {
  constructor(mimeType?: string)
}

export interface ZipEntry {
  readonly filename: string
  readonly uncompressedSize: number
  getData(
    writer: { writable: WritableStream<Uint8Array> } & {
      getData(): Promise<Uint8Array>
    }
  ): Promise<Uint8Array>
  getData(writer: TextWriter): Promise<string>
  getData(writer: BlobWriter): Promise<Blob>
}

export declare class ZipReader {
  constructor(reader: BlobReader | Uint8ArrayZipSource)
  getEntries(): Promise<ZipEntry[]>
  close(): Promise<void>
}

/** zip.js 的 Reader 鸭子类型：随机访问字节源。 */
export interface Uint8ArrayZipSource {
  readonly size: number
  readUint8Array(index: number, length: number): Promise<Uint8Array>
}
