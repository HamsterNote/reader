import { readPackagedAsset } from './packagedAsset'

class PackagedCMapReader {
  async fetch({ name }: { readonly name: string }) {
    return {
      cMapData: new Uint8Array(
        await readPackagedAsset(`pdfjs/cmaps/${name}.bcmap`)
      ),
      compressionType: 1
    }
  }
}
class PackagedStandardFontReader {
  async fetch({ filename }: { readonly filename: string }) {
    return new Uint8Array(
      await readPackagedAsset(`pdfjs/standard_fonts/${filename}`)
    )
  }
}
class PackagedWasmReader {
  async fetch({ filename }: { readonly filename: string }) {
    return new Uint8Array(await readPackagedAsset(`pdfjs/wasm/${filename}`))
  }
}

/** PDF.js' HTTP fetch factories reject successful file:// responses with status 0. */
export const packagedPdfOptions = {
  CMapReaderFactory: PackagedCMapReader,
  StandardFontDataFactory: PackagedStandardFontReader,
  WasmFactory: PackagedWasmReader,
  useWorkerFetch: false
}
