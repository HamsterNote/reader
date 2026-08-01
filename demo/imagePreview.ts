import { IntermediateDocument } from '@hamster-note/types'

type ImageDimensions = {
  readonly width: number
  readonly height: number
}

const readImageSource = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Image preview failed: file data is unavailable'))
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Image preview failed: file read error'))
    }
    reader.readAsDataURL(file)
  })
}

const readImageDimensions = (source: string): Promise<ImageDimensions> => {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (width > 0 && height > 0) {
        resolve({ width, height })
        return
      }
      reject(new Error('Image preview failed: image dimensions are invalid'))
    }
    image.onerror = () => {
      reject(new Error('Image preview failed: image could not be decoded'))
    }
    image.src = source
  })
}

export async function createImagePreviewDocument(
  file: File
): Promise<IntermediateDocument> {
  const source = await readImageSource(file)
  const { width, height } = await readImageDimensions(source)

  return IntermediateDocument.parse({
    id: `image-preview-${file.name}-${file.lastModified}-${file.size}`,
    title: file.name,
    pages: [
      {
        id: 'image-preview-page-1',
        number: 1,
        width,
        height,
        content: [],
        thumbnail: {
          id: 'image-preview-thumbnail-1',
          src: source,
          polygon: [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height]
          ],
          opacity: 1
        }
      }
    ]
  })
}
